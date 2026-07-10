import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { addMonths, toMonthISO } from "./calc/date";
import { splitIntoInstallments } from "./calc/installments";

/**
 * Prévia de parcelas para saldo inicial. Divisão simples (última parcela absorve resto).
 * Pode ser editada manualmente antes de confirmar.
 */
export const previewOpeningBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    total_amount_cents: z.number().int().nonnegative(),
    first_due_month: z.string(),
    installment_count: z.number().int().min(1).max(60),
  }).parse(d))
  .handler(async ({ data }) => {
    const first = toMonthISO(data.first_due_month);
    const amounts = splitIntoInstallments(data.total_amount_cents, data.installment_count);
    return amounts.map((amt, i) => ({
      installment_number: i + 1,
      due_month: addMonths(first, i),
      amount_cents: amt,
    }));
  });

/**
 * Cria plano de saldo inicial com parcelas customizáveis pelo RH.
 * NÃO passa pela regra nova de parcelamento (source_type='opening_balance').
 */
export const createOpeningBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    employee_id: z.string().uuid(),
    notes: z.string().optional().nullable(),
    items: z.array(z.object({
      due_month: z.string(),
      amount_cents: z.number().int().nonnegative(),
    })).min(1),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");
    const { recalculateEmployeeLedger, getLastClosedMonth } = await import("./ledger.server");

    // Ordena por due_month
    const items = [...data.items]
      .map((it) => ({ due_month: toMonthISO(it.due_month), amount_cents: it.amount_cents }))
      .sort((a, b) => (a.due_month < b.due_month ? -1 : 1));

    const total = items.reduce((s, it) => s + it.amount_cents, 0);
    const first = items[0].due_month;

    // Bloqueia parcelas em meses já fechados
    const lastClosed = await getLastClosedMonth(context.supabase, data.employee_id);
    if (lastClosed && items.some((it) => it.due_month <= lastClosed)) {
      throw new Error(
        `Existem parcelas em meses já fechados (<= ${lastClosed}). Ajuste as datas para depois do último mês fechado.`,
      );
    }

    const { data: plan, error: pErr } = await context.supabase
      .from("installment_plans").insert({
        employee_id: data.employee_id,
        monthly_usage_id: null,
        source_type: "opening_balance",
        total_amount_cents: total,
        installment_count: items.length,
        first_due_month: first,
        rule_version: "opening_balance_manual",
        status: "active",
        notes: data.notes ?? null,
      }).select("*").single();
    if (pErr) throw pErr;

    await context.supabase.from("installment_plan_items").insert(
      items.map((it, i) => ({
        installment_plan_id: plan.id,
        employee_id: data.employee_id,
        competence_month: null,
        due_month: it.due_month,
        installment_number: i + 1,
        installment_count: items.length,
        scheduled_amount_cents: it.amount_cents,
        status: "projected",
      })),
    );

    await logAudit(context.supabase, context.userId, {
      action: "opening_balance.create",
      entityType: "installment_plan",
      entityId: plan.id,
      afterSnapshot: { total_amount_cents: total, installment_count: items.length, first_due_month: first },
    });

    await recalculateEmployeeLedger(context.supabase, data.employee_id, first);
    return plan;
  });
