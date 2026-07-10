import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as XLSX from "xlsx";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toMonthISO } from "./calc/date";

const BUCKET = "payroll-exports";

type SettingsMap = Record<string, unknown>;

async function loadAccountingSettings(supabase: any): Promise<{
  event_code: string;
  value_type: string;
  include_zero_rows: boolean;
  blank_when_zero: boolean;
  company_line: string;
}> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("setting_key, setting_value")
    .in("setting_key", [
      "accounting_event_code",
      "accounting_value_type",
      "accounting_export_include_zero_rows",
      "accounting_export_blank_when_zero",
      "accounting_company_line",
    ]);
  if (error) throw new Error(`Falha ao carregar configurações: ${error.message}`);
  const map: SettingsMap = Object.fromEntries((data ?? []).map((r: any) => [r.setting_key, r.setting_value]));
  return {
    event_code: String(map.accounting_event_code ?? "543"),
    value_type: String(map.accounting_value_type ?? "V"),
    include_zero_rows: map.accounting_export_include_zero_rows !== false,
    blank_when_zero: map.accounting_export_blank_when_zero !== false,
    company_line: String(map.accounting_company_line ?? ""),
  };
}

function buildXlsxBuffer(params: {
  company_line: string;
  event_code: string;
  value_type: string;
  blank_when_zero: boolean;
  rows: Array<{
    full_name: string;
    payroll_code: string | null;
    registration_number: string | null;
    role: string | null;
    section_code: string | null;
    section_name: string | null;
    amount_cents: number;
  }>;
}): Uint8Array {
  // require dinamicamente para não puxar em cliente
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");
  const ws: any = {};

  const setCell = (addr: string, value: any, opts?: { type?: "s" | "n"; z?: string }) => {
    if (value === "" || value === null || value === undefined) return;
    const cell: any = { v: value };
    if (opts?.type) cell.t = opts.type;
    else cell.t = typeof value === "number" ? "n" : "s";
    if (opts?.z) cell.z = opts.z;
    ws[addr] = cell;
  };

  // Linha 1: B = empresa
  setCell("B1", params.company_line);
  // Linha 3: I = tipo de valor
  setCell("I3", params.value_type);
  // Linha 4: cabeçalhos
  const headers = ["FUNCIONÁRIO", "CODIGO", "MATRICULA", "", "NOME TOM.", "FUNÇÃO", "COD. SEÇÃO", "NOME SEÇÃO", "CO-PART TITULAR"];
  const cols = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  headers.forEach((h, i) => setCell(`${cols[i]}4`, h));
  // Linha 5: I = código do evento
  setCell("I5", params.event_code);

  // Dados a partir da linha 6
  const moneyFmt = 'R$ #,##0.00;-R$ #,##0.00';
  let r = 6;
  for (const row of params.rows) {
    setCell(`A${r}`, row.full_name);
    setCell(`B${r}`, row.payroll_code ?? "");
    setCell(`C${r}`, row.registration_number ?? "");
    // D fica vazio
    // E: nome tomador - não temos este campo hoje; deixa vazio
    setCell(`F${r}`, row.role ?? "");
    setCell(`G${r}`, row.section_code ?? "");
    setCell(`H${r}`, row.section_name ?? "");
    const valueReais = row.amount_cents / 100;
    if (row.amount_cents === 0 && params.blank_when_zero) {
      // deixa em branco
    } else {
      setCell(`I${r}`, Number(valueReais.toFixed(2)), { type: "n", z: moneyFmt });
    }
    r++;
  }

  const lastRow = Math.max(r - 1, 5);
  ws["!ref"] = `A1:I${lastRow}`;
  ws["!cols"] = [
    { wch: 38 }, { wch: 10 }, { wch: 12 }, { wch: 4 },
    { wch: 24 }, { wch: 22 }, { wch: 10 }, { wch: 26 }, { wch: 16 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 4 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Coparticipação");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(buf);
}

/**
 * Gera XLSX contábil do mês. mode = 'preview' | 'closed'.
 * - preview: usa ledger atual/projetado, arquivo com prefixo 'previa_'
 * - closed:  exige mês fechado, gera arquivo definitivo e registra em payroll_exports
 */
export const generatePayrollXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    payroll_month: z.string(),
    mode: z.enum(["preview", "closed"]).default("preview"),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");

    const month = toMonthISO(data.payroll_month);
    const settings = await loadAccountingSettings(context.supabase);

    const [empRes, ledgerRes] = await Promise.all([
      context.supabase
        .from("employees")
        .select("id, full_name, payroll_code, registration_number, role, section_code, section_name, status")
        .eq("status", "active")
        .order("full_name"),
      context.supabase
        .from("payroll_monthly_ledger")
        .select("employee_id, amount_to_deduct_cents, status")
        .eq("payroll_month", month),
    ]);
    if (empRes.error) throw new Error(empRes.error.message);
    if (ledgerRes.error) throw new Error(ledgerRes.error.message);

    const employees = empRes.data ?? [];
    const ledger = ledgerRes.data ?? [];

    if (ledger.length === 0) {
      throw new Error("Mês sem ledger. Gere a prévia antes de exportar.");
    }

    const ledgerByEmp = new Map(ledger.map((l: any) => [l.employee_id, l]));

    if (data.mode === "closed") {
      const anyClosed = ledger.some((l: any) => l.status === "closed" || l.status === "exported");
      if (!anyClosed) {
        throw new Error("Mês ainda não foi fechado. Feche o mês antes de gerar o XLSX oficial.");
      }
    }

    // Monta linhas (respeita include_zero_rows). Bloqueia se algum valor negativo.
    const rows: Array<any> = [];
    const warnings: string[] = [];
    for (const emp of employees) {
      const l: any = ledgerByEmp.get(emp.id);
      const amount = l?.amount_to_deduct_cents ?? 0;
      if (amount < 0) {
        throw new Error(`Valor negativo detectado para ${emp.full_name}. Exportação bloqueada.`);
      }
      if (!emp.payroll_code) warnings.push(`Sem payroll_code: ${emp.full_name}`);
      if (amount === 0 && !settings.include_zero_rows) continue;
      rows.push({
        full_name: emp.full_name,
        payroll_code: emp.payroll_code,
        registration_number: emp.registration_number,
        role: emp.role,
        section_code: emp.section_code,
        section_name: emp.section_name,
        amount_cents: amount,
      });
    }

    const totalAmountCents = rows.reduce((s, r) => s + r.amount_cents, 0);

    const buffer = buildXlsxBuffer({
      company_line: settings.company_line,
      event_code: settings.event_code,
      value_type: settings.value_type,
      blank_when_zero: settings.blank_when_zero,
      rows,
    });

    const [year, mon] = month.split("-");
    const prefix = data.mode === "closed" ? "coparticipacao_contabilidade" : "coparticipacao_previa";
    const fileName = `${prefix}_${year}_${mon}.xlsx`;
    const storagePath = `${year}/${mon}/${Date.now()}_${fileName}`;

    const upload = await context.supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });
    if (upload.error) throw new Error(`Falha ao salvar arquivo: ${upload.error.message}`);

    let exportId: string | null = null;

    if (data.mode === "closed") {
      // Localiza o payroll_exports do fechamento (mais recente do mês) e atualiza
      const { data: existing, error: exErr } = await context.supabase
        .from("payroll_exports")
        .select("*")
        .eq("payroll_month", month)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);

      if (existing) {
        const { error: updErr } = await context.supabase
          .from("payroll_exports")
          .update({
            file_storage_path: storagePath,
            total_employees: rows.length,
            total_amount_cents: totalAmountCents,
            status: "exported",
            notes: "XLSX contábil gerado.",
          })
          .eq("id", existing.id);
        if (updErr) throw new Error(`Falha ao atualizar export: ${updErr.message}`);
        exportId = existing.id;

        // Marca ledger como exported
        const { error: ledUpdErr } = await context.supabase
          .from("payroll_monthly_ledger")
          .update({ status: "exported", export_id: existing.id })
          .eq("payroll_month", month)
          .in("status", ["closed"]);
        if (ledUpdErr) throw new Error(`Falha ao marcar ledger: ${ledUpdErr.message}`);
      } else {
        // Não deveria acontecer (mode closed exige mês fechado), mas cria registro
        const { data: ins, error: insErr } = await context.supabase
          .from("payroll_exports")
          .insert({
            payroll_month: month,
            generated_by: context.userId,
            file_storage_path: storagePath,
            total_employees: rows.length,
            total_amount_cents: totalAmountCents,
            layout_version: "contabilidade_v1",
            status: "exported",
          })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        exportId = ins.id;
      }

      await logAudit(context.supabase, context.userId, {
        action: "payroll.xlsx.generate",
        entityType: "payroll_export",
        entityId: exportId,
        afterSnapshot: {
          payroll_month: month,
          mode: data.mode,
          file_name: fileName,
          total_employees: rows.length,
          total_amount_cents: totalAmountCents,
        },
      });
    } else {
      await logAudit(context.supabase, context.userId, {
        action: "payroll.xlsx.preview",
        entityType: "payroll_month",
        entityId: null,
        afterSnapshot: {
          payroll_month: month,
          file_name: fileName,
          total_employees: rows.length,
          total_amount_cents: totalAmountCents,
        },
      });
    }

    // Signed URL de curta duração
    const signed = await context.supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 300);
    if (signed.error) throw new Error(`Falha ao gerar link: ${signed.error.message}`);

    return {
      export_id: exportId,
      mode: data.mode,
      file_name: fileName,
      storage_path: storagePath,
      total_employees: rows.length,
      total_amount_cents: totalAmountCents,
      download_url: signed.data.signedUrl,
      warnings,
    };
  });

export const getPayrollExportDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ export_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);

    const { data: row, error } = await context.supabase
      .from("payroll_exports")
      .select("id, file_storage_path, payroll_month")
      .eq("id", data.export_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || !row.file_storage_path) throw new Error("Exportação sem arquivo associado.");

    const signed = await context.supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.file_storage_path, 300);
    if (signed.error) throw new Error(signed.error.message);

    return { download_url: signed.data.signedUrl };
  });
