/**
 * Mês é sempre representado como 'YYYY-MM-01' (primeiro dia do mês, UTC).
 */

export type MonthISO = string; // 'YYYY-MM-01'

export function toMonthISO(input: string | Date): MonthISO {
  const d = typeof input === "string" ? new Date(input + (input.length === 7 ? "-01" : "")) : input;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export function addMonths(month: MonthISO, count: number): MonthISO {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + count, 1));
  return toMonthISO(date);
}

export function compareMonths(a: MonthISO, b: MonthISO): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatMonthPtBR(month: MonthISO): string {
  const [y, m] = month.split("-");
  const names = [
    "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
    "Jul", "Ago", "Set", "Out", "Nov", "Dez",
  ];
  return `${names[Number(m) - 1]}/${y}`;
}
