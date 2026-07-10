import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Log de auditoria. NÃO armazenar dados sensíveis (procedimentos, prestadores,
 * detalhes clínicos). Apenas metadata financeira/administrativa.
 */
export async function logAudit(
  supabase: SupabaseClient<Database>,
  actorUserId: string,
  params: {
    action: string;
    entityType: string;
    entityId?: string | null;
    beforeSnapshot?: unknown;
    afterSnapshot?: unknown;
  },
): Promise<void> {
  await supabase.from("audit_log").insert({
    actor_user_id: actorUserId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    before_snapshot: (params.beforeSnapshot ?? null) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    after_snapshot: (params.afterSnapshot ?? null) as any,
  });
}
