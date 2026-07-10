import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles").select("role").eq("user_id", context.userId);
    return (data ?? []).map((r) => r.role as string);
  });

export const listSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("app_settings").select("*").order("setting_key");
    if (error) throw error;
    return data ?? [];
  });

export const updateSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    setting_key: z.string(),
    setting_value: z.any(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("../lib/authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin"]);
    const { logAudit } = await import("../lib/audit.server");

    const { data: before } = await context.supabase
      .from("app_settings").select("*").eq("setting_key", data.setting_key).maybeSingle();

    const { data: updated, error } = await context.supabase
      .from("app_settings")
      .update({ setting_value: data.setting_value, updated_by: context.userId })
      .eq("setting_key", data.setting_key).select("*").single();
    if (error) throw error;

    await logAudit(context.supabase, context.userId, {
      action: "setting.update", entityType: "app_setting", entityId: updated.id,
      beforeSnapshot: before, afterSnapshot: updated,
    });
    return updated;
  });

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAnyRole } = await import("../lib/authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin"]);

    const [profiles, roles] = await Promise.all([
      context.supabase.from("profiles").select("*").order("email"),
      context.supabase.from("user_roles").select("*"),
    ]);
    const rolesByUser = new Map<string, string[]>();
    for (const r of roles.data ?? []) {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r.role);
      rolesByUser.set(r.user_id, list);
    }
    return (profiles.data ?? []).map((p) => ({ ...p, roles: rolesByUser.get(p.id) ?? [] }));
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    user_id: z.string().uuid(),
    role: z.enum(["admin", "rh", "leitura"]),
    grant: z.boolean(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("../lib/authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin"]);
    const { logAudit } = await import("../lib/audit.server");

    if (data.grant) {
      await context.supabase.from("user_roles")
        .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });
    } else {
      await context.supabase.from("user_roles").delete()
        .eq("user_id", data.user_id).eq("role", data.role);
    }
    await logAudit(context.supabase, context.userId, {
      action: data.grant ? "role.grant" : "role.revoke",
      entityType: "user_role", entityId: data.user_id,
      afterSnapshot: { role: data.role, grant: data.grant },
    });
    return { ok: true };
  });
