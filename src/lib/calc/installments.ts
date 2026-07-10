import { addMonths, type MonthISO } from "./date";

export interface InstallmentThreshold {
  min_cents: number;
  max_cents: number | null;
  installment_count: number;
  first_due_policy: "same_month" | "next_month";
}

export interface InstallmentPlanPreview {
  installmentCount: number;
  firstDueMonth: MonthISO;
  items: Array<{
    installmentNumber: number;
    dueMonth: MonthISO;
    amountCents: number;
  }>;
}

export const DEFAULT_THRESHOLDS: InstallmentThreshold[] = [
  { min_cents: 0, max_cents: 15000, installment_count: 1, first_due_policy: "next_month" },
  { min_cents: 15001, max_cents: 25000, installment_count: 2, first_due_policy: "same_month" },
  { min_cents: 25001, max_cents: null, installment_count: 3, first_due_policy: "same_month" },
];

export function determineInstallmentRule(
  amountCents: number,
  thresholds: InstallmentThreshold[] = DEFAULT_THRESHOLDS,
): InstallmentThreshold {
  for (const t of thresholds) {
    if (amountCents >= t.min_cents && (t.max_cents === null || amountCents <= t.max_cents)) {
      return t;
    }
  }
  return thresholds[thresholds.length - 1];
}

/**
 * Divide um total em N parcelas de centavos.
 * A ÚLTIMA parcela absorve o resto para preservar exatamente o total.
 * Ex: 100 em 3 → [33, 33, 34]
 */
export function splitIntoInstallments(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [totalCents];
  const base = Math.floor(totalCents / count);
  const arr = Array(count - 1).fill(base);
  const last = totalCents - base * (count - 1);
  arr.push(last);
  return arr;
}

/**
 * Gera o plano de parcelamento a partir de valor e mês de competência.
 */
export function generateInstallmentPlan(
  competenceMonth: MonthISO,
  amountCents: number,
  thresholds: InstallmentThreshold[] = DEFAULT_THRESHOLDS,
): InstallmentPlanPreview {
  const rule = determineInstallmentRule(amountCents, thresholds);
  const firstDueMonth =
    rule.first_due_policy === "same_month" ? competenceMonth : addMonths(competenceMonth, 1);
  const amounts = splitIntoInstallments(amountCents, rule.installment_count);
  const items = amounts.map((amt, i) => ({
    installmentNumber: i + 1,
    dueMonth: addMonths(firstDueMonth, i),
    amountCents: amt,
  }));
  return {
    installmentCount: rule.installment_count,
    firstDueMonth,
    items,
  };
}

/**
 * Aplica o teto mensal.
 */
export function applyMonthlyCap(
  grossDueCents: number,
  capCents: number,
): { amountToDeductCents: number; carryoverOutCents: number } {
  const toDeduct = Math.min(grossDueCents, capCents);
  const carryover = Math.max(0, grossDueCents - toDeduct);
  return { amountToDeductCents: toDeduct, carryoverOutCents: carryover };
}
