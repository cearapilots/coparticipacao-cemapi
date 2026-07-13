-- =========================================================================
-- Hotfix: tela "Usuários e papéis" só mostrava o próprio usuário logado.
--
-- public.profiles só tinha policy de SELECT para o próprio registro
-- (auth.uid() = id) — sem policy para admin ver todos. list_users() já
-- fazia a query certa (select * from profiles), mas a RLS limitava o
-- resultado a 1 linha mesmo para admin. Múltiplas policies permissivas de
-- SELECT são combinadas com OR, então isto apenas adiciona uma segunda via
-- de acesso, sem remover a auto-leitura existente.
--
-- Idempotente: DROP POLICY IF EXISTS antes de recriar.
-- =========================================================================
DROP POLICY IF EXISTS profiles_admin_select_all ON public.profiles;
CREATE POLICY profiles_admin_select_all ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
