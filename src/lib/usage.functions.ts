import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { addMonths, toMonthISO } from "./calc/date";
import { generateInstallmentPlan, type InstallmentThreshold } from "./calc/installments";

async function loadThresholds(supabase: any): Promise<InstallmentThreshold[]> {
  const { data } = await supabase
    .from("app_settings").select("setting_value").eq("setting_key", "installment_thresholds").maybeSingle();
  const v = data?.setting_value;
  if (Array.isArray(v)) return v as InstallmentThreshold[];
  return [];
}

export const previewInstallmentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    competence_month: z.string(),
    amount_cents: z.number().int().nonnegative(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const thresholds = await loadThresholds(context.supabase);
    const preview = generateInstallmentPlan(
      toMonthISO(data.competence_month), data.amount_cents, thresholds,
    );
    return preview;
  });

export const createMonthlyUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    employee_id: z.string().uuid(),
    competence_month: z.string(),
    amount_cents: z.number().int().nonnegative(),
    notes: z.string().optional().nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");
    const { recalculateEmployeeLedger, getLastClosedMonth } = await import("./ledger.server");

    const thresholds = await loadThresholds(context.supabase);
    const competenceMonth = toMonthISO(data.competence_month);
    const plan = generateInstallmentPlan(competenceMonth, data.amount_cents, thresholds);

    // Detecta impacto retroativo: se alguma parcela cair em mês fechado, cria como AJUSTE
    // no próximo mês aberto (com valor total redirecionado para 1 parcela nesse mês).
    const lastClosed = await getLastClosedMonth(context.supabase, data.employee_id);
    const anyInClosed = lastClosed && plan.items.some((it) => it.dueMonth <= lastClosed);

    // 1. Cria monthly_usage
    const { data: usage, error: uErr } = await context.supabase
      .from("monthly_usage").insert({
        employee_id: data.employee_id,
        competence_month: competenceMonth,
        amount_cents: data.amount_cents,
        source_type: "manual",
        status: "confirmed",
        notes: data.notes ?? null,
      }).select("*").single();
    if (uErr) throw uErr;

    let planRow;
    if (anyInClosed && lastClosed) {
      const nextOpen = addMonths(lastClosed, 1);
      // Cria plano do tipo 'adjustment' com 1 parcela no próximo mês aberto
      const { data: adj, error: pErr } = await context.supabase
        .from("installment_plans").insert({
          employee_id: data.employee_id,
          monthly_usage_id: usage.id,
          source_type: "adjustment",
          total_amount_cents: data.amount_cents,
          installment_count: 1,
          first_due_month: nextOpen,
          rule_version: "adjustment_v1",
          status: "active",
          notes: "Ajuste retroativo: competência afeta mês(es) já fechado(s).",
        }).select("*").single();
      if (pErr) throw pErr;
      planRow = adj;
      await context.supabase.from("installment_plan_items").insert({
        installment_plan_id: adj.id,
        employee_id: data.employee_id,
        competence_month: competenceMonth,
        due_month: nextOpen,
        installment_number: 1,
        installment_count: 1,
        scheduled_amount_cents: data.amount_cents,
        status: "projected",
      });

      await logAudit(context.supabase, context.userId, {
        action: "usage.create.retroactive_adjustment",
        entityType: "monthly_usage",
        entityId: usage.id,
        afterSnapshot: { usage_id: usage.id, adjusted_to_month: nextOpen, amount_cents: data.amount_cents },
      });
    } else {
      const { data: p, error: pErr } = await context.supabase
        .from("installment_plans").insert({
          employee_id: data.employee_id,
          monthly_usage_id: usage.id,
          source_type: "monthly_usage",
          total_amount_cents: data.amount_cents,
          installment_count: plan.installmentCount,
          first_due_month: plan.firstDueMonth,
          rule_version: "v1",
          status: "active",
        }).select("*").single();
      if (pErr) throw pErr;
      planRow = p;
      await context.supabase.from("installment_plan_items").insert(
        plan.items.map((it) => ({
          installment_plan_id: p.id,
          employee_id: data.employee_id,
          competence_month: competenceMonth,
          due_month: it.dueMonth,
          installment_number: it.installmentNumber,
          installment_count: plan.installmentCount,
          scheduled_amount_cents: it.amountCents,
          status: "projected",
        })),
      );
      await logAudit(context.supabase, context.userId, {
        action: "usage.create",
        entityType: "monthly_usage",
        entityId: usage.id,
        afterSnapshot: { usage_id: usage.id, amount_cents: data.amount_cents, competence_month: competenceMonth },
      });
    }

    // Recalcula ledger a partir do primeiro mês aberto afetado
    const recalcFrom = lastClosed ? addMonths(lastClosed, 1) : plan.firstDueMonth;
    await recalculateEmployeeLedger(context.supabase, data.employee_id, recalcFrom);

    return { usage, plan: planRow };
  });
