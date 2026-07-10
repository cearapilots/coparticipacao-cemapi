
-- RLS policies for storage bucket "unimed-pdfs" (private)
CREATE POLICY "unimed_pdfs_rh_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'unimed-pdfs' AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'rh'::app_role, 'leitura'::app_role]));

CREATE POLICY "unimed_pdfs_rh_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'unimed-pdfs' AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'rh'::app_role]));

CREATE POLICY "unimed_pdfs_rh_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'unimed-pdfs' AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'rh'::app_role]))
  WITH CHECK (bucket_id = 'unimed-pdfs' AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'rh'::app_role]));

CREATE POLICY "unimed_pdfs_rh_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'unimed-pdfs' AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'rh'::app_role]));
