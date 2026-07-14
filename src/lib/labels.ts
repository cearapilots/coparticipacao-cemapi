/**
 * Rótulos em pt-BR compartilhados (fonte única). Puro: sem JSX, sem I/O.
 * Evita divergência quando um novo source_type/status é adicionado.
 */

export function sourceLabel(s: string): string {
  const map: Record<string, string> = {
    manual: "Manual",
    opening_balance: "Saldo inicial",
    adjustment: "Ajuste",
    monthly_usage: "Lançamento",
    renegotiation: "Re-parcelamento",
    import: "Importação",
    unimed_pdf: "Importação UNIMED",
  };
  return map[s] ?? s;
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = {
    projected: "Projetado",
    closed: "Fechado",
    exported: "Exportado",
    confirmed: "Confirmado",
    active: "Ativo",
    cancelled: "Cancelado",
    superseded: "Substituída",
  };
  return map[s] ?? s;
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function statusVariant(s: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    projected: "outline",
    closed: "default",
    exported: "default",
    confirmed: "secondary",
    active: "default",
    superseded: "outline",
  };
  return map[s] ?? "outline";
}
