-- =========================================================================
-- Hotfix: "permission denied for function has_role" on the self-hosted
-- Supabase project.
--
-- has_role/has_any_role are SECURITY DEFINER with search_path=public (safe),
-- but this project's default privileges revoke EXECUTE on new functions from
-- PUBLIC, so only service_role could call them. Every RLS policy on tables
-- and storage.objects calls one of these two functions, so authenticated
-- users (admin/rh/leitura) got "permission denied" on any write path.
--
-- Idempotent: GRANT can be re-run safely.
-- =========================================================================
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, anon;
