import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Somente leitura. O ledger é recalculado nas OPERAÇÕES que o alteram
// (confirmar lote, lançamento, saldo inicial, re-parcelamento, teto por mês),
// então aqui apenas lemos o que já está gravado. Isso evita escrever a cada
// visualização e mantém a página do colaborador consistente com Dashboard e
// Fechamento, que também leem o ledger gravado.
export const getEmployeeDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const [emp, aliases, usages, plans, items, ledger] = await Promise.all([
      context.supabase.from("employees").select("*").eq("id", data.id).maybeSingle(),
      context.supabase.from("employee_aliases").select("*").eq("employee_id", data.id).order("alias_name"),
      context.supabase.from("monthly_usage").select("*").eq("employee_id", data.id).order("competence_month", { ascending: false }),
      context.supabase.from("installment_plans").select("*").eq("employee_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("installment_plan_items").select("*").eq("employee_id", data.id).order("due_month"),
      context.supabase.from("payroll_monthly_ledger").select("*").eq("employee_id", data.id).order("payroll_month"),
    ]);
    if (emp.error) throw emp.error;
    if (!emp.data) throw new Error("Colaborador não encontrado");

    return {
      employee: emp.data,
      aliases: aliases.data ?? [],
      monthly_usages: usages.data ?? [],
      installment_plans: plans.data ?? [],
      installment_items: items.data ?? [],
      ledger: ledger.data ?? [],
    };
  });
