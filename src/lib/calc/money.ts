/**
 * Todo dinheiro é manipulado em INTEIROS de centavos.
 * Nunca usar float para dinheiro.
 */

export function moneyToCents(value: string | number): number {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }
  const cleaned = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // remove separador de milhar
    .replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function centsToMoney(cents: number): string {
  return brlFormatter.format((cents ?? 0) / 100);
}

export function centsToDecimalString(cents: number): string {
  const n = cents / 100;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
