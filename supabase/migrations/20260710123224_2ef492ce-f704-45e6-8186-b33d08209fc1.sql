
-- Renomear coluna para alinhar com spec
ALTER TABLE public.import_batches RENAME COLUMN total_cobrado_empresa_cents TO total_charged_company_cents;

-- Índice em matched_employee_id
CREATE INDEX IF NOT EXISTS import_items_matched_emp_idx ON public.import_items(matched_employee_id);

-- Evitar duplicidade indevida em monthly_usage quando há source_reference_id (ex.: importação)
CREATE UNIQUE INDEX IF NOT EXISTS monthly_usage_source_dedup_idx
  ON public.monthly_usage(employee_id, competence_month, source_type, source_reference_id)
  WHERE source_reference_id IS NOT NULL;

-- Constraints de não-negatividade em valores monetários
ALTER TABLE public.monthly_usage
  DROP CONSTRAINT IF EXISTS monthly_usage_amount_nonneg_chk,
  ADD CONSTRAINT monthly_usage_amount_nonneg_chk CHECK (amount_cents >= 0);

ALTER TABLE public.installment_plans
  DROP CONSTRAINT IF EXISTS installment_plans_total_nonneg_chk,
  ADD CONSTRAINT installment_plans_total_nonneg_chk CHECK (total_amount_cents >= 0);

ALTER TABLE public.installment_plan_items
  DROP CONSTRAINT IF EXISTS installment_plan_items_amount_nonneg_chk,
  ADD CONSTRAINT installment_plan_items_amount_nonneg_chk CHECK (scheduled_amount_cents >= 0);

ALTER TABLE public.payroll_monthly_ledger
  DROP CONSTRAINT IF EXISTS ledger_amounts_nonneg_chk,
  ADD CONSTRAINT ledger_amounts_nonneg_chk CHECK (
    scheduled_amount_cents >= 0 AND carryover_in_cents >= 0 AND gross_due_cents >= 0
    AND cap_cents >= 0 AND amount_to_deduct_cents >= 0 AND carryover_out_cents >= 0
  );

-- Atualizar valores padrão em app_settings conforme spec
UPDATE public.app_settings SET setting_value = to_jsonb('CEARA MARINE PILOTS'::text) WHERE setting_key = 'company_name';
UPDATE public.app_settings SET setting_value = to_jsonb('contabilidade_v1'::text) WHERE setting_key = 'export_layout_version';
