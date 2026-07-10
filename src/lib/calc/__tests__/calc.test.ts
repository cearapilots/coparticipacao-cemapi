import { describe, it, expect } from "vitest";
import { normalizeName } from "../name";
import { moneyToCents, centsToMoney } from "../money";
import { addMonths, toMonthISO } from "../date";
import {
  determineInstallmentRule,
  splitIntoInstallments,
  generateInstallmentPlan,
  generateOpeningBalancePlan,
  applyMonthlyCap,
  DEFAULT_THRESHOLDS,
} from "../installments";
import { recalculateEmployeeLedger } from "../ledger";

const CAP = 70000;

describe("normalizeName", () => {
  it("remove acento, minúsculas, pontuação e espaços duplicados", () => {
    expect(normalizeName("  José  da  Silva-Júnior!  ")).toBe("jose da silva junior");
    expect(normalizeName("ÁÉÍÓÚçÃÕ")).toBe("aeioucao");
  });
});

describe("moneyToCents / centsToMoney", () => {
  it("aceita string BRL", () => {
    expect(moneyToCents("R$ 100,00")).toBe(10000);
    expect(moneyToCents("1.234,56")).toBe(123456);
    expect(moneyToCents("100.00")).toBe(10000);
    expect(moneyToCents(150.5)).toBe(15050);
    expect(moneyToCents("0,00")).toBe(0);
  });
  it("formata em pt-BR", () => {
    expect(centsToMoney(10000)).toMatch(/R\$\s?100,00/);
    expect(centsToMoney(0)).toMatch(/R\$\s?0,00/);
  });
});

describe("addMonths / toMonthISO", () => {
  it("aritmética de meses com virada de ano", () => {
    expect(addMonths("2025-11-01", 3)).toBe("2026-02-01");
    expect(addMonths("2025-01-01", -1)).toBe("2024-12-01");
    expect(toMonthISO("2025-07")).toBe("2025-07-01");
  });
});

describe("determineInstallmentRule", () => {
  it("faixas conforme regra", () => {
    expect(determineInstallmentRule(0).installment_count).toBe(1);
    expect(determineInstallmentRule(15000).installment_count).toBe(1);
    expect(determineInstallmentRule(15001).installment_count).toBe(2);
    expect(determineInstallmentRule(25000).installment_count).toBe(2);
    expect(determineInstallmentRule(25001).installment_count).toBe(3);
    expect(determineInstallmentRule(1_000_000).installment_count).toBe(3);
  });
});

describe("splitIntoInstallments", () => {
  it("preserva total e absorve resto na última", () => {
    expect(splitIntoInstallments(10000, 3)).toEqual([3333, 3333, 3334]);
    expect(splitIntoInstallments(100, 3)).toEqual([33, 33, 34]);
    expect(splitIntoInstallments(150, 1)).toEqual([150]);
    const arr = splitIntoInstallments(32350, 3);
    expect(arr.reduce((a, b) => a + b, 0)).toBe(32350);
    expect(arr).toEqual([10783, 10783, 10784]);
  });
});

describe("generateInstallmentPlan", () => {
  it("R$ 0,00: 1 parcela vazia no mês seguinte", () => {
    const p = generateInstallmentPlan("2025-04-01", 0);
    expect(p.installmentCount).toBe(1);
    expect(p.items[0].amountCents).toBe(0);
    expect(p.firstDueMonth).toBe("2025-05-01");
  });
  it("R$ 150,00 → 1 parcela no mês seguinte", () => {
    const p = generateInstallmentPlan("2025-04-01", 15000);
    expect(p.installmentCount).toBe(1);
    expect(p.firstDueMonth).toBe("2025-05-01");
    expect(p.items[0].amountCents).toBe(15000);
  });
  it("R$ 150,01 → 2 parcelas no próprio mês", () => {
    const p = generateInstallmentPlan("2025-04-01", 15001);
    expect(p.installmentCount).toBe(2);
    expect(p.firstDueMonth).toBe("2025-04-01");
    expect(p.items.map((i) => i.dueMonth)).toEqual(["2025-04-01", "2025-05-01"]);
  });
  it("R$ 250,00 → 2 parcelas", () => {
    expect(generateInstallmentPlan("2025-04-01", 25000).installmentCount).toBe(2);
  });
  it("R$ 250,01 → 3 parcelas no próprio mês", () => {
    const p = generateInstallmentPlan("2025-04-01", 25001);
    expect(p.installmentCount).toBe(3);
    expect(p.firstDueMonth).toBe("2025-04-01");
  });
  it("R$ 300,00 em abril: 100/100/100 abr-mai-jun", () => {
    const p = generateInstallmentPlan("2025-04-01", 30000);
    expect(p.items).toEqual([
      { installmentNumber: 1, dueMonth: "2025-04-01", amountCents: 10000 },
      { installmentNumber: 2, dueMonth: "2025-05-01", amountCents: 10000 },
      { installmentNumber: 3, dueMonth: "2025-06-01", amountCents: 10000 },
    ]);
  });
});

describe("generateOpeningBalancePlan", () => {
  it("R$ 323,50 em 3 parcelas a partir de julho", () => {
    const p = generateOpeningBalancePlan({
      totalAmountCents: 32350,
      firstDueMonth: "2025-07-01",
      installmentCount: 3,
    });
    expect(p.items).toEqual([
      { installmentNumber: 1, dueMonth: "2025-07-01", amountCents: 10783 },
      { installmentNumber: 2, dueMonth: "2025-08-01", amountCents: 10783 },
      { installmentNumber: 3, dueMonth: "2025-09-01", amountCents: 10784 },
    ]);
  });
  it("aceita parcelas manuais quando soma bate", () => {
    const p = generateOpeningBalancePlan({
      totalAmountCents: 30000,
      firstDueMonth: "2025-07-01",
      installmentCount: 3,
      manualInstallments: [12000, 9000, 9000],
    });
    expect(p.items.map((i) => i.amountCents)).toEqual([12000, 9000, 9000]);
  });
  it("rejeita parcelas manuais quando soma não bate", () => {
    expect(() =>
      generateOpeningBalancePlan({
        totalAmountCents: 30000,
        firstDueMonth: "2025-07-01",
        installmentCount: 3,
        manualInstallments: [10000, 10000, 9000],
      }),
    ).toThrow(/Soma/);
  });
});

describe("applyMonthlyCap", () => {
  it("dentro do teto", () => {
    expect(
      applyMonthlyCap({ scheduledAmountCents: 30000, carryoverInCents: 0, capCents: CAP }),
    ).toEqual({ grossDueCents: 30000, amountToDeductCents: 30000, carryoverOutCents: 0 });
  });
  it("acima do teto gera carryover", () => {
    expect(
      applyMonthlyCap({ scheduledAmountCents: 90000, carryoverInCents: 0, capCents: CAP }),
    ).toEqual({ grossDueCents: 90000, amountToDeductCents: 70000, carryoverOutCents: 20000 });
  });
  it("soma scheduled + carryoverIn", () => {
    expect(
      applyMonthlyCap({ scheduledAmountCents: 60000, carryoverInCents: 20000, capCents: CAP }),
    ).toEqual({ grossDueCents: 80000, amountToDeductCents: 70000, carryoverOutCents: 10000 });
  });
});

describe("recalculateEmployeeLedger", () => {
  it("sobreposição abr(300) + mai(200): abr 100, mai 200, jun 200 (sem teto)", () => {
    const out = recalculateEmployeeLedger({
      fromMonth: "2025-04-01",
      capCents: CAP,
      existingLedger: [],
      installmentItems: [
        // abr: 30000 → 3x 10000 (abr, mai, jun)
        { due_month: "2025-04-01", scheduled_amount_cents: 10000 },
        { due_month: "2025-05-01", scheduled_amount_cents: 10000 },
        { due_month: "2025-06-01", scheduled_amount_cents: 10000 },
        // mai: 20000 → 2x 10000 (mai, jun)
        { due_month: "2025-05-01", scheduled_amount_cents: 10000 },
        { due_month: "2025-06-01", scheduled_amount_cents: 10000 },
      ],
    });
    const byMonth = Object.fromEntries(out.rows.map((r) => [r.payroll_month, r.amount_to_deduct_cents]));
    expect(byMonth["2025-04-01"]).toBe(10000);
    expect(byMonth["2025-05-01"]).toBe(20000);
    expect(byMonth["2025-06-01"]).toBe(20000);
  });

  it("teto: julho 900 → 700 desconta, 200 carryover", () => {
    const out = recalculateEmployeeLedger({
      fromMonth: "2025-07-01",
      capCents: CAP,
      existingLedger: [],
      installmentItems: [{ due_month: "2025-07-01", scheduled_amount_cents: 90000 }],
    });
    const jul = out.rows.find((r) => r.payroll_month === "2025-07-01")!;
    expect(jul.amount_to_deduct_cents).toBe(70000);
    expect(jul.carryover_out_cents).toBe(20000);
    const ago = out.rows.find((r) => r.payroll_month === "2025-08-01")!;
    expect(ago.amount_to_deduct_cents).toBe(20000);
    expect(ago.carryover_out_cents).toBe(0);
  });

  it("carryover acumulado jul 900 + ago 600 → set 100, zera", () => {
    const out = recalculateEmployeeLedger({
      fromMonth: "2025-07-01",
      capCents: CAP,
      existingLedger: [],
      installmentItems: [
        { due_month: "2025-07-01", scheduled_amount_cents: 90000 },
        { due_month: "2025-08-01", scheduled_amount_cents: 60000 },
      ],
    });
    const jul = out.rows.find((r) => r.payroll_month === "2025-07-01")!;
    const ago = out.rows.find((r) => r.payroll_month === "2025-08-01")!;
    const set = out.rows.find((r) => r.payroll_month === "2025-09-01")!;
    expect(jul.amount_to_deduct_cents).toBe(70000);
    expect(jul.carryover_out_cents).toBe(20000);
    expect(ago.gross_due_cents).toBe(80000);
    expect(ago.amount_to_deduct_cents).toBe(70000);
    expect(ago.carryover_out_cents).toBe(10000);
    expect(set.amount_to_deduct_cents).toBe(10000);
    expect(set.carryover_out_cents).toBe(0);
  });

  it("não altera mês fechado e reporta ajuste retroativo", () => {
    const out = recalculateEmployeeLedger({
      fromMonth: "2025-06-01",
      capCents: CAP,
      existingLedger: [
        {
          payroll_month: "2025-05-01",
          status: "closed",
          scheduled_amount_cents: 10000,
          carryover_in_cents: 0,
          gross_due_cents: 10000,
          cap_cents: CAP,
          amount_to_deduct_cents: 10000,
          carryover_out_cents: 0,
        },
      ],
      installmentItems: [
        // Retroativo caindo em maio (fechado)
        { due_month: "2025-05-01", scheduled_amount_cents: 5000 },
        { due_month: "2025-06-01", scheduled_amount_cents: 3000 },
      ],
    });
    expect(out.retroactiveAdjustmentsNeeded).toEqual([
      { closedMonth: "2025-05-01", amountCents: 5000 },
    ]);
    expect(out.firstOpenMonth).toBe("2025-06-01");
    const jun = out.rows.find((r) => r.payroll_month === "2025-06-01")!;
    expect(jun.amount_to_deduct_cents).toBe(3000);
    // Não deve ter linha alterada de maio nas rows retornadas
    expect(out.rows.find((r) => r.payroll_month === "2025-05-01")).toBeUndefined();
  });

  it("DEFAULT_THRESHOLDS espelha spec", () => {
    expect(DEFAULT_THRESHOLDS[0].installment_count).toBe(1);
    expect(DEFAULT_THRESHOLDS[1].installment_count).toBe(2);
    expect(DEFAULT_THRESHOLDS[2].installment_count).toBe(3);
  });
});
