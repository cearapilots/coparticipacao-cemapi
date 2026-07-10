import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toMonthISO } from "./calc/date";

/**
 * Prévia de fechamento: lista todos colaboradores ativos com composição do mês.
 * NÃO altera nada.
 */
export const previewMonthClosing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ payroll_month: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const month = toMonthISO(data.payroll_month);

    const { recalculateEmployeeLedger } = await import("./ledger.server");

    // Garante ledger atualizado para todos os ativos antes da prévia
    const { data: employees, error: eErr } = await context.supabase
      .from("employees").select("id, full_name, payroll_code, registration_number, section_name, status")
      .eq("status", "active").order("full_name");
    if (eErr) throw eErr;

    for (const emp of employees ?? []) {
      await recalculateEmployeeLedger(context.supabase, emp.id, month);
    }

    const { data: ledger } = await context.supabase
      .from("payroll_monthly_ledger")
      .select("*")
      .eq("payroll_month", month);

    const byEmployee = new Map((ledger ?? []).map((r) => [r.employee_id, r]));

    const rows = (employees ?? []).map((emp) => {
      const row = byEmployee.get(emp.id);
      return {
        employee_id: emp.id,
        full_name: emp.full_name,
        payroll_code: emp.payroll_code,
        registration_number: emp.registration_number,
        section_name: emp.section_name,
        scheduled_amount_cents: row?.scheduled_amount_cents ?? 0,
        carryover_in_cents: row?.carryover_in_cents ?? 0,
        gross_due_cents: row?.gross_due_cents ?? 0,
        cap_cents: row?.cap_cents ?? 70000,
        amount_to_deduct_cents: row?.amount_to_deduct_cents ?? 0,
        carryover_out_cents: row?.carryover_out_cents ?? 0,
        status: row?.status ?? "projected",
        capped: (row?.gross_due_cents ?? 0) > (row?.cap_cents ?? 70000),
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        total_deduct: acc.total_deduct + r.amount_to_deduct_cents,
        total_carryover_out: acc.total_carryover_out + r.carryover_out_cents,
        total_carryover_in: acc.total_carryover_in + r.carryover_in_cents,
        capped_count: acc.capped_count + (r.capped ? 1 : 0),
        active_count: acc.active_count + (r.amount_to_deduct_cents > 0 ? 1 : 0),
      }),
      { total_deduct: 0, total_carryover_out: 0, total_carryover_in: 0, capped_count: 0, active_count: 0 },
    );

    return { month, rows, totals };
  });

/**
 * Fecha o mês: marca ledger como 'closed', cria snapshot em payroll_exports + itens.
 * A geração binária do XLSX fica para a próxima iteração (só snapshot aqui).
 */
export const closeMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ payroll_month: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");
    const { recalculateEmployeeLedger } = await import("./ledger.server");

    const month = toMonthISO(data.payroll_month);

    // Atualiza ledger de todos ativos primeiro
    const { data: employees } = await context.supabase
      .from("employees").select("id").eq("status", "active");
    for (const emp of employees ?? []) {
      await recalculateEmployeeLedger(context.supabase, emp.id, month);
    }

    const { data: ledger } = await context.supabase
      .from("payroll_monthly_ledger").select("*").eq("payroll_month", month);
    const rows = ledger ?? [];

    // Bloqueia se já houver fechado
    if (rows.some((r) => r.status === "closed" || r.status === "exported")) {
      throw new Error("Este mês já foi fechado.");
    }

    const { data: layoutSetting } = await context.supabase
      .from("app_settings").select("setting_value").eq("setting_key", "export_layout_version").maybeSingle();
    const layoutVersion = typeof layoutSetting?.setting_value === "string" ? layoutSetting.setting_value : "v1";

    const totalAmount = rows.reduce((s, r) => s + (r.amount_to_deduct_cents ?? 0), 0);

    const { data: exportRow, error: exErr } = await context.supabase
      .from("payroll_exports").insert({
        payroll_month: month,
        generated_by: context.userId,
        total_employees: rows.length,
        total_amount_cents: totalAmount,
        layout_version: layoutVersion,
        status: "closed",
        notes: "Fechamento — snapshot. Geração de XLSX pendente na próxima iteração.",
      }).select("*").single();
    if (exErr) throw exErr;

    if (rows.length > 0) {
      await context.supabase.from("payroll_export_items").insert(
        rows.map((r) => ({
          payroll_export_id: exportRow.id,
          employee_id: r.employee_id,
          payroll_month: month,
          amount_to_deduct_cents: r.amount_to_deduct_cents ?? 0,
          carryover_in_cents: r.carryover_in_cents ?? 0,
          carryover_out_cents: r.carryover_out_cents ?? 0,
        })),
      );

      await context.supabase
        .from("payroll_monthly_ledger")
        .update({ status: "closed", closed_at: new Date().toISOString(), export_id: exportRow.id })
        .eq("payroll_month", month)
        .in("id", rows.map((r) => r.id));
    }

    await logAudit(context.supabase, context.userId, {
      action: "month.close",
      entityType: "payroll_export",
      entityId: exportRow.id,
      afterSnapshot: {
        payroll_month: month,
        total_employees: rows.length,
        total_amount_cents: totalAmount,
      },
    });

    return { export_id: exportRow.id, total_amount_cents: totalAmount, total_employees: rows.length };
  });

export const listPayrollExports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("payroll_exports").select("*").order("payroll_month", { ascending: false }).limit(24);
    if (error) throw error;
    return data ?? [];
  });
