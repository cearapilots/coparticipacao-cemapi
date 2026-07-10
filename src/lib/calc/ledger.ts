/**
 * Motor PURO de recálculo do ledger mensal.
 * Sem I/O. Determinístico. Testável.
 *
 * Regras:
 *  - Percorre meses a partir de `fromMonth` até não haver mais parcelas
 *    futuras E o carryover ter zerado.
 *  - Meses com status `closed` ou `exported` NÃO são recalculados: usa-se
 *    o `carryover_out_cents` gravado deles como `carryover_in` do próximo.
 *  - Se um lançamento retroativo caísse dentro de um mês fechado, o motor
 *    NÃO altera esse mês; sinaliza `retroactiveAdjustmentsNeeded` para que
 *    o chamador crie um ajuste no primeiro mês aberto seguinte.
 */
import { addMonths, compareMonths, toMonthISO, type MonthISO } from "./date";
import { applyMonthlyCap } from "./installments";

const MAX_MONTHS_AHEAD = 240;

export type LedgerStatus = "projected" | "closed" | "exported";

export interface InstallmentItemInput {
  due_month: MonthISO | string;
  scheduled_amount_cents: number;
}

export interface LedgerRowInput {
  payroll_month: MonthISO | string;
  status: LedgerStatus;
  scheduled_amount_cents?: number;
  carryover_in_cents?: number;
  gross_due_cents?: number;
  cap_cents?: number;
  amount_to_deduct_cents?: number;
  carryover_out_cents?: number;
}

export interface LedgerRowOutput {
  payroll_month: MonthISO;
  status: LedgerStatus;
  scheduled_amount_cents: number;
  carryover_in_cents: number;
  gross_due_cents: number;
  cap_cents: number;
  amount_to_deduct_cents: number;
  carryover_out_cents: number;
  /** true quando a linha foi copiada de um mês fechado (imutável). */
  frozen: boolean;
}

export interface RecalculateInput {
  fromMonth: MonthISO | string;
  installmentItems: InstallmentItemInput[];
  existingLedger: LedgerRowInput[];
  capCents: number;
}

export interface RecalculateOutput {
  rows: LedgerRowOutput[];
  /**
   * Meses fechados que sofreriam impacto retroativo (ex.: parcelas com
   * due_month dentro de mês fechado). O chamador deve criar ajuste no
   * primeiro mês aberto.
   */
  retroactiveAdjustmentsNeeded: Array<{
    closedMonth: MonthISO;
    amountCents: number;
  }>;
  /** Primeiro mês aberto (>= fromMonth) — destino sugerido para ajustes. */
  firstOpenMonth: MonthISO | null;
}

function toMonth(m: MonthISO | string): MonthISO {
  return toMonthISO(m);
}

export function recalculateEmployeeLedger(input: RecalculateInput): RecalculateOutput {
  const fromMonth = toMonth(input.fromMonth);
  const capCents = input.capCents;

  const ledgerByMonth = new Map<MonthISO, LedgerRowInput>();
  for (const r of input.existingLedger) {
    ledgerByMonth.set(toMonth(r.payroll_month), r);
  }

  const scheduledByMonth = new Map<MonthISO, number>();
  const retroactiveAdjustmentsNeeded: RecalculateOutput["retroactiveAdjustmentsNeeded"] = [];

  for (const it of input.installmentItems) {
    const m = toMonth(it.due_month);
    const existing = ledgerByMonth.get(m);
    const isClosed = existing?.status === "closed" || existing?.status === "exported";
    if (isClosed && compareMonths(m, fromMonth) < 0) {
      // Parcela nova caindo em mês já fechado ANTES do ponto de partida:
      // reporta ajuste (não conta como scheduled desse mês).
      retroactiveAdjustmentsNeeded.push({ closedMonth: m, amountCents: it.scheduled_amount_cents });
      continue;
    }
    if (isClosed) {
      // Não altera mês fechado; reporta ajuste.
      retroactiveAdjustmentsNeeded.push({ closedMonth: m, amountCents: it.scheduled_amount_cents });
      continue;
    }
    scheduledByMonth.set(m, (scheduledByMonth.get(m) ?? 0) + (it.scheduled_amount_cents ?? 0));
  }

  // carryover que entra em fromMonth: pega mês anterior (do ledger existente).
  const prevMonth = addMonths(fromMonth, -1);
  const prev = ledgerByMonth.get(prevMonth);
  let carryoverIn = prev?.carryover_out_cents ?? 0;

  const rows: LedgerRowOutput[] = [];
  let cursor = fromMonth;
  let firstOpenMonth: MonthISO | null = null;

  for (let i = 0; i < MAX_MONTHS_AHEAD; i++) {
    const existing = ledgerByMonth.get(cursor);
    const isClosed = existing?.status === "closed" || existing?.status === "exported";

    if (isClosed) {
      // Mantém intacto; propaga carryover_out gravado.
      rows.push({
        payroll_month: cursor,
        status: existing.status,
        scheduled_amount_cents: existing.scheduled_amount_cents ?? 0,
        carryover_in_cents: existing.carryover_in_cents ?? 0,
        gross_due_cents: existing.gross_due_cents ?? 0,
        cap_cents: existing.cap_cents ?? capCents,
        amount_to_deduct_cents: existing.amount_to_deduct_cents ?? 0,
        carryover_out_cents: existing.carryover_out_cents ?? 0,
        frozen: true,
      });
      carryoverIn = existing.carryover_out_cents ?? 0;
    } else {
      if (firstOpenMonth === null) firstOpenMonth = cursor;
      const scheduled = scheduledByMonth.get(cursor) ?? 0;
      const { grossDueCents, amountToDeductCents, carryoverOutCents } = applyMonthlyCap({
        scheduledAmountCents: scheduled,
        carryoverInCents: carryoverIn,
        capCents,
      });
      // Só inclui se houver algo relevante nesse mês (ou ledger já existia)
      if (scheduled > 0 || carryoverIn > 0 || existing) {
        rows.push({
          payroll_month: cursor,
          status: (existing?.status ?? "projected") as LedgerStatus,
          scheduled_amount_cents: scheduled,
          carryover_in_cents: carryoverIn,
          gross_due_cents: grossDueCents,
          cap_cents: capCents,
          amount_to_deduct_cents: amountToDeductCents,
          carryover_out_cents: carryoverOutCents,
          frozen: false,
        });
      }
      carryoverIn = carryoverOutCents;
    }

    const anyFuture = Array.from(scheduledByMonth.keys()).some((m) => compareMonths(m, cursor) > 0);
    if (carryoverIn === 0 && !anyFuture) break;
    cursor = addMonths(cursor, 1);
  }

  return { rows, retroactiveAdjustmentsNeeded, firstOpenMonth };
}
