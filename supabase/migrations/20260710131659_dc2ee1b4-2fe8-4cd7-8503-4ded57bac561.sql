
-- Seed/upsert das configurações contábeis
INSERT INTO public.app_settings (setting_key, setting_value, description) VALUES
  ('accounting_event_code', to_jsonb('543'::text), 'Código do evento/rubrica na coluna I do XLSX contábil'),
  ('accounting_value_type', to_jsonb('V'::text), 'Tipo de valor (linha 3, coluna I)'),
  ('accounting_export_include_zero_rows', to_jsonb(true), 'Incluir colaboradores sem desconto no XLSX'),
  ('accounting_export_blank_when_zero', to_jsonb(true), 'Deixar coluna I em branco quando valor = 0'),
  ('accounting_company_line', to_jsonb('1 - CEARA MARINE PILOTS EMPRESA DE PRATIC. DO EST. DO CEARA LTDA'::text), 'Texto da linha 1, coluna B do XLSX contábil')
ON CONFLICT (setting_key) DO NOTHING;

-- Policies para bucket payroll-exports
CREATE POLICY payroll_exports_read_auth
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payroll-exports');

CREATE POLICY payroll_exports_insert_rh
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payroll-exports'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  );

CREATE POLICY payroll_exports_update_rh
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'payroll-exports'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  );

CREATE POLICY payroll_exports_delete_admin
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payroll-exports'
    AND public.has_role(auth.uid(), 'admin')
  );
