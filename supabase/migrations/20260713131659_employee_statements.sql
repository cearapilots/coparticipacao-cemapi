-- =========================================================================
-- Demonstrativo individual do colaborador (PDF financeiro, sem dados
-- médicos): bucket privado + tabela de registro dos exports.
-- Idempotente — seguro para rodar mais de uma vez.
-- =========================================================================

-- ---------------------------------------------------------------------
-- 1. Bucket privado 'employee-statements'
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-statements', 'employee-statements', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS employee_statements_select_admin_rh ON storage.objects;
CREATE POLICY employee_statements_select_admin_rh ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'employee-statements' AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'rh'::public.app_role]));

DROP POLICY IF EXISTS employee_statements_insert_admin_rh ON storage.objects;
CREATE POLICY employee_statements_insert_admin_rh ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-statements' AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'rh'::public.app_role]));

DROP POLICY IF EXISTS employee_statements_update_admin_rh ON storage.objects;
CREATE POLICY employee_statements_update_admin_rh ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'employee-statements' AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'rh'::public.app_role]))
  WITH CHECK (bucket_id = 'employee-statements' AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'rh'::public.app_role]));

DROP POLICY IF EXISTS employee_statements_delete_admin ON storage.objects;
CREATE POLICY employee_statements_delete_admin ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'employee-statements' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------
-- 2. Tabela de registro dos exports (só cria se não existir)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_statement_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  reference_month date NOT NULL,
  generated_by uuid REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  file_storage_path text,
  status text NOT NULL DEFAULT 'generated',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_statement_exports_emp_idx ON public.employee_statement_exports (employee_id, generated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_statement_exports TO authenticated;
GRANT ALL ON public.employee_statement_exports TO service_role;
ALTER TABLE public.employee_statement_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_statement_exports_read_admin_rh ON public.employee_statement_exports;
CREATE POLICY employee_statement_exports_read_admin_rh ON public.employee_statement_exports FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin', 'rh']::public.app_role[]));

DROP POLICY IF EXISTS employee_statement_exports_write_admin_rh ON public.employee_statement_exports;
CREATE POLICY employee_statement_exports_write_admin_rh ON public.employee_statement_exports FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin', 'rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin', 'rh']::public.app_role[]));
