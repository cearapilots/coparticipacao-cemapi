import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Lista a trilha de auditoria (somente admin). O audit_log é insert-only;
 * aqui é apenas leitura para conferência/governança.
 */
export const listAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    limit: z.number().int().min(1).max(500).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAnyRole } = await import("./authz.server");
    await requireAnyRole(context.supabase, context.userId, ["admin"]);

    const { data: rows, error } = await context.supabase
      .from("audit_log")
      .select("id, actor_user_id, action, entity_type, entity_id, before_snapshot, after_snapshot, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (error) throw error;

    // Resolve o e-mail do ator (audit_log.actor_user_id → profiles.id).
    // Sem FK direta, então resolvemos em JS. Admin enxerga todos os profiles.
    const actorIds = [...new Set((rows ?? []).map((r) => r.actor_user_id).filter((v): v is string => !!v))];
    let byId = new Map<string, { email: string | null; full_name: string | null }>();
    if (actorIds.length > 0) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", actorIds);
      byId = new Map((profiles ?? []).map((p) => [p.id, { email: p.email, full_name: p.full_name }]));
    }

    return (rows ?? []).map((r) => ({
      ...r,
      actor_email: r.actor_user_id ? (byId.get(r.actor_user_id)?.email ?? null) : null,
      actor_name: r.actor_user_id ? (byId.get(r.actor_user_id)?.full_name ?? null) : null,
    }));
  });
