/**
 * Helpers server-only para verificação de papel.
 * Nunca importar isto de código cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = "admin" | "rh" | "leitura";

export async function getUserRoles(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<AppRole[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.role as AppRole);
}

export async function requireAnyRole(
  supabase: SupabaseClient<Database>,
  userId: string,
  roles: AppRole[],
): Promise<void> {
  const has = await getUserRoles(supabase, userId);
  if (!has.some((r) => roles.includes(r))) {
    throw new Error("Forbidden: papel insuficiente para esta operação");
  }
}
