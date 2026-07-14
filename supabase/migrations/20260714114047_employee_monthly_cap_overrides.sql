-- =========================================================================
-- Feature B: teto personalizado por colaborador × mês.
--
-- Permite reduzir (ou ajustar) o desconto de UM mês aberto de um colaborador.
-- A diferença é remanejada para os meses seguintes pelo mecanismo de carryover
-- que já existe, sempre respeitando o teto do mês seguinte.
--
-- IMPORTANTE (decisão técnica): esta tabela é ENTRADA DE REGRA, separada do
-- ledger (que é RESULTADO calculado). O recálculo consulta esta tabela:
-- usa o teto daqui se existir para o mês, senão o teto global (R$ 700).
--
-- Idempotente.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.employee_monthly_cap_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  payroll_month date NOT NULL,
  cap_cents integer NOT NULL CHECK (cap_cents >= 0),
  reason text,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, payroll_month)
);
CREATE INDEX IF NOT EXISTS employee_monthly_cap_overrides_emp_idx
  ON public.employee_monthly_cap_overrides (employee_id, payroll_month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_monthly_cap_overrides TO authenticated;
GRANT ALL ON public.employee_monthly_cap_overrides TO service_role;
ALTER TABLE public.employee_monthly_cap_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cap_overrides_read_all_auth ON public.employee_monthly_cap_overrides;
CREATE POLICY cap_overrides_read_all_auth ON public.employee_monthly_cap_overrides FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cap_overrides_write_rh ON public.employee_monthly_cap_overrides;
CREATE POLICY cap_overrides_write_rh ON public.employee_monthly_cap_overrides FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','rh']::public.app_role[]));
