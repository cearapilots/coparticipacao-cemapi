
-- =========================================================================
-- 1. ROLES & PROFILES
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'rh', 'leitura');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

CREATE POLICY "user_roles_self_select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile + bootstrap first user as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_first boolean;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;

  SELECT NOT EXISTS(SELECT 1 FROM public.user_roles) INTO is_first;
  IF is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'leitura')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- 2. UTIL: updated_at trigger
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =========================================================================
-- 3. EMPLOYEES + ALIASES
-- =========================================================================
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_code text,
  registration_number text,
  full_name text NOT NULL,
  normalized_name text NOT NULL,
  role text,
  section_code text,
  section_name text,
  status text NOT NULL DEFAULT 'active',
  admission_date date,
  termination_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employees_normalized_name_idx ON public.employees (normalized_name);
CREATE INDEX employees_status_idx ON public.employees (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_read_all_auth" ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "employees_write_rh" ON public.employees FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE POLICY "employees_update_rh" ON public.employees FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE POLICY "employees_delete_admin" ON public.employees FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.employee_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  normalized_alias_name text NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_aliases_norm_idx ON public.employee_aliases (normalized_alias_name);
CREATE INDEX employee_aliases_emp_idx ON public.employee_aliases (employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_aliases TO authenticated;
GRANT ALL ON public.employee_aliases TO service_role;
ALTER TABLE public.employee_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aliases_read_all_auth" ON public.employee_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "aliases_write_rh" ON public.employee_aliases FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE TRIGGER employee_aliases_updated_at BEFORE UPDATE ON public.employee_aliases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 4. MONTHLY USAGE
-- =========================================================================
CREATE TABLE public.monthly_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  competence_month date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  source_type text NOT NULL DEFAULT 'manual',
  source_reference_id uuid,
  status text NOT NULL DEFAULT 'confirmed',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX monthly_usage_emp_month_idx ON public.monthly_usage (employee_id, competence_month);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_usage TO authenticated;
GRANT ALL ON public.monthly_usage TO service_role;
ALTER TABLE public.monthly_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_read_all_auth" ON public.monthly_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY "usage_write_rh" ON public.monthly_usage FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE TRIGGER monthly_usage_updated_at BEFORE UPDATE ON public.monthly_usage FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 5. INSTALLMENT PLANS
-- =========================================================================
CREATE TABLE public.installment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  monthly_usage_id uuid REFERENCES public.monthly_usage(id) ON DELETE CASCADE,
  source_type text NOT NULL, -- 'monthly_usage' | 'opening_balance' | 'adjustment'
  total_amount_cents integer NOT NULL CHECK (total_amount_cents >= 0),
  installment_count integer NOT NULL CHECK (installment_count > 0),
  first_due_month date NOT NULL,
  rule_version text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX installment_plans_emp_idx ON public.installment_plans (employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installment_plans TO authenticated;
GRANT ALL ON public.installment_plans TO service_role;
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_read_all_auth" ON public.installment_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "plans_write_rh" ON public.installment_plans FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE TRIGGER installment_plans_updated_at BEFORE UPDATE ON public.installment_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.installment_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_plan_id uuid NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  competence_month date,
  due_month date NOT NULL,
  installment_number integer NOT NULL,
  installment_count integer NOT NULL,
  scheduled_amount_cents integer NOT NULL CHECK (scheduled_amount_cents >= 0),
  status text NOT NULL DEFAULT 'projected',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_items_emp_due_idx ON public.installment_plan_items (employee_id, due_month);
CREATE INDEX plan_items_plan_idx ON public.installment_plan_items (installment_plan_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installment_plan_items TO authenticated;
GRANT ALL ON public.installment_plan_items TO service_role;
ALTER TABLE public.installment_plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_items_read_all_auth" ON public.installment_plan_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "plan_items_write_rh" ON public.installment_plan_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE TRIGGER plan_items_updated_at BEFORE UPDATE ON public.installment_plan_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 6. PAYROLL LEDGER + EXPORTS
-- =========================================================================
CREATE TABLE public.payroll_monthly_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  payroll_month date NOT NULL,
  scheduled_amount_cents integer NOT NULL DEFAULT 0,
  carryover_in_cents integer NOT NULL DEFAULT 0,
  gross_due_cents integer NOT NULL DEFAULT 0,
  cap_cents integer NOT NULL DEFAULT 70000,
  amount_to_deduct_cents integer NOT NULL DEFAULT 0,
  carryover_out_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'projected', -- projected | closed | exported
  closed_at timestamptz,
  exported_at timestamptz,
  export_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, payroll_month)
);
CREATE INDEX ledger_month_idx ON public.payroll_monthly_ledger (payroll_month);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_monthly_ledger TO authenticated;
GRANT ALL ON public.payroll_monthly_ledger TO service_role;
ALTER TABLE public.payroll_monthly_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledger_read_all_auth" ON public.payroll_monthly_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY "ledger_write_rh" ON public.payroll_monthly_ledger FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE TRIGGER ledger_updated_at BEFORE UPDATE ON public.payroll_monthly_ledger FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payroll_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_month date NOT NULL,
  generated_by uuid REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  file_storage_path text,
  total_employees integer,
  total_amount_cents integer,
  layout_version text,
  status text NOT NULL DEFAULT 'generated', -- generated | closed
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_exports TO authenticated;
GRANT ALL ON public.payroll_exports TO service_role;
ALTER TABLE public.payroll_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exports_read_all_auth" ON public.payroll_exports FOR SELECT TO authenticated USING (true);
CREATE POLICY "exports_write_rh" ON public.payroll_exports FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE TRIGGER exports_updated_at BEFORE UPDATE ON public.payroll_exports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payroll_export_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_export_id uuid NOT NULL REFERENCES public.payroll_exports(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  payroll_month date NOT NULL,
  amount_to_deduct_cents integer NOT NULL,
  carryover_in_cents integer DEFAULT 0,
  carryover_out_cents integer DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX export_items_export_idx ON public.payroll_export_items (payroll_export_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_export_items TO authenticated;
GRANT ALL ON public.payroll_export_items TO service_role;
ALTER TABLE public.payroll_export_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "export_items_read_all_auth" ON public.payroll_export_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "export_items_write_rh" ON public.payroll_export_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

-- =========================================================================
-- 7. IMPORT STAGING (PDF UNIMED - futuro)
-- =========================================================================
CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL DEFAULT 'unimed_pdf',
  source_file_name text,
  source_file_hash text,
  source_file_storage_path text,
  billing_month date,
  service_reference_month date,
  competence_month date,
  first_due_month date,
  total_cobrado_empresa_cents integer, -- para conferência
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'draft', -- draft | needs_review | confirmed | discarded
  total_items integer,
  total_amount_cents integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import_batches_read_all_auth" ON public.import_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "import_batches_write_rh" ON public.import_batches FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE TRIGGER import_batches_updated_at BEFORE UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  raw_employee_name text,        -- nome do TITULAR extraído
  raw_employee_identifier text,
  matched_employee_id uuid REFERENCES public.employees(id),
  match_confidence numeric,
  match_status text,              -- matched | needs_review | unmatched
  amount_cents integer,           -- valor de "Total da Família"
  raw_text_reference text,        -- referência bruta ao bloco de texto (sem detalhes clínicos)
  review_status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_items_batch_idx ON public.import_items (import_batch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_items TO authenticated;
GRANT ALL ON public.import_items TO service_role;
ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import_items_read_all_auth" ON public.import_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "import_items_write_rh" ON public.import_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE TRIGGER import_items_updated_at BEFORE UPDATE ON public.import_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 8. APP SETTINGS
-- =========================================================================
CREATE TABLE public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read_all_auth" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_write_admin" ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (setting_key, setting_value, description) VALUES
  ('monthly_cap_cents', '70000'::jsonb, 'Teto mensal de desconto por colaborador (em centavos)'),
  ('installment_thresholds', '[
    {"min_cents":0,"max_cents":15000,"installment_count":1,"first_due_policy":"next_month"},
    {"min_cents":15001,"max_cents":25000,"installment_count":2,"first_due_policy":"same_month"},
    {"min_cents":25001,"max_cents":null,"installment_count":3,"first_due_policy":"same_month"}
  ]'::jsonb, 'Faixas de parcelamento por valor'),
  ('matching_confidence_threshold', '0.85'::jsonb, 'Limiar mínimo de confiança para auto-match de nomes'),
  ('company_name', '"Empresa"'::jsonb, 'Nome da empresa em relatórios'),
  ('export_layout_version', '"v1"'::jsonb, 'Versão do layout de exportação contábil');

-- =========================================================================
-- 9. AUDIT LOG
-- =========================================================================
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON public.audit_log (entity_type, entity_id);
CREATE INDEX audit_log_created_idx ON public.audit_log (created_at DESC);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_read_admin_rh" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE POLICY "audit_insert_auth" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());
