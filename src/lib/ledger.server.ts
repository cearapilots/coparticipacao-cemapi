/**
 * Motor de recálculo do ledger mensal - fonte de verdade no servidor.
 * Percorre meses a partir de fromMonth até carryover_out = 0, respeitando
 * meses fechados/exportados (não altera silenciosamente).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { addMonths, type MonthISO, toMonthISO } from "./calc/date";
import { applyMonthlyCap } from "./calc/installments";

const MAX_MONTHS_AHEAD = 36;

async function getMonthlyCap(supabase: SupabaseClient<Database>): Promise<number> {
  const { data } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", "monthly_cap_cents")
    .maybeSingle();
  const v = data?.setting_value;
  return typeof v === "number" ? v : 70000;
}

/**
 * Recalcula ledger do colaborador a partir de fromMonth.
 * Meses com status = 'closed' ou 'exported' NÃO são alterados; usa-se o
 * carryover_out gravado deles como carryover_in do mês seguinte.
 */
export async function recalculateEmployeeLedger(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  fromMonth: MonthISO,
): Promise<void> {
  const capCents = await getMonthlyCap(supabase);

  // Carryover que entra em fromMonth: pega o mês imediatamente anterior.
  const prevMonth = addMonths(fromMonth, -1);
  const { data: prevRow } = await supabase
    .from("payroll_monthly_ledger")
    .select("carryover_out_cents")
    .eq("employee_id", employeeId)
    .eq("payroll_month", prevMonth)
    .maybeSingle();
  let carryoverIn = prevRow?.carryover_out_cents ?? 0;

  // Carrega parcelas com due_month >= fromMonth.
  // Ignora parcelas 'superseded' (substituídas por um re-parcelamento) — elas
  // ficam no banco apenas para histórico/auditoria, não contam no cálculo.
  const { data: items, error: itemsErr } = await supabase
    .from("installment_plan_items")
    .select("due_month, scheduled_amount_cents")
    .eq("employee_id", employeeId)
    .neq("status", "superseded")
    .gte("due_month", fromMonth);
  if (itemsErr) throw itemsErr;

  // Agrupa por mês
  const scheduledByMonth = new Map<string, number>();
  for (const it of items ?? []) {
    const m = toMonthISO(it.due_month);
    scheduledByMonth.set(m, (scheduledByMonth.get(m) ?? 0) + (it.scheduled_amount_cents ?? 0));
  }

  // Determina o último mês a considerar: max entre last scheduled e enquanto houver carryover
  let cursor = fromMonth;
  let iterations = 0;

  while (iterations < MAX_MONTHS_AHEAD) {
    iterations++;

    // Estado atual gravado
    const { data: existing } = await supabase
      .from("payroll_monthly_ledger")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("payroll_month", cursor)
      .maybeSingle();

    const scheduled = scheduledByMonth.get(cursor) ?? 0;

    if (existing && (existing.status === "closed" || existing.status === "exported")) {
      // Não altera. Usa carryover_out registrado.
      carryoverIn = existing.carryover_out_cents ?? 0;
    } else {
      const { grossDueCents: gross, amountToDeductCents, carryoverOutCents } = applyMonthlyCap({
        scheduledAmountCents: scheduled,
        carryoverInCents: carryoverIn,
        capCents,
      });

      if (existing) {
        await supabase
          .from("payroll_monthly_ledger")
          .update({
            scheduled_amount_cents: scheduled,
            carryover_in_cents: carryoverIn,
            gross_due_cents: gross,
            cap_cents: capCents,
            amount_to_deduct_cents: amountToDeductCents,
            carryover_out_cents: carryoverOutCents,
            status: "projected",
          })
          .eq("id", existing.id);
      } else if (scheduled > 0 || carryoverIn > 0) {
        await supabase.from("payroll_monthly_ledger").insert({
          employee_id: employeeId,
          payroll_month: cursor,
          scheduled_amount_cents: scheduled,
          carryover_in_cents: carryoverIn,
          gross_due_cents: gross,
          cap_cents: capCents,
          amount_to_deduct_cents: amountToDeductCents,
          carryover_out_cents: carryoverOutCents,
          status: "projected",
        });
      }
      carryoverIn = carryoverOutCents;
    }

    // Condição de parada: sem carryover e sem mais parcelas futuras neste ou próximos meses
    const anyFuture = Array.from(scheduledByMonth.keys()).some((m) => m > cursor);
    if (carryoverIn === 0 && !anyFuture) break;

    cursor = addMonths(cursor, 1);
  }
}

/**
 * Retorna o maior payroll_month cujo status é 'closed' ou 'exported' para o
 * colaborador. Retorna null se não houver mês fechado.
 */
export async function getLastClosedMonth(
  supabase: SupabaseClient<Database>,
  employeeId: string,
): Promise<MonthISO | null> {
  const { data } = await supabase
    .from("payroll_monthly_ledger")
    .select("payroll_month, status")
    .eq("employee_id", employeeId)
    .in("status", ["closed", "exported"])
    .order("payroll_month", { ascending: false })
    .limit(1);
  const row = data?.[0];
  return row ? toMonthISO(row.payroll_month) : null;
}
