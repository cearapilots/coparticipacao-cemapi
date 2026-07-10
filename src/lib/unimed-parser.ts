/**
 * Parser puro para o texto extraído do PDF da UNIMED.
 * Não faz I/O — recebe texto, devolve estrutura financeira.
 *
 * NÃO armazenar detalhes clínicos, prestadores ou procedimentos.
 * Só capturamos: titular (nome bruto), Total da Família, Total Cobrado Empresa
 * e o mês do relatório.
 */
import { moneyToCents } from "./calc/money";
import { toMonthISO, type MonthISO } from "./calc/date";

export interface ParsedUnimedItem {
  raw_employee_name: string;
  amount_cents: number;
  raw_text_reference: string; // curto: só a linha do titular + total, sem serviços
}

export interface ParsedUnimedReport {
  billing_month: MonthISO | null;
  total_charged_company_cents: number | null;
  items: ParsedUnimedItem[];
  sum_items_cents: number;
  diff_cents: number | null; // sum_items - total_charged (null se não tem total)
  warnings: string[];
}

const MONTH_RE = /M[eê]s\s*\/\s*Ano\s*[:\s]*(\d{1,2})\s*\/\s*(\d{4})/i;
const TITULAR_RE = /Titular\s+([A-ZÀ-Ú][A-ZÀ-Ú\s.'-]{2,}?)(?=\s{2,}|\s*\n|\s*Total\s+da\s+Fam[ií]lia)/g;
const TOTAL_FAMILIA_RE = /Total\s+da\s+Fam[ií]lia[^\d\-R$]*([\d.,]+)/gi;
const TOTAL_EMPRESA_RE = /Total\s+Cobrado\s+Empresa[^\d\-R$]*R?\$?\s*([\d.,]+)/i;

/**
 * Extrai mês do relatório em ISO 'YYYY-MM-01'.
 */
export function extractBillingMonth(text: string): MonthISO | null {
  const m = text.match(MONTH_RE);
  if (!m) return null;
  const month = String(m[1]).padStart(2, "0");
  const year = m[2];
  try {
    return toMonthISO(`${year}-${month}`);
  } catch {
    return null;
  }
}

/**
 * Extrai o "Total Cobrado Empresa" em centavos, ou null se ausente.
 */
export function extractTotalCharged(text: string): number | null {
  const m = text.match(TOTAL_EMPRESA_RE);
  if (!m) return null;
  try {
    return moneyToCents(m[1]);
  } catch {
    return null;
  }
}

/**
 * Faz o parse principal. Estratégia:
 * - Percorre o texto identificando blocos que começam em "Titular <NOME>"
 * - Para cada bloco, encontra o próximo "Total da Família <VALOR>"
 * - Ignora tudo entre eles (serviços, procedimentos, prestadores)
 */
export function parseUnimedText(rawText: string): ParsedUnimedReport {
  const warnings: string[] = [];
  const text = rawText.replace(/\r/g, "").replace(/\u00a0/g, " ");

  const billing_month = extractBillingMonth(text);
  if (!billing_month) warnings.push("Não foi possível identificar 'Mês/Ano' no PDF.");

  const total_charged_company_cents = extractTotalCharged(text);
  if (total_charged_company_cents == null) {
    warnings.push("Não foi possível identificar 'Total Cobrado Empresa'.");
  }

  // Encontra todas as posições de "Titular" e "Total da Família"
  interface Marker { kind: "titular" | "total"; index: number; match: RegExpExecArray }
  const markers: Marker[] = [];

  // Regex simples e tolerante para titular (nome em maiúsculas, até quebra dupla ou "Total")
  const titularSimple = /Titular\s+([^\n]{3,150}?)(?=\s{2,}|\n|Total\s+da\s+Fam[ií]lia)/gi;
  let tm: RegExpExecArray | null;
  while ((tm = titularSimple.exec(text)) !== null) {
    markers.push({ kind: "titular", index: tm.index, match: tm });
  }

  const totalRe = new RegExp(TOTAL_FAMILIA_RE.source, "gi");
  let fm: RegExpExecArray | null;
  while ((fm = totalRe.exec(text)) !== null) {
    markers.push({ kind: "total", index: fm.index, match: fm });
  }

  markers.sort((a, b) => a.index - b.index);

  const items: ParsedUnimedItem[] = [];
  let currentTitular: { name: string; index: number } | null = null;

  for (const mk of markers) {
    if (mk.kind === "titular") {
      const rawName = (mk.match[1] ?? "").trim().replace(/\s+/g, " ");
      // Filtra falsos positivos: nomes muito curtos ou com dígitos
      if (rawName.length < 3 || /\d/.test(rawName)) continue;
      currentTitular = { name: rawName, index: mk.index };
    } else if (mk.kind === "total" && currentTitular) {
      let cents = 0;
      try {
        cents = moneyToCents(mk.match[1]);
      } catch {
        warnings.push(`Valor inválido para titular "${currentTitular.name}": ${mk.match[1]}`);
        currentTitular = null;
        continue;
      }
      items.push({
        raw_employee_name: currentTitular.name,
        amount_cents: cents,
        raw_text_reference: `Titular ${currentTitular.name} — Total da Família ${mk.match[1]}`,
      });
      currentTitular = null;
    }
  }

  if (currentTitular) {
    warnings.push(`Titular "${currentTitular.name}" sem "Total da Família" correspondente.`);
  }

  const sum_items_cents = items.reduce((a, b) => a + b.amount_cents, 0);
  const diff_cents =
    total_charged_company_cents == null ? null : sum_items_cents - total_charged_company_cents;

  return {
    billing_month,
    total_charged_company_cents,
    items,
    sum_items_cents,
    diff_cents,
    warnings,
  };
}
