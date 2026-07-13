/**
 * Geração do PDF financeiro individual do colaborador (pdf-lib).
 *
 * Escopo estritamente financeiro: nenhum dado médico, procedimento,
 * prestador ou informação clínica é lido ou desenhado aqui — os dados de
 * entrada já vêm filtrados pelas server functions (employees, monthly_usage,
 * installment_plan_items, payroll_monthly_ledger).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { centsToMoney } from "./calc/money";
import { formatMonthPtBR, type MonthISO } from "./calc/date";

const PAGE_WIDTH = 595.28; // A4 pt
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export interface StatementLancamento {
  competence_month: MonthISO | null;
  origem: string;
  amount_cents: number;
  status: string;
}

export interface StatementParcela {
  due_month: MonthISO;
  competence_month: MonthISO | null;
  origem: string;
  installment_number: number;
  installment_count: number;
  amount_cents: number;
}

export interface StatementLedgerRow {
  payroll_month: MonthISO;
  scheduled_amount_cents: number;
  carryover_in_cents: number;
  gross_due_cents: number;
  cap_cents: number;
  amount_to_deduct_cents: number;
  carryover_out_cents: number;
  status: string;
}

export interface StatementParams {
  companyName: string;
  employeeName: string;
  employeePayrollCode: string | null;
  generatedAt: Date;
  referenceMonth: MonthISO;
  hasOpenBalance: boolean;
  totalOpenProjectedCents: number;
  scheduledForReferenceMonthCents: number;
  monthsWithFutureInstallments: number;
  hasCarryover: boolean;
  reachedCapCents: number | null; // cap value if reached in some month, else null
  lancamentos: StatementLancamento[];
  parcelas: StatementParcela[];
  ledger: StatementLedgerRow[];
}

class Cursor {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y = 0;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(h: number): boolean {
    if (this.y - h < MARGIN) {
      this.newPage();
      return true;
    }
    return false;
  }

  text(str: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const color = opts.color ? rgb(...opts.color) : rgb(0, 0, 0);
    this.ensureSpace(size + 4);
    this.page.drawText(str, { x: opts.x ?? MARGIN, y: this.y, size, font, color });
    this.y -= size + (opts.gap ?? 6);
  }

  spacer(h: number) {
    this.y -= h;
  }

  hr() {
    this.ensureSpace(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
    this.y -= 10;
  }
}

interface Column {
  header: string;
  width: number;
  align?: "left" | "right" | "center";
}

function drawTable(cur: Cursor, title: string, columns: Column[], rows: string[][], fontSize = 9) {
  cur.ensureSpace(fontSize + 16);
  cur.text(title, { bold: true, size: 11, gap: 8 });

  const rowH = fontSize + 8;

  const drawHeader = () => {
    cur.ensureSpace(rowH + 4);
    let x = MARGIN;
    cur.page.drawRectangle({
      x: MARGIN,
      y: cur.y - rowH + 4,
      width: CONTENT_WIDTH,
      height: rowH,
      color: rgb(0.92, 0.92, 0.92),
    });
    for (const col of columns) {
      cur.page.drawText(col.header, { x: x + 3, y: cur.y - fontSize + 1, size: fontSize, font: cur.bold, color: rgb(0, 0, 0) });
      x += col.width;
    }
    cur.y -= rowH;
  };

  drawHeader();

  if (rows.length === 0) {
    cur.text("Nenhum registro.", { size: fontSize, color: [0.4, 0.4, 0.4] });
    return;
  }

  for (const row of rows) {
    const wrapped = cur.ensureSpace(rowH);
    if (wrapped) drawHeader();
    let x = MARGIN;
    row.forEach((cell, i) => {
      const col = columns[i];
      const textWidth = cur.font.widthOfTextAtSize(cell, fontSize);
      let drawX = x + 3;
      if (col.align === "right") drawX = x + col.width - textWidth - 3;
      else if (col.align === "center") drawX = x + (col.width - textWidth) / 2;
      cur.page.drawText(cell, { x: drawX, y: cur.y - fontSize + 1, size: fontSize, font: cur.font, color: rgb(0, 0, 0) });
      x += col.width;
    });
    cur.y -= rowH;
  }
  cur.spacer(10);
}

export async function buildEmployeeStatementPdf(params: StatementParams): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cur = new Cursor(doc, font, bold);

  cur.text("Demonstrativo de Coparticipação do Plano de Saúde", { bold: true, size: 15, gap: 12 });

  cur.text(params.companyName, { size: 10 });
  cur.text(`Colaborador: ${params.employeeName}${params.employeePayrollCode ? ` (Cód. ${params.employeePayrollCode})` : ""}`, { size: 10 });
  cur.text(`Data de geração: ${params.generatedAt.toLocaleDateString("pt-BR")}`, { size: 10 });
  cur.text(`Mês de referência: ${formatMonthPtBR(params.referenceMonth)}`, { size: 10 });
  cur.text(
    params.hasOpenBalance ? "Status: Com valores em aberto/projetados" : "Status: Sem saldo em aberto",
    { size: 10, bold: true, color: params.hasOpenBalance ? [0.6, 0.35, 0] : [0.1, 0.5, 0.2] },
  );
  cur.hr();

  cur.text("Resumo financeiro", { bold: true, size: 12, gap: 8 });
  cur.text(`Valor total em aberto/projetado a partir de ${formatMonthPtBR(params.referenceMonth)}: ${centsToMoney(params.totalOpenProjectedCents)}`, { size: 10 });
  cur.text(`Valor previsto para desconto em ${formatMonthPtBR(params.referenceMonth)}: ${centsToMoney(params.scheduledForReferenceMonthCents)}`, { size: 10 });
  cur.text(`Meses com parcelas futuras: ${params.monthsWithFutureInstallments}`, { size: 10 });
  cur.text(`Carryover (remanejamento) existente: ${params.hasCarryover ? "Sim" : "Não"}`, { size: 10 });
  cur.text(
    params.reachedCapCents != null
      ? `Atingiu o teto mensal (${centsToMoney(params.reachedCapCents)}) em pelo menos um mês projetado.`
      : "Não atingiu o teto mensal em nenhum mês projetado.",
    { size: 10 },
  );
  cur.spacer(6);

  drawTable(
    cur,
    "Lançamentos",
    [
      { header: "Competência", width: 110 },
      { header: "Origem", width: 150 },
      { header: "Valor lançado", width: 120, align: "right" },
      { header: "Status", width: 135 },
    ],
    params.lancamentos.map((l) => [
      l.competence_month ? formatMonthPtBR(l.competence_month) : "—",
      l.origem,
      centsToMoney(l.amount_cents),
      l.status,
    ]),
  );

  drawTable(
    cur,
    "Parcelas previstas",
    [
      { header: "Mês de desconto", width: 90 },
      { header: "Competência origem", width: 100 },
      { header: "Origem", width: 110 },
      { header: "Parcela", width: 60, align: "center" },
      { header: "Valor", width: 155, align: "right" },
    ],
    params.parcelas.map((p) => [
      formatMonthPtBR(p.due_month),
      p.competence_month ? formatMonthPtBR(p.competence_month) : "—",
      p.origem,
      `${p.installment_number}/${p.installment_count}`,
      centsToMoney(p.amount_cents),
    ]),
    9,
  );

  drawTable(
    cur,
    "Projeção mensal",
    [
      { header: "Mês", width: 55 },
      { header: "Parcelas prev.", width: 68, align: "right" },
      { header: "Carryover in", width: 68, align: "right" },
      { header: "Bruto", width: 62, align: "right" },
      { header: "Teto", width: 55, align: "right" },
      { header: "A descontar", width: 68, align: "right" },
      { header: "Carryover out", width: 68, align: "right" },
      { header: "Status", width: 71 },
    ],
    params.ledger.map((r) => [
      formatMonthPtBR(r.payroll_month),
      centsToMoney(r.scheduled_amount_cents),
      centsToMoney(r.carryover_in_cents),
      centsToMoney(r.gross_due_cents),
      centsToMoney(r.cap_cents),
      centsToMoney(r.amount_to_deduct_cents),
      centsToMoney(r.carryover_out_cents),
      r.status,
    ]),
    7.5,
  );

  cur.hr();
  cur.text("Este demonstrativo apresenta valores de coparticipação do plano de saúde com base nas informações processadas pelo RH.", { size: 8, color: [0.35, 0.35, 0.35] });
  cur.text("Os valores futuros podem ser alterados caso novos lançamentos sejam recebidos da UNIMED ou caso existam ajustes posteriores.", { size: 8, color: [0.35, 0.35, 0.35] });
  cur.text("Este demonstrativo não contém detalhes médicos, procedimentos, prestadores ou informações clínicas.", { size: 8, color: [0.35, 0.35, 0.35] });

  return doc.save();
}
