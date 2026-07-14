import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toMonthISO } from "./calc/date";

/**
 * Lista os tetos personalizados (Feature B) de um colaborador.
 * Leitura aberta a qualquer usuário autenticado (só exibição).
 */
export const listMonthlyCapOverrides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ employee_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("employee_monthly_cap_overrides")
      .select("*")
      .eq("employee_id", data.employee_id)
      .order("payroll_month");
    if (error) throw error;
    return rows ?? [];
  });

/**
 * Define/atualiza o teto de UM mês aberto do colaborador.
 * A diferença é remanejada para frente pelo carryover, respeitando o teto dos
 * meses seguintes. Só meses abertos (projected); exige justificativa; audita.
 */
export const setMonthlyCapOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    employee_id: z.string().uuid(),
    payroll_month: z.string(),
    cap_cents: z.number().int().nonnegative(),
    reason: z.string().trim().min(10, "Justificativa deve ter ao menos 10 caracteres").max(500),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");
    const { recalculateEmployeeLedger, getLastClosedMonth } = await import("./ledger.server");

    const month = toMonthISO(data.payroll_month);

    const lastClosed = await getLastClosedMonth(context.supabase, data.employee_id);
    if (lastClosed && month <= lastClosed) {
      throw new Error("Não é possível ajustar o teto de um mês já fechado. Ajuste apenas meses abertos.");
    }

    const { data: before } = await context.supabase
      .from("employee_monthly_cap_overrides")
      .select("cap_cents, reason")
      .eq("employee_id", data.employee_id)
      .eq("payroll_month", month)
      .maybeSingle();

    const { error: upErr } = await context.supabase
      .from("employee_monthly_cap_overrides")
      .upsert({
        employee_id: data.employee_id,
        payroll_month: month,
        cap_cents: data.cap_cents,
        reason: data.reason,
        status: "active",
        created_by: context.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "employee_id,payroll_month" });
    if (upErr) throw new Error(`Falha ao salvar teto: ${upErr.message}`);

    // Limpa ledger projetado a partir do mês e recalcula (evita linhas antigas
    // caso o novo teto encurte/estenda o horizonte de carryover).
    const { error: delErr } = await context.supabase
      .from("payroll_monthly_ledger")
      .delete()
      .eq("employee_id", data.employee_id)
      .eq("status", "projected")
      .gte("payroll_month", month);
    if (delErr) throw new Error(`Falha ao limpar ledger projetado: ${delErr.message}`);

    await recalculateEmployeeLedger(context.supabase, data.employee_id, month);

    await logAudit(context.supabase, context.userId, {
      action: "cap_override.set",
      entityType: "employee_monthly_cap_override",
      entityId: null,
      beforeSnapshot: { payroll_month: month, cap_cents: before?.cap_cents ?? null },
      afterSnapshot: { payroll_month: month, cap_cents: data.cap_cents, reason: data.reason },
    });

    return { ok: true, payroll_month: month, cap_cents: data.cap_cents };
  });

/**
 * Remove o teto personalizado de um mês (volta ao teto global). Só meses
 * abertos; exige justificativa; audita e recalcula.
 */
export const removeMonthlyCapOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    employee_id: z.string().uuid(),
    payroll_month: z.string(),
    reason: z.string().trim().min(10, "Justificativa deve ter ao menos 10 caracteres").max(500),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");
    const { recalculateEmployeeLedger, getLastClosedMonth } = await import("./ledger.server");

    const month = toMonthISO(data.payroll_month);

    const lastClosed = await getLastClosedMonth(context.supabase, data.employee_id);
    if (lastClosed && month <= lastClosed) {
      throw new Error("Não é possível alterar um mês já fechado.");
    }

    const { data: before } = await context.supabase
      .from("employee_monthly_cap_overrides")
      .select("cap_cents")
      .eq("employee_id", data.employee_id)
      .eq("payroll_month", month)
      .maybeSingle();
    if (!before) throw new Error("Este mês não possui teto personalizado.");

    const { error: delOvErr } = await context.supabase
      .from("employee_monthly_cap_overrides")
      .delete()
      .eq("employee_id", data.employee_id)
      .eq("payroll_month", month);
    if (delOvErr) throw new Error(`Falha ao remover teto: ${delOvErr.message}`);

    const { error: delErr } = await context.supabase
      .from("payroll_monthly_ledger")
      .delete()
      .eq("employee_id", data.employee_id)
      .eq("status", "projected")
      .gte("payroll_month", month);
    if (delErr) throw new Error(`Falha ao limpar ledger projetado: ${delErr.message}`);

    await recalculateEmployeeLedger(context.supabase, data.employee_id, month);

    await logAudit(context.supabase, context.userId, {
      action: "cap_override.remove",
      entityType: "employee_monthly_cap_override",
      entityId: null,
      beforeSnapshot: { payroll_month: month, cap_cents: before.cap_cents },
      afterSnapshot: { payroll_month: month, cap_cents: null, reason: data.reason },
    });

    return { ok: true };
  });
