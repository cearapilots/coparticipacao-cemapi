import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { addMonths, toMonthISO } from "./calc/date";
import { splitIntoInstallments } from "./calc/installments";

const MAX_INSTALLMENTS = 24;

// Descobre o saldo em aberto (parcelas não-superadas em meses ainda não
// fechados) e o primeiro mês aberto onde o re-parcelamento pode começar.
async function computeOpenBalance(supabase: any, employeeId: string) {
  const { getLastClosedMonth } = await import("./ledger.server");
  const lastClosed = await getLastClosedMonth(supabase, employeeId);

  const { data: allItems, error } = await supabase
    .from("installment_plan_items")
    .select("id, due_month, scheduled_amount_cents, status")
    .eq("employee_id", employeeId)
    .neq("status", "superseded");
  if (error) throw error;

  const openItems = (allItems ?? []).filter((it: any) =>
    lastClosed ? toMonthISO(it.due_month) > lastClosed : true,
  );
  const remaining = openItems.reduce((s: number, it: any) => s + (it.scheduled_amount_cents ?? 0), 0);

  const firstDue = lastClosed
    ? addMonths(lastClosed, 1)
    : (openItems.length
        ? openItems.map((it: any) => toMonthISO(it.due_month)).sort()[0]
        : toMonthISO(new Date()));

  return { lastClosed, openItems, remaining, firstDue };
}

/**
 * Prévia do re-parcelamento: mostra o saldo em aberto e como ficariam as N
 * novas parcelas, sem gravar nada.
 */
export const previewRenegotiation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    employee_id: z.string().uuid(),
    installment_count: z.number().int().min(1).max(MAX_INSTALLMENTS),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);

    const { remaining, firstDue } = await computeOpenBalance(context.supabase, data.employee_id);
    const amounts = splitIntoInstallments(remaining, data.installment_count);
    return {
      remaining_cents: remaining,
      first_due_month: firstDue,
      items: amounts.map((amt, i) => ({
        installment_number: i + 1,
        due_month: addMonths(firstDue, i),
        amount_cents: amt,
      })),
    };
  });

/**
 * Re-parcela o SALDO RESTANTE em aberto do colaborador em N parcelas.
 * - Parcelas já descontadas em meses fechados NÃO são tocadas.
 * - As parcelas abertas atuais viram 'superseded' (ficam no histórico).
 * - Cria um novo plano consolidado (source_type='renegotiation') e recalcula
 *   o ledger a partir do primeiro mês aberto.
 * - Exige justificativa e registra auditoria.
 */
export const renegotiateInstallments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    employee_id: z.string().uuid(),
    installment_count: z.number().int().min(1).max(MAX_INSTALLMENTS),
    reason: z.string().trim().min(10, "Justificativa deve ter ao menos 10 caracteres").max(500),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");
    const { recalculateEmployeeLedger } = await import("./ledger.server");

    const { openItems, remaining, firstDue } = await computeOpenBalance(context.supabase, data.employee_id);
    if (remaining <= 0) {
      throw new Error("Não há saldo em aberto para re-parcelar.");
    }

    const amounts = splitIntoInstallments(remaining, data.installment_count);

    // 1) Marca as parcelas abertas atuais como superadas (histórico preservado).
    const { error: supErr } = await context.supabase
      .from("installment_plan_items")
      .update({ status: "superseded" })
      .in("id", openItems.map((it: any) => it.id));
    if (supErr) throw new Error(`Falha ao superar parcelas atuais: ${supErr.message}`);

    // 2) Cria o novo plano consolidado.
    const { data: plan, error: pErr } = await context.supabase
      .from("installment_plans")
      .insert({
        employee_id: data.employee_id,
        monthly_usage_id: null,
        source_type: "renegotiation",
        total_amount_cents: remaining,
        installment_count: data.installment_count,
        first_due_month: firstDue,
        rule_version: "renegotiation_v1",
        status: "active",
        notes: `Re-parcelamento: ${data.reason}`,
      })
      .select("*")
      .single();
    if (pErr) throw new Error(`Falha ao criar plano: ${pErr.message}`);

    // 3) Cria as novas parcelas.
    const { error: itErr } = await context.supabase.from("installment_plan_items").insert(
      amounts.map((amt, i) => ({
        installment_plan_id: plan.id,
        employee_id: data.employee_id,
        competence_month: null,
        due_month: addMonths(firstDue, i),
        installment_number: i + 1,
        installment_count: data.installment_count,
        scheduled_amount_cents: amt,
        status: "projected",
      })),
    );
    if (itErr) throw new Error(`Falha ao criar parcelas: ${itErr.message}`);

    // 4) Limpa o ledger projetado a partir do primeiro mês aberto e recalcula.
    //    (recalcular sem limpar deixaria valores antigos em meses além do novo
    //    horizonte, se o novo plano for mais curto que o anterior.)
    const { error: delErr } = await context.supabase
      .from("payroll_monthly_ledger")
      .delete()
      .eq("employee_id", data.employee_id)
      .eq("status", "projected")
      .gte("payroll_month", firstDue);
    if (delErr) throw new Error(`Falha ao limpar ledger projetado: ${delErr.message}`);

    await recalculateEmployeeLedger(context.supabase, data.employee_id, firstDue);

    await logAudit(context.supabase, context.userId, {
      action: "installments.renegotiate",
      entityType: "installment_plan",
      entityId: plan.id,
      beforeSnapshot: {
        remaining_cents: remaining,
        superseded_item_ids: openItems.map((it: any) => it.id),
      },
      afterSnapshot: {
        installment_count: data.installment_count,
        first_due_month: firstDue,
        reason: data.reason,
      },
    });

    return {
      plan_id: plan.id,
      remaining_cents: remaining,
      installment_count: data.installment_count,
      first_due_month: firstDue,
    };
  });
