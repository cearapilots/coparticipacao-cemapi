import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toMonthISO } from "./calc/date";

export const getDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ month: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const month = toMonthISO(data.month);

    const [usagesRes, ledgerRes, recentUsagesRes, recentExportsRes, pendingBatchesRes] = await Promise.all([
      context.supabase.from("monthly_usage").select("amount_cents").eq("competence_month", month),
      context.supabase
        .from("payroll_monthly_ledger")
        .select("*, employees(full_name, payroll_code)")
        .eq("payroll_month", month),
      context.supabase.from("monthly_usage")
        .select("id, employee_id, competence_month, amount_cents, created_at, employees(full_name)")
        .order("created_at", { ascending: false }).limit(10),
      context.supabase.from("payroll_exports").select("*").order("generated_at", { ascending: false }).limit(5),
      context.supabase.from("import_batches")
        .select("id, source_file_name, competence_month, total_items, uploaded_at")
        .eq("status", "pending_review")
        .order("uploaded_at", { ascending: false }),
    ]);

    const totalNew = (usagesRes.data ?? []).reduce((s, u) => s + (u.amount_cents ?? 0), 0);
    const totalDeduct = (ledgerRes.data ?? []).reduce((s, r) => s + (r.amount_to_deduct_cents ?? 0), 0);
    const totalCarryoverOut = (ledgerRes.data ?? []).reduce((s, r) => s + (r.carryover_out_cents ?? 0), 0);
    const employeesWithDeduct = (ledgerRes.data ?? []).filter((r) => (r.amount_to_deduct_cents ?? 0) > 0).length;
    const employeesCapped = (ledgerRes.data ?? []).filter((r) => (r.gross_due_cents ?? 0) > (r.cap_cents ?? 70000)).length;

    const deductBreakdown = (ledgerRes.data ?? [])
      .filter((r: any) => (r.amount_to_deduct_cents ?? 0) > 0)
      .map((r: any) => ({
        employee_id: r.employee_id,
        full_name: r.employees?.full_name ?? "—",
        payroll_code: r.employees?.payroll_code ?? null,
        amount_to_deduct_cents: r.amount_to_deduct_cents ?? 0,
        has_carryover: (r.carryover_in_cents ?? 0) > 0,
        capped: (r.gross_due_cents ?? 0) > (r.cap_cents ?? 70000),
      }))
      .sort((a: any, b: any) => b.amount_to_deduct_cents - a.amount_to_deduct_cents);

    return {
      month,
      total_new_cents: totalNew,
      total_deduct_cents: totalDeduct,
      total_carryover_out_cents: totalCarryoverOut,
      employees_with_deduct: employeesWithDeduct,
      employees_capped: employeesCapped,
      recent_usages: recentUsagesRes.data ?? [],
      recent_exports: recentExportsRes.data ?? [],
      deduct_breakdown: deductBreakdown,
      pending_batches: pendingBatchesRes.data ?? [],
    };
  });
