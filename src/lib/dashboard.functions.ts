import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toMonthISO } from "./calc/date";

export const getDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ month: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const month = toMonthISO(data.month);

    const [usagesRes, ledgerRes, recentUsagesRes, recentExportsRes] = await Promise.all([
      context.supabase.from("monthly_usage").select("amount_cents").eq("competence_month", month),
      context.supabase.from("payroll_monthly_ledger").select("*").eq("payroll_month", month),
      context.supabase.from("monthly_usage")
        .select("id, employee_id, competence_month, amount_cents, created_at, employees(full_name)")
        .order("created_at", { ascending: false }).limit(10),
      context.supabase.from("payroll_exports").select("*").order("generated_at", { ascending: false }).limit(5),
    ]);

    const totalNew = (usagesRes.data ?? []).reduce((s, u) => s + (u.amount_cents ?? 0), 0);
    const totalDeduct = (ledgerRes.data ?? []).reduce((s, r) => s + (r.amount_to_deduct_cents ?? 0), 0);
    const totalCarryoverOut = (ledgerRes.data ?? []).reduce((s, r) => s + (r.carryover_out_cents ?? 0), 0);
    const employeesWithDeduct = (ledgerRes.data ?? []).filter((r) => (r.amount_to_deduct_cents ?? 0) > 0).length;
    const employeesCapped = (ledgerRes.data ?? []).filter((r) => (r.gross_due_cents ?? 0) > (r.cap_cents ?? 70000)).length;

    return {
      month,
      total_new_cents: totalNew,
      total_deduct_cents: totalDeduct,
      total_carryover_out_cents: totalCarryoverOut,
      employees_with_deduct: employeesWithDeduct,
      employees_capped: employeesCapped,
      recent_usages: recentUsagesRes.data ?? [],
      recent_exports: recentExportsRes.data ?? [],
    };
  });
