
-- payroll-exports: restringir SELECT a admin/rh (antes: qualquer authenticated)
DROP POLICY IF EXISTS payroll_exports_read_auth ON storage.objects;
CREATE POLICY payroll_exports_read_admin_rh ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payroll-exports' AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'rh'::public.app_role]));

-- unimed-pdfs: SELECT apenas admin/rh (remover 'leitura')
DROP POLICY IF EXISTS unimed_pdfs_rh_select ON storage.objects;
CREATE POLICY unimed_pdfs_rh_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'unimed-pdfs' AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'rh'::public.app_role]));

-- unimed-pdfs: DELETE apenas admin
DROP POLICY IF EXISTS unimed_pdfs_rh_delete ON storage.objects;
CREATE POLICY unimed_pdfs_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'unimed-pdfs' AND public.has_role(auth.uid(), 'admin'::public.app_role));
