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
  { min_cents: 0, max_cents: 15000, installment_count: 1, first_due_policy: "same_month" },
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
 * Gera plano com número de parcelas FIXO (override manual), mantendo a mesma
 * política de primeiro vencimento (same_month/next_month) que a regra por faixa
 * daria para aquele valor. Só o número de parcelas é forçado.
 */
export function generateInstallmentPlanWithCount(
  competenceMonth: MonthISO,
  amountCents: number,
  installmentCount: number,
  thresholds: InstallmentThreshold[] = DEFAULT_THRESHOLDS,
): InstallmentPlanPreview {
  if (installmentCount <= 0) throw new Error("installmentCount deve ser >= 1");
  const rule = determineInstallmentRule(amountCents, thresholds);
  const firstDueMonth =
    rule.first_due_policy === "same_month" ? competenceMonth : addMonths(competenceMonth, 1);
  const amounts = splitIntoInstallments(amountCents, installmentCount);
  return {
    installmentCount,
    firstDueMonth,
    items: amounts.map((amt, i) => ({
      installmentNumber: i + 1,
      dueMonth: addMonths(firstDueMonth, i),
      amountCents: amt,
    })),
  };
}

/**
 * Aplica o teto mensal.
 * gross = scheduled + carryoverIn
 * toDeduct = min(gross, cap)
 * carryoverOut = gross - toDeduct
 */
export function applyMonthlyCap(input: {
  scheduledAmountCents: number;
  carryoverInCents: number;
  capCents: number;
}): {
  grossDueCents: number;
  amountToDeductCents: number;
  carryoverOutCents: number;
} {
  const gross = (input.scheduledAmountCents ?? 0) + (input.carryoverInCents ?? 0);
  const toDeduct = Math.min(gross, input.capCents);
  const carryover = Math.max(0, gross - toDeduct);
  return {
    grossDueCents: gross,
    amountToDeductCents: toDeduct,
    carryoverOutCents: carryover,
  };
}

/**
 * Gera plano de saldo inicial. NÃO aplica regra de faixas.
 * Se `manualInstallments` for informado, valida soma = total.
 * Caso contrário, divide preservando centavos (última parcela absorve resto).
 */
export function generateOpeningBalancePlan(input: {
  totalAmountCents: number;
  firstDueMonth: MonthISO;
  installmentCount: number;
  manualInstallments?: number[];
}): InstallmentPlanPreview {
  const { totalAmountCents, firstDueMonth, installmentCount, manualInstallments } = input;
  if (installmentCount <= 0) {
    throw new Error("installmentCount deve ser >= 1");
  }
  let amounts: number[];
  if (manualInstallments && manualInstallments.length > 0) {
    if (manualInstallments.length !== installmentCount) {
      throw new Error("manualInstallments.length deve ser igual a installmentCount");
    }
    const sum = manualInstallments.reduce((a, b) => a + b, 0);
    if (sum !== totalAmountCents) {
      throw new Error(`Soma das parcelas (${sum}) diferente do total (${totalAmountCents})`);
    }
    amounts = manualInstallments;
  } else {
    amounts = splitIntoInstallments(totalAmountCents, installmentCount);
  }
  return {
    installmentCount,
    firstDueMonth,
    items: amounts.map((amt, i) => ({
      installmentNumber: i + 1,
      dueMonth: addMonths(firstDueMonth, i),
      amountCents: amt,
    })),
  };
}
