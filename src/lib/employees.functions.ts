import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeName } from "./calc/name";

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [empRes, aliasRes] = await Promise.all([
      context.supabase.from("employees").select("*").order("full_name", { ascending: true }),
      context.supabase.from("employee_aliases").select("employee_id, alias_name, normalized_alias_name"),
    ]);
    if (empRes.error) throw empRes.error;
    const byEmp = new Map<string, { alias_name: string; normalized_alias_name: string }[]>();
    for (const a of aliasRes.data ?? []) {
      const list = byEmp.get(a.employee_id) ?? [];
      list.push({ alias_name: a.alias_name, normalized_alias_name: a.normalized_alias_name });
      byEmp.set(a.employee_id, list);
    }
    return (empRes.data ?? []).map((e) => ({ ...e, aliases: byEmp.get(e.id) ?? [] }));
  });

export const getEmployee = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const [emp, aliases] = await Promise.all([
      context.supabase.from("employees").select("*").eq("id", data.id).maybeSingle(),
      context.supabase.from("employee_aliases").select("*").eq("employee_id", data.id).order("alias_name"),
    ]);
    if (emp.error) throw emp.error;
    if (!emp.data) throw new Error("Colaborador não encontrado");
    return { employee: emp.data, aliases: aliases.data ?? [] };
  });

const employeeInput = z.object({
  id: z.string().uuid().optional(),
  full_name: z.string().min(2),
  payroll_code: z.string().optional().nullable(),
  registration_number: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  section_code: z.string().optional().nullable(),
  section_name: z.string().optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
  admission_date: z.string().optional().nullable(),
  termination_date: z.string().optional().nullable(),
});

export const upsertEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => employeeInput.parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { logAudit } = await import("./audit.server");

    const payload = {
      full_name: data.full_name,
      normalized_name: normalizeName(data.full_name),
      payroll_code: data.payroll_code || null,
      registration_number: data.registration_number || null,
      role: data.role || null,
      section_code: data.section_code || null,
      section_name: data.section_name || null,
      status: data.status,
      admission_date: data.admission_date || null,
      termination_date: data.termination_date || null,
    };

    if (data.id) {
      const { data: before } = await context.supabase.from("employees").select("*").eq("id", data.id).maybeSingle();
      const { data: updated, error } = await context.supabase
        .from("employees").update(payload).eq("id", data.id).select("*").single();
      if (error) throw error;
      await logAudit(context.supabase, context.userId, {
        action: "employee.update", entityType: "employee", entityId: data.id,
        beforeSnapshot: before, afterSnapshot: updated,
      });
      return updated;
    }
    const { data: created, error } = await context.supabase
      .from("employees").insert(payload).select("*").single();
    if (error) throw error;
    await logAudit(context.supabase, context.userId, {
      action: "employee.create", entityType: "employee", entityId: created.id,
      afterSnapshot: created,
    });
    return created;
  });

export const upsertAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    employee_id: z.string().uuid(),
    alias_name: z.string().min(2),
    source: z.string().optional().nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const payload = {
      employee_id: data.employee_id,
      alias_name: data.alias_name,
      normalized_alias_name: normalizeName(data.alias_name),
      source: data.source || null,
    };
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("employee_aliases").update(payload).eq("id", data.id).select("*").single();
      if (error) throw error;
      return updated;
    }
    const { data: created, error } = await context.supabase
      .from("employee_aliases").insert(payload).select("*").single();
    if (error) throw error;
    return created;
  });

export const deleteAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin", "rh"]);
    const { error } = await context.supabase.from("employee_aliases").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
