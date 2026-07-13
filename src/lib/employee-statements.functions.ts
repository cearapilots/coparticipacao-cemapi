import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toMonthISO } from "./calc/date";
import { buildEmployeeStatementPdf } from "./employee-statement-pdf";

const BUCKET = "employee-statements";
const DEFAULT_CAP_CENTS = 70000;

function sourceLabel(s: string): string {
  return s === "manual" ? "Manual"
    : s === "opening_balance" ? "Saldo inicial"
    : s === "adjustment" ? "Ajuste"
    : s === "monthly_usage" ? "Lançamento"
    : s === "import" ? "Importação" : s;
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    projected: "Projetado",
    closed: "Fechado",
    exported: "Exportado",
    confirmed: "Confirmado",
    active: "Ativo",
    cancelled: "Cancelado",
  };
  return map[s] ?? s;
}

export const generateEmployeeStatementPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      employee_id: z.string().uuid(),
      reference_month: z.string(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");

    const referenceMonth = toMonthISO(data.reference_month);

    const [empRes, settingsRes, itemsRes, ledgerRes, plansRes] = await Promise.all([
      context.supabase.from("employees").select("*").eq("id", data.employee_id).maybeSingle(),
      context.supabase.from("app_settings").select("setting_key, setting_value").eq("setting_key", "company_name").maybeSingle(),
      context.supabase
        .from("installment_plan_items")
        .select("*")
        .eq("employee_id", data.employee_id)
        .gte("due_month", referenceMonth)
        .order("due_month", { ascending: true }),
      context.supabase
        .from("payroll_monthly_ledger")
        .select("*")
        .eq("employee_id", data.employee_id)
        .gte("payroll_month", referenceMonth)
        .order("payroll_month", { ascending: true }),
      context.supabase.from("installment_plans").select("*").eq("employee_id", data.employee_id),
    ]);
    if (empRes.error) throw empRes.error;
    if (!empRes.data) throw new Error("Colaborador não encontrado");
    if (itemsRes.error) throw itemsRes.error;
    if (ledgerRes.error) throw ledgerRes.error;
    if (plansRes.error) throw plansRes.error;

    const employee = empRes.data;
    const companyName = String(settingsRes.data?.setting_value ?? "Empresa");
    const items = itemsRes.data ?? [];
    const ledger = ledgerRes.data ?? [];
    const plans = plansRes.data ?? [];
    const plansById = new Map(plans.map((p) => [p.id, p]));

    // Lançamentos: um por plano ainda "em jogo" (com parcela >= referenceMonth)
    const planIdsInPlay = new Set(items.map((it) => it.installment_plan_id));
    const monthlyUsageIds = Array.from(planIdsInPlay)
      .map((id) => plansById.get(id)?.monthly_usage_id)
      .filter((id): id is string => !!id);

    const { data: usages, error: usagesErr } = monthlyUsageIds.length > 0
      ? await context.supabase.from("monthly_usage").select("*").in("id", monthlyUsageIds)
      : { data: [], error: null };
    if (usagesErr) throw usagesErr;
    const usagesById = new Map((usages ?? []).map((u) => [u.id, u]));

    const lancamentos = Array.from(planIdsInPlay).map((planId) => {
      const plan = plansById.get(planId)!;
      const usage = plan.monthly_usage_id ? usagesById.get(plan.monthly_usage_id) : undefined;
      return {
        competence_month: usage ? toMonthISO(usage.competence_month) : null,
        origem: sourceLabel(plan.source_type),
        amount_cents: plan.total_amount_cents,
        status: statusLabel(usage?.status ?? plan.status),
      };
    }).sort((a, b) => (a.competence_month ?? "").localeCompare(b.competence_month ?? ""));

    const parcelas = items.map((it) => ({
      due_month: toMonthISO(it.due_month),
      competence_month: it.competence_month ? toMonthISO(it.competence_month) : null,
      origem: sourceLabel(plansById.get(it.installment_plan_id)?.source_type ?? ""),
      installment_number: it.installment_number,
      installment_count: it.installment_count,
      amount_cents: it.scheduled_amount_cents,
    }));

    const ledgerRows = ledger.map((r) => ({
      payroll_month: toMonthISO(r.payroll_month),
      scheduled_amount_cents: r.scheduled_amount_cents,
      carryover_in_cents: r.carryover_in_cents,
      gross_due_cents: r.gross_due_cents,
      cap_cents: r.cap_cents,
      amount_to_deduct_cents: r.amount_to_deduct_cents,
      carryover_out_cents: r.carryover_out_cents,
      status: statusLabel(r.status),
    }));

    const totalOpenProjectedCents = parcelas.reduce((s, p) => s + p.amount_cents, 0);
    const referenceLedgerRow = ledger.find((r) => toMonthISO(r.payroll_month) === referenceMonth);
    const scheduledForReferenceMonthCents = referenceLedgerRow?.amount_to_deduct_cents ?? 0;
    const monthsWithFutureInstallments = new Set(parcelas.map((p) => p.due_month)).size;
    const hasCarryover = ledger.some((r) => (r.carryover_in_cents ?? 0) > 0 || (r.carryover_out_cents ?? 0) > 0);
    const cappedRow = ledger.find((r) => (r.gross_due_cents ?? 0) > (r.cap_cents ?? DEFAULT_CAP_CENTS));
    const hasOpenBalance = totalOpenProjectedCents > 0 || ledger.length > 0;

    const pdfBytes = await buildEmployeeStatementPdf({
      companyName,
      employeeName: employee.full_name,
      employeePayrollCode: employee.payroll_code,
      generatedAt: new Date(),
      referenceMonth,
      hasOpenBalance,
      totalOpenProjectedCents,
      scheduledForReferenceMonthCents,
      monthsWithFutureInstallments,
      hasCarryover,
      reachedCapCents: cappedRow ? (cappedRow.cap_cents ?? DEFAULT_CAP_CENTS) : null,
      lancamentos,
      parcelas,
      ledger: ledgerRows,
    });

    const [year, mon] = referenceMonth.split("-");
    const fileName = `demonstrativo_${employee.full_name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_${year}_${mon}.pdf`;
    const storagePath = `${employee.id}/${year}/${mon}/${Date.now()}_${fileName}`;

    const upload = await context.supabase.storage
      .from(BUCKET)
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (upload.error) throw new Error(`Falha ao salvar PDF: ${upload.error.message}`);

    const { data: exportRow, error: insErr } = await context.supabase
      .from("employee_statement_exports")
      .insert({
        employee_id: employee.id,
        reference_month: referenceMonth,
        generated_by: context.userId,
        file_storage_path: storagePath,
        status: "generated",
      })
      .select("*")
      .single();
    if (insErr) throw new Error(`Falha ao registrar exportação: ${insErr.message}`);

    await logAudit(context.supabase, context.userId, {
      action: "employee_statement.generate",
      entityType: "employee_statement_export",
      entityId: exportRow.id,
      afterSnapshot: {
        employee_id: employee.id,
        reference_month: referenceMonth,
        file_name: fileName,
        has_open_balance: hasOpenBalance,
        total_open_projected_cents: totalOpenProjectedCents,
      },
    });

    const signed = await context.supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300);
    if (signed.error) throw new Error(`Falha ao gerar link: ${signed.error.message}`);

    return {
      export_id: exportRow.id,
      file_name: fileName,
      download_url: signed.data.signedUrl,
      has_open_balance: hasOpenBalance,
      total_open_projected_cents: totalOpenProjectedCents,
    };
  });

export const getEmployeeStatementDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ export_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);

    const { data: row, error } = await context.supabase
      .from("employee_statement_exports")
      .select("id, file_storage_path")
      .eq("id", data.export_id)
      .maybeSingle();
    if (error) throw error;
    if (!row || !row.file_storage_path) throw new Error("Exportação sem arquivo associado.");

    const signed = await context.supabase.storage.from(BUCKET).createSignedUrl(row.file_storage_path, 300);
    if (signed.error) throw new Error(signed.error.message);

    return { download_url: signed.data.signedUrl };
  });

export const listEmployeeStatementExports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ employee_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);

    const { data: rows, error } = await context.supabase
      .from("employee_statement_exports")
      .select("*")
      .eq("employee_id", data.employee_id)
      .order("generated_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

// Remove um demonstrativo gerado: apaga o PDF do Storage + o registro.
// O demonstrativo é só um arquivo de conferência/envio — não é dado
// financeiro, então pode ser apagado livremente por admin/rh.
export const deleteEmployeeStatementExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ export_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);

    const { data: row, error } = await context.supabase
      .from("employee_statement_exports")
      .select("id, employee_id, file_storage_path")
      .eq("id", data.export_id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Demonstrativo não encontrado.");

    if (row.file_storage_path) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.storage.from(BUCKET).remove([row.file_storage_path]);
      } catch (e) {
        console.warn("Falha ao remover PDF do storage (seguindo com a exclusão do registro):", (e as Error).message);
      }
    }

    const { error: delErr } = await context.supabase
      .from("employee_statement_exports")
      .delete()
      .eq("id", data.export_id);
    if (delErr) throw delErr;

    const { logAudit } = await import("./audit.server");
    await logAudit(context.supabase, context.userId, {
      action: "employee_statement.delete",
      entityType: "employee_statement_export",
      entityId: data.export_id,
      beforeSnapshot: { employee_id: row.employee_id, file_storage_path: row.file_storage_path },
    });
    return { ok: true };
  });
