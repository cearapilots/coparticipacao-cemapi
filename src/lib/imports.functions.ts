import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeName } from "./calc/name";
import { parseUnimedText } from "./unimed-parser";
import { toMonthISO, addMonths } from "./calc/date";
import { generateInstallmentPlan, type InstallmentThreshold } from "./calc/installments";

type Sb = Parameters<typeof requireSupabaseAuth extends { server: infer S } ? any : any>[0] extends any ? any : any;

// Valor efetivo: corrigido pelo RH/admin quando existir, senão o valor
// originalmente extraído do PDF. amount_cents nunca é sobrescrito.
function effectiveAmountCents(it: { amount_cents: number | null; corrected_amount_cents?: number | null }): number {
  return it.corrected_amount_cents ?? it.amount_cents ?? 0;
}

async function loadThresholds(supabase: any): Promise<InstallmentThreshold[]> {
  const { data } = await supabase
    .from("app_settings").select("setting_value").eq("setting_key", "installment_thresholds").maybeSingle();
  const v = data?.setting_value;
  return Array.isArray(v) ? (v as InstallmentThreshold[]) : [];
}

interface MatchResult {
  employee_id: string | null;
  status: "auto_matched" | "needs_review" | "not_found";
  confidence: number;
}

function tokenSubsetScore(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter((t) => t.length >= 2));
  const tb = new Set(b.split(/\s+/).filter((t) => t.length >= 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let hit = 0;
  for (const t of small) if (big.has(t)) hit++;
  return hit / small.size;
}

function matchName(
  rawName: string,
  employees: { id: string; normalized_name: string }[],
  aliases: { employee_id: string; normalized_alias_name: string }[],
): MatchResult {
  const n = normalizeName(rawName);
  if (!n) return { employee_id: null, status: "not_found", confidence: 0 };

  // Exato: employees
  const exactEmp = employees.find((e) => e.normalized_name === n);
  if (exactEmp) return { employee_id: exactEmp.id, status: "auto_matched", confidence: 1 };

  // Exato: aliases
  const exactAlias = aliases.find((a) => a.normalized_alias_name === n);
  if (exactAlias) return { employee_id: exactAlias.employee_id, status: "auto_matched", confidence: 1 };

  // Aproximado por tokens
  let best: { id: string; score: number } | null = null;
  for (const e of employees) {
    const s = tokenSubsetScore(n, e.normalized_name);
    if (!best || s > best.score) best = { id: e.id, score: s };
  }
  for (const a of aliases) {
    const s = tokenSubsetScore(n, a.normalized_alias_name);
    if (!best || s > best.score) best = { id: a.employee_id, score: s };
  }
  if (best && best.score >= 0.6) {
    return { employee_id: best.id, status: "needs_review", confidence: best.score };
  }
  return { employee_id: null, status: "not_found", confidence: 0 };
}

// ------------------- CREATE BATCH FROM PARSED TEXT -------------------

// ------------------- MARKER (marco operacional) -------------------

export const getImportMarker = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .in("setting_key", [
        "first_unimed_import_month",
        "opening_balance_reference_month",
        "opening_balance_source_note",
      ]);
    const map = new Map((data ?? []).map((r) => [r.setting_key, r.setting_value]));
    return {
      first_unimed_import_month:
        (map.get("first_unimed_import_month") as string) ?? "2026-08-01",
      opening_balance_reference_month:
        (map.get("opening_balance_reference_month") as string) ?? "2026-07-01",
      opening_balance_source_note:
        (map.get("opening_balance_source_note") as string) ??
        "Carga inicial — Unimed Saldo Devedor 07/2026",
    };
  });

export const createImportBatchFromPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      raw_text: z.string().min(10),
      source_file_name: z.string().min(1),
      source_file_hash: z.string().min(4),
      source_file_storage_path: z.string().nullable().optional(),
      competence_month: z.string(),
      confirm_reprocess: z.boolean().optional(),
      pre_marker_override_reason: z.string().trim().min(10).max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { requireAnyRole, getUserRoles } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);

    const competence = toMonthISO(data.competence_month);

    // Marco operacional: bloqueia competências anteriores ao first_unimed_import_month.
    // Só admin pode fazer override, e apenas com justificativa obrigatória.
    const { data: markerRow } = await context.supabase
      .from("app_settings")
      .select("setting_value")
      .eq("setting_key", "first_unimed_import_month")
      .maybeSingle();
    const marker = toMonthISO((markerRow?.setting_value as string) ?? "2026-08-01");
    if (competence < marker) {
      const roles = await getUserRoles(context.supabase, context.userId);
      const isAdmin = roles.includes("admin");
      if (!isAdmin) {
        throw new Error(
          `A competência ${competence.substring(0, 7)} é anterior ao marco operacional (${marker.substring(0, 7)}). Esses meses já foram cobertos pela carga inicial de saldo devedor. Apenas administradores podem importar competências anteriores.`,
        );
      }
      if (!data.pre_marker_override_reason) {
        throw new Error(
          `PRE_MARKER_OVERRIDE_REQUIRED: competência ${competence.substring(0, 7)} anterior ao marco (${marker.substring(0, 7)}). Informe uma justificativa para prosseguir.`,
        );
      }
      const { logAudit } = await import("./audit.server");
      await logAudit(context.supabase, context.userId, {
        action: "import.pre_marker_override",
        entityType: "import_batch",
        afterSnapshot: {
          competence_month: competence,
          marker_month: marker,
          reason: data.pre_marker_override_reason,
          source_file_name: data.source_file_name,
          source_file_hash: data.source_file_hash,
        },
      });
    }

    // Duplicidade por hash
    const { data: existingByHash } = await context.supabase
      .from("import_batches")
      .select("id, status, source_file_name, uploaded_at")
      .eq("source_file_hash", data.source_file_hash)
      .order("uploaded_at", { ascending: false });
    if ((existingByHash?.length ?? 0) > 0 && !data.confirm_reprocess) {
      return {
        duplicate: true,
        reason: "hash",
        existing: existingByHash,
        batch_id: null as string | null,
      };
    }

    // Duplicidade por competência confirmada
    const { data: existingByComp } = await context.supabase
      .from("import_batches")
      .select("id, status, source_file_name")
      .eq("competence_month", competence)
      .eq("status", "confirmed");
    if ((existingByComp?.length ?? 0) > 0 && !data.confirm_reprocess) {
      return {
        duplicate: true,
        reason: "competence_confirmed",
        existing: existingByComp,
        batch_id: null as string | null,
      };
    }

    const parsed = parseUnimedText(data.raw_text);

    const { data: batch, error: bErr } = await context.supabase
      .from("import_batches")
      .insert({
        source_type: "unimed_pdf",
        source_file_name: data.source_file_name,
        source_file_hash: data.source_file_hash,
        source_file_storage_path: data.source_file_storage_path ?? null,
        billing_month: parsed.billing_month,
        competence_month: competence,
        uploaded_by: context.userId,
        status: "pending_review",
        total_items: parsed.items.length,
        total_amount_cents: parsed.sum_items_cents,
        total_charged_company_cents: parsed.total_charged_company_cents,
        notes: parsed.warnings.length ? `Avisos do parser:\n- ${parsed.warnings.join("\n- ")}` : null,
      })
      .select("*")
      .single();
    if (bErr) throw bErr;

    // Matching
    const [empRes, aliasRes] = await Promise.all([
      context.supabase.from("employees").select("id, normalized_name").eq("status", "active"),
      context.supabase.from("employee_aliases").select("employee_id, normalized_alias_name"),
    ]);
    const employees = empRes.data ?? [];
    const aliases = aliasRes.data ?? [];

    if (parsed.items.length > 0) {
      const itemRows = parsed.items.map((it) => {
        const m = matchName(it.raw_employee_name, employees, aliases);
        return {
          import_batch_id: batch.id,
          raw_employee_name: it.raw_employee_name,
          matched_employee_id: m.employee_id,
          match_confidence: m.confidence,
          match_status: m.status,
          amount_cents: it.amount_cents,
          raw_text_reference: it.raw_text_reference,
          review_status: m.status === "auto_matched" ? "reviewed" : "pending",
        };
      });
      const { error: iErr } = await context.supabase.from("import_items").insert(itemRows);
      if (iErr) throw iErr;
    }

    const { logAudit } = await import("./audit.server");
    await logAudit(context.supabase, context.userId, {
      action: "import.batch.create",
      entityType: "import_batch",
      entityId: batch.id,
      afterSnapshot: {
        source_file_name: batch.source_file_name,
        competence_month: batch.competence_month,
        billing_month: batch.billing_month,
        total_items: batch.total_items,
        total_amount_cents: batch.total_amount_cents,
        total_charged_company_cents: batch.total_charged_company_cents,
        reprocess: !!data.confirm_reprocess,
      },
    });

    return { duplicate: false as const, batch_id: batch.id, warnings: parsed.warnings };
  });

// ------------------- LIST -------------------

export const listImportBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("import_batches")
      .select("*")
      .order("uploaded_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  });

// ------------------- DETAILS -------------------

export const getImportBatchDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batch_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const [batchRes, itemsRes, empRes] = await Promise.all([
      context.supabase.from("import_batches").select("*").eq("id", data.batch_id).maybeSingle(),
      context.supabase
        .from("import_items")
        .select("*")
        .eq("import_batch_id", data.batch_id)
        .order("raw_employee_name", { ascending: true }),
      context.supabase.from("employees").select("id, full_name, payroll_code, status").order("full_name"),
    ]);
    if (batchRes.error) throw batchRes.error;
    if (!batchRes.data) throw new Error("Lote não encontrado");
    if (itemsRes.error) throw itemsRes.error;
    if (empRes.error) throw empRes.error;
    return { batch: batchRes.data, items: itemsRes.data ?? [], employees: empRes.data ?? [] };
  });

// ------------------- UPDATE ITEM MATCH -------------------

export const updateImportItemMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      item_id: z.string().uuid(),
      employee_id: z.string().uuid().nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { error } = await context.supabase
      .from("import_items")
      .update({
        matched_employee_id: data.employee_id,
        match_status: data.employee_id ? "manually_matched" : "not_found",
        match_confidence: data.employee_id ? 1 : 0,
        review_status: data.employee_id ? "reviewed" : "pending",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.item_id);
    if (error) throw error;
    return { ok: true };
  });

// ------------------- CORRECT EXTRACTED AMOUNT -------------------
// amount_cents nunca é sobrescrito — é o valor original extraído do PDF.
// A correção fica em corrected_amount_cents; o valor efetivo (usado na
// confirmação do lote) é corrected_amount_cents ?? amount_cents.
// Passar corrected_amount_cents = null remove a correção (volta a usar o
// valor original), mas ainda exige justificativa (fica no audit_log).

export const updateImportItemAmount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      item_id: z.string().uuid(),
      corrected_amount_cents: z.number().int().nonnegative().nullable(),
      reason: z.string().trim().min(10, "Justificativa deve ter ao menos 10 caracteres").max(500),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");

    const { data: item, error: itemErr } = await context.supabase
      .from("import_items")
      .select("*")
      .eq("id", data.item_id)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!item) throw new Error("Item não encontrado.");

    const { data: batch, error: batchErr } = await context.supabase
      .from("import_batches")
      .select("status")
      .eq("id", item.import_batch_id)
      .maybeSingle();
    if (batchErr) throw batchErr;
    if (batch?.status === "confirmed" || batch?.status === "cancelled") {
      throw new Error("Não é possível editar valor: o lote já foi confirmado ou cancelado.");
    }

    const before = {
      amount_cents: item.amount_cents,
      corrected_amount_cents: item.corrected_amount_cents,
      correction_reason: item.correction_reason,
    };

    const { data: updated, error: updErr } = await context.supabase
      .from("import_items")
      .update({
        corrected_amount_cents: data.corrected_amount_cents,
        correction_reason: data.reason,
        corrected_by: context.userId,
        corrected_at: new Date().toISOString(),
      })
      .eq("id", data.item_id)
      .select("*")
      .single();
    if (updErr) throw updErr;

    await logAudit(context.supabase, context.userId, {
      action: data.corrected_amount_cents === null ? "import_item.amount_correction_clear" : "import_item.amount_correct",
      entityType: "import_item",
      entityId: data.item_id,
      beforeSnapshot: before,
      afterSnapshot: { corrected_amount_cents: data.corrected_amount_cents, reason: data.reason },
    });

    return updated;
  });

// ------------------- IGNORE ITEM -------------------

export const ignoreImportItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      item_id: z.string().uuid(),
      ignore: z.boolean(),
      reason: z.string().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const patch = data.ignore
      ? {
          match_status: "ignored",
          review_status: "ignored",
          reviewed_by: context.userId,
          reviewed_at: new Date().toISOString(),
          notes: data.reason ?? null,
        }
      : {
          match_status: "needs_review",
          review_status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          notes: null,
        };
    const { error } = await context.supabase.from("import_items").update(patch).eq("id", data.item_id);
    if (error) throw error;
    return { ok: true };
  });

// ------------------- CANCEL -------------------

export const cancelImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batch_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { data: b } = await context.supabase.from("import_batches").select("status").eq("id", data.batch_id).maybeSingle();
    if (!b) throw new Error("Lote não encontrado");
    if (b.status === "confirmed") throw new Error("Não é possível cancelar um lote confirmado");
    const { error } = await context.supabase
      .from("import_batches")
      .update({ status: "cancelled" })
      .eq("id", data.batch_id);
    if (error) throw error;
    const { logAudit } = await import("./audit.server");
    await logAudit(context.supabase, context.userId, {
      action: "import.batch.cancel",
      entityType: "import_batch",
      entityId: data.batch_id,
    });
    return { ok: true };
  });

// ------------------- DELETE (hard delete de lote NÃO confirmado) -------------------
// Remove definitivamente o lote e seus itens (cascade) + o arquivo no Storage.
// Bloqueado para lotes 'confirmed' (esses já geraram lançamentos financeiros e
// devem ser preservados para auditoria). Ideal para limpar lotes de
// teste/erro/cancelados de "Lotes recentes".
export const deleteImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batch_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);

    const { data: batch, error: bErr } = await context.supabase
      .from("import_batches")
      .select("id, status, source_file_storage_path, source_file_name")
      .eq("id", data.batch_id)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!batch) throw new Error("Lote não encontrado.");
    if (batch.status === "confirmed") {
      throw new Error("Não é possível apagar um lote confirmado — ele já gerou lançamentos. Esses lotes ficam preservados para auditoria.");
    }

    // Remove o PDF do bucket privado (usa service role: já validamos o papel acima).
    if (batch.source_file_storage_path) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.storage.from("unimed-pdfs").remove([batch.source_file_storage_path]);
      } catch (e) {
        console.warn("Falha ao remover PDF do storage (seguindo com a exclusão do lote):", (e as Error).message);
      }
    }

    // import_items caem por ON DELETE CASCADE.
    const { error: delErr } = await context.supabase.from("import_batches").delete().eq("id", data.batch_id);
    if (delErr) throw delErr;

    const { logAudit } = await import("./audit.server");
    await logAudit(context.supabase, context.userId, {
      action: "import.batch.delete",
      entityType: "import_batch",
      entityId: data.batch_id,
      beforeSnapshot: { status: batch.status, source_file_name: batch.source_file_name },
    });
    return { ok: true };
  });

// ------------------- CONFIRM BATCH -------------------

export const confirmImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batch_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");
    const { recalculateEmployeeLedger, getLastClosedMonth } = await import("./ledger.server");

    const FRIENDLY = "Não foi possível confirmar o lote. Nenhum lote foi marcado como confirmado. Revise o erro e tente novamente.";
    const fail = (detail: string): never => {
      throw new Error(`${FRIENDLY} Detalhe: ${detail}`);
    };

    // 1) Carrega lote
    const { data: batch, error: bErr } = await context.supabase
      .from("import_batches")
      .select("*")
      .eq("id", data.batch_id)
      .maybeSingle();
    if (bErr) fail(`falha ao carregar lote (${bErr.message})`);
    if (!batch) throw new Error("Lote não encontrado.");
    if (batch.status === "confirmed") throw new Error("Este lote já foi confirmado.");
    if (batch.status === "cancelled") throw new Error("Este lote foi cancelado e não pode ser confirmado.");
    if (!batch.competence_month) throw new Error("Este lote não possui competência definida.");

    // 2) Carrega itens
    const { data: items, error: iErr } = await context.supabase
      .from("import_items")
      .select("*")
      .eq("import_batch_id", data.batch_id);
    if (iErr) fail(`falha ao carregar itens (${iErr.message})`);

    // 3) Validação de pendências
    const pending = (items ?? []).filter(
      (it) =>
        it.review_status !== "ignored" &&
        (it.match_status === "not_found" ||
          it.match_status === "needs_review" ||
          !it.matched_employee_id),
    );
    if (pending.length > 0) {
      throw new Error(
        `Este lote ainda possui ${pending.length} item(ns) sem associação ou revisão. Associe o colaborador ou marque como ignorado antes de confirmar.`,
      );
    }

    const toProcess = (items ?? []).filter(
      (it) =>
        it.review_status !== "ignored" &&
        it.matched_employee_id &&
        effectiveAmountCents(it) > 0,
    );

    const thresholds = await loadThresholds(context.supabase);
    const competence = toMonthISO(batch.competence_month);
    const employeesAffected = new Set<string>();
    const earliestByEmp = new Map<string, string>();

    // 4) Loop de writes — cada etapa checa erro explicitamente.
    // LIMITAÇÃO CONHECIDA: o driver Supabase JS não expõe transação
    // multi-statement. Se um item falhar após inserções anteriores, o lote
    // NÃO é marcado como confirmed — o operador pode corrigir e reprocessar.
    // Registros parcialmente criados ficam vinculados via
    // monthly_usage.source_reference_id → import_items.id e podem ser
    // localizados por auditoria. Uma RPC transacional pode ser adicionada no futuro.
    for (const it of toProcess) {
      const empId = it.matched_employee_id!;
      const amount = effectiveAmountCents(it);
      const lastClosed = await getLastClosedMonth(context.supabase, empId);
      const plan = generateInstallmentPlan(competence, amount, thresholds);
      const anyInClosed = lastClosed && plan.items.some((p) => p.dueMonth <= lastClosed);

      // 4a) monthly_usage
      const { data: usage, error: uErr } = await context.supabase
        .from("monthly_usage")
        .insert({
          employee_id: empId,
          competence_month: competence,
          amount_cents: amount,
          source_type: "unimed_pdf",
          source_reference_id: it.id,
          status: "confirmed",
          notes: `Importação UNIMED — lote ${batch.id.substring(0, 8)}`,
        })
        .select("id")
        .single();
      if (uErr || !usage) fail(`falha ao criar lançamento para item ${it.id.substring(0, 8)} (${uErr?.message ?? "sem retorno"})`);

      if (anyInClosed && lastClosed) {
        const nextOpen = addMonths(lastClosed, 1);
        const { data: adj, error: pErr } = await context.supabase
          .from("installment_plans")
          .insert({
            employee_id: empId,
            monthly_usage_id: usage!.id,
            source_type: "adjustment",
            total_amount_cents: amount,
            installment_count: 1,
            first_due_month: nextOpen,
            rule_version: "adjustment_v1",
            status: "active",
            notes: "Ajuste retroativo (importação UNIMED): competência afeta mês(es) fechado(s).",
          })
          .select("id")
          .single();
        if (pErr || !adj) fail(`falha ao criar plano de ajuste retroativo (${pErr?.message ?? "sem retorno"})`);

        const { error: piErr } = await context.supabase.from("installment_plan_items").insert({
          installment_plan_id: adj!.id,
          employee_id: empId,
          competence_month: competence,
          due_month: nextOpen,
          installment_number: 1,
          installment_count: 1,
          scheduled_amount_cents: amount,
          status: "projected",
        });
        if (piErr) fail(`falha ao gravar parcela de ajuste (${piErr.message})`);

        const cur = earliestByEmp.get(empId);
        if (!cur || nextOpen < cur) earliestByEmp.set(empId, nextOpen);
      } else {
        const { data: p, error: pErr } = await context.supabase
          .from("installment_plans")
          .insert({
            employee_id: empId,
            monthly_usage_id: usage!.id,
            source_type: "monthly_usage",
            total_amount_cents: amount,
            installment_count: plan.installmentCount,
            first_due_month: plan.firstDueMonth,
            rule_version: "v1",
            status: "active",
          })
          .select("id")
          .single();
        if (pErr || !p) fail(`falha ao criar plano de parcelamento (${pErr?.message ?? "sem retorno"})`);

        const { error: piErr } = await context.supabase.from("installment_plan_items").insert(
          plan.items.map((pit) => ({
            installment_plan_id: p!.id,
            employee_id: empId,
            competence_month: competence,
            due_month: pit.dueMonth,
            installment_number: pit.installmentNumber,
            installment_count: plan.installmentCount,
            scheduled_amount_cents: pit.amountCents,
            status: "projected",
          })),
        );
        if (piErr) fail(`falha ao gravar parcelas (${piErr.message})`);

        const cur = earliestByEmp.get(empId);
        if (!cur || plan.firstDueMonth < cur) earliestByEmp.set(empId, plan.firstDueMonth);
      }
      employeesAffected.add(empId);
    }

    // 5) Recalcula ledger — se falhar, o lote continua NÃO confirmado.
    for (const [empId, fromMonth] of earliestByEmp) {
      try {
        await recalculateEmployeeLedger(context.supabase, empId, fromMonth);
      } catch (e) {
        fail(`falha ao recalcular ledger de ${empId.substring(0, 8)} (${(e as Error).message})`);
      }
    }

    // 6) Marca lote como confirmado — última operação antes da auditoria.
    const { error: updErr } = await context.supabase
      .from("import_batches")
      .update({ status: "confirmed" })
      .eq("id", batch.id);
    if (updErr) fail(`falha ao marcar lote como confirmado (${updErr.message})`);

    // 7) Auditoria — somente após todas as etapas acima terem sucesso.
    await logAudit(context.supabase, context.userId, {
      action: "import.batch.confirm",
      entityType: "import_batch",
      entityId: batch.id,
      afterSnapshot: {
        processed_items: toProcess.length,
        employees_affected: employeesAffected.size,
        total_amount_cents: toProcess.reduce((a, b) => a + (b.amount_cents ?? 0), 0),
      },
    });

    return {
      ok: true,
      processed_items: toProcess.length,
      employees_affected: employeesAffected.size,
    };
  });
