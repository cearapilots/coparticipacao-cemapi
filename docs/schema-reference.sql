-- =============================================================================
-- SCHEMA DE REFERÊNCIA — Coparticipação UNIMED
-- =============================================================================
-- Este arquivo documenta o schema atual do banco (Lovable Cloud / Postgres) e
-- serve de base para uma eventual migração para Supabase self-hosted ou Cloud.
--
-- ATENÇÃO:
--   * Este arquivo é REFERÊNCIA. NÃO deve ser executado sobre o banco atual.
--   * Todos os CREATEs usam IF NOT EXISTS — é seguro rodar em banco vazio.
--   * Não contém dados. Para dados, exportar via Cloud → Advanced → Export data.
--   * Ordem: extensões → enums → tabelas → grants → RLS → policies → funções → triggers.
-- =============================================================================

-- ---------- Extensões ----------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'rh', 'leitura');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- TABELAS
-- =============================================================================

-- profiles: espelho de auth.users para dados de UI (preenchida via trigger).
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY,
  email      text,
  full_name  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- user_roles: papel do usuário. Referenciada por has_role/has_any_role.
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  role       public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- employees: colaboradores canônicos.
CREATE TABLE IF NOT EXISTS public.employees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_code        text,
  registration_number text,
  full_name           text NOT NULL,
  normalized_name     text NOT NULL,
  role                text,
  section_code        text,
  section_name        text,
  status              text NOT NULL DEFAULT 'active',
  admission_date      date,
  termination_date    date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_normalized_name_idx ON public.employees (normalized_name);
CREATE INDEX IF NOT EXISTS employees_status_idx          ON public.employees (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- employee_aliases: variações de nome usadas nos PDFs UNIMED.
CREATE TABLE IF NOT EXISTS public.employee_aliases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  alias_name            text NOT NULL,
  normalized_alias_name text NOT NULL,
  source                text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_alias_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_aliases TO authenticated;
GRANT ALL ON public.employee_aliases TO service_role;
ALTER TABLE public.employee_aliases ENABLE ROW LEVEL SECURITY;

-- monthly_usage: lançamento de coparticipação de um mês de competência.
CREATE TABLE IF NOT EXISTS public.monthly_usage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  competence_month    date NOT NULL,
  amount_cents        integer NOT NULL CHECK (amount_cents >= 0),
  source_type         text NOT NULL DEFAULT 'manual', -- manual|unimed_pdf
  source_reference_id uuid,
  status              text NOT NULL DEFAULT 'confirmed',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS monthly_usage_source_uniq_idx
  ON public.monthly_usage (employee_id, competence_month, source_type, source_reference_id)
  WHERE source_reference_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_usage TO authenticated;
GRANT ALL ON public.monthly_usage TO service_role;
ALTER TABLE public.monthly_usage ENABLE ROW LEVEL SECURITY;

-- installment_plans: cabeçalho do plano de parcelamento.
CREATE TABLE IF NOT EXISTS public.installment_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  monthly_usage_id    uuid REFERENCES public.monthly_usage(id) ON DELETE SET NULL,
  source_type         text NOT NULL, -- monthly_usage|opening_balance|adjustment
  total_amount_cents  integer NOT NULL CHECK (total_amount_cents >= 0),
  installment_count   integer NOT NULL CHECK (installment_count >= 1),
  first_due_month     date NOT NULL,
  rule_version        text,
  status              text NOT NULL DEFAULT 'active',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installment_plans TO authenticated;
GRANT ALL ON public.installment_plans TO service_role;
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;

-- installment_plan_items: parcelas individuais.
CREATE TABLE IF NOT EXISTS public.installment_plan_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_plan_id    uuid NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  employee_id            uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  competence_month       date,
  due_month              date NOT NULL,
  installment_number     integer NOT NULL,
  installment_count      integer NOT NULL,
  scheduled_amount_cents integer NOT NULL CHECK (scheduled_amount_cents >= 0),
  status                 text NOT NULL DEFAULT 'projected',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_items_employee_due_idx
  ON public.installment_plan_items (employee_id, due_month);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installment_plan_items TO authenticated;
GRANT ALL ON public.installment_plan_items TO service_role;
ALTER TABLE public.installment_plan_items ENABLE ROW LEVEL SECURITY;

-- payroll_monthly_ledger: ledger consolidado por colaborador × mês.
CREATE TABLE IF NOT EXISTS public.payroll_monthly_ledger (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  payroll_month           date NOT NULL,
  scheduled_amount_cents  integer NOT NULL DEFAULT 0 CHECK (scheduled_amount_cents >= 0),
  carryover_in_cents      integer NOT NULL DEFAULT 0 CHECK (carryover_in_cents >= 0),
  gross_due_cents         integer NOT NULL DEFAULT 0 CHECK (gross_due_cents >= 0),
  cap_cents               integer NOT NULL DEFAULT 70000,
  amount_to_deduct_cents  integer NOT NULL DEFAULT 0 CHECK (amount_to_deduct_cents >= 0),
  carryover_out_cents     integer NOT NULL DEFAULT 0 CHECK (carryover_out_cents >= 0),
  status                  text NOT NULL DEFAULT 'projected', -- projected|closed|exported
  closed_at               timestamptz,
  exported_at             timestamptz,
  export_id               uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, payroll_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_monthly_ledger TO authenticated;
GRANT ALL ON public.payroll_monthly_ledger TO service_role;
ALTER TABLE public.payroll_monthly_ledger ENABLE ROW LEVEL SECURITY;

-- payroll_exports: snapshot de fechamento mensal.
CREATE TABLE IF NOT EXISTS public.payroll_exports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_month       date NOT NULL,
  generated_by        uuid,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  file_storage_path   text,
  total_employees     integer,
  total_amount_cents  integer,
  layout_version      text,
  status              text NOT NULL DEFAULT 'generated',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_exports TO authenticated;
GRANT ALL ON public.payroll_exports TO service_role;
ALTER TABLE public.payroll_exports ENABLE ROW LEVEL SECURITY;

-- payroll_export_items: linhas do snapshot (cópia imutável).
CREATE TABLE IF NOT EXISTS public.payroll_export_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_export_id      uuid NOT NULL REFERENCES public.payroll_exports(id) ON DELETE CASCADE,
  employee_id            uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  payroll_month          date NOT NULL,
  amount_to_deduct_cents integer NOT NULL CHECK (amount_to_deduct_cents >= 0),
  carryover_in_cents     integer DEFAULT 0,
  carryover_out_cents    integer DEFAULT 0,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_export_items TO authenticated;
GRANT ALL ON public.payroll_export_items TO service_role;
ALTER TABLE public.payroll_export_items ENABLE ROW LEVEL SECURITY;

-- import_batches: lote de importação de PDF UNIMED.
CREATE TABLE IF NOT EXISTS public.import_batches (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type                 text NOT NULL DEFAULT 'unimed_pdf',
  source_file_name            text,
  source_file_hash            text,
  source_file_storage_path    text,
  billing_month               date,
  service_reference_month     date,
  competence_month            date,
  first_due_month             date,
  total_charged_company_cents integer,
  uploaded_by                 uuid,
  uploaded_at                 timestamptz NOT NULL DEFAULT now(),
  status                      text NOT NULL DEFAULT 'draft', -- draft|pending_review|confirmed|cancelled
  total_items                 integer,
  total_amount_cents          integer,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

-- import_items: linhas titular → valor extraídas do PDF.
CREATE TABLE IF NOT EXISTS public.import_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id         uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  raw_employee_name       text,
  raw_employee_identifier text,
  matched_employee_id     uuid REFERENCES public.employees(id),
  match_confidence        numeric,
  match_status            text, -- auto_matched|needs_review|manually_matched|not_found
  amount_cents            integer,
  raw_text_reference      text,
  review_status           text NOT NULL DEFAULT 'pending', -- pending|reviewed|ignored
  reviewed_by             uuid,
  reviewed_at             timestamptz,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_items_matched_employee_idx
  ON public.import_items (matched_employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_items TO authenticated;
GRANT ALL ON public.import_items TO service_role;
ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;

-- app_settings: configurações do sistema em JSONB.
CREATE TABLE IF NOT EXISTS public.app_settings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key   text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL,
  description   text,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
-- Chaves esperadas:
--   monthly_cap_cents        : integer (default 70000 = R$700)
--   installment_thresholds   : array de faixas [{min_cents,max_cents,installment_count,first_due_policy}]
--   company_name             : "CEARA MARINE PILOTS"
--   payroll_layout_version   : "contabilidade_v1"

-- audit_log: trilha de auditoria administrativa. NUNCA guardar dados clínicos.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   uuid,
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       uuid,
  before_snapshot jsonb,
  after_snapshot  jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- FUNÇÕES SECURITY DEFINER (base das policies)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_first boolean;
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
END; $$;

-- Trigger em auth.users (aplicar no Supabase novo após migrar):
-- CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- profiles
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- user_roles (admin gere; usuário vê o próprio)
CREATE POLICY user_roles_self_select ON public.user_roles FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY user_roles_admin_all ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Padrão "leitura autenticada + escrita admin/rh"
CREATE POLICY employees_read_all_auth ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY employees_write_rh     ON public.employees FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE POLICY employees_update_rh    ON public.employees FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
CREATE POLICY employees_delete_admin ON public.employees FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY aliases_read_all_auth  ON public.employee_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY aliases_write_rh       ON public.employee_aliases FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY usage_read_all_auth    ON public.monthly_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY usage_write_rh         ON public.monthly_usage FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY plans_read_all_auth       ON public.installment_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY plans_write_rh            ON public.installment_plans FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY plan_items_read_all_auth  ON public.installment_plan_items FOR SELECT TO authenticated USING (true);
CREATE POLICY plan_items_write_rh       ON public.installment_plan_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY ledger_read_all_auth  ON public.payroll_monthly_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY ledger_write_rh       ON public.payroll_monthly_ledger FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY exports_read_all_auth ON public.payroll_exports FOR SELECT TO authenticated USING (true);
CREATE POLICY exports_write_rh      ON public.payroll_exports FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY export_items_read_all_auth ON public.payroll_export_items FOR SELECT TO authenticated USING (true);
CREATE POLICY export_items_write_rh      ON public.payroll_export_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY import_batches_read_all_auth ON public.import_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY import_batches_write_rh      ON public.import_batches FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY import_items_read_all_auth ON public.import_items FOR SELECT TO authenticated USING (true);
CREATE POLICY import_items_write_rh      ON public.import_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

CREATE POLICY settings_read_all_auth ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY settings_write_admin   ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- audit_log: só INSERT pelo próprio ator; SELECT restrito a admin/rh; sem UPDATE/DELETE.
CREATE POLICY audit_insert_auth      ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());
CREATE POLICY audit_read_admin_rh    ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));

-- =============================================================================
-- STORAGE
-- =============================================================================
-- Bucket privado 'unimed-pdfs'.
--   INSERT INTO storage.buckets (id, name, public) VALUES ('unimed-pdfs','unimed-pdfs', false);
--
-- Policies em storage.objects (aplicar no Supabase novo):
--   CREATE POLICY unimed_pdfs_read_rh ON storage.objects FOR SELECT TO authenticated
--     USING (bucket_id = 'unimed-pdfs'
--       AND public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
--   CREATE POLICY unimed_pdfs_write_rh ON storage.objects FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'unimed-pdfs'
--       AND public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
--   CREATE POLICY unimed_pdfs_update_rh ON storage.objects FOR UPDATE TO authenticated
--     USING (bucket_id = 'unimed-pdfs'
--       AND public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
--   CREATE POLICY unimed_pdfs_delete_admin ON storage.objects FOR DELETE TO authenticated
--     USING (bucket_id = 'unimed-pdfs' AND public.has_role(auth.uid(), 'admin'));

-- =============================================================================
-- FIM DO SCHEMA DE REFERÊNCIA
-- =============================================================================
