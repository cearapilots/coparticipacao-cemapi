-- =========================================================================
-- Feature A: permitir editar o NÚMERO DE PARCELAS de um item na revisão do
-- lote de importação, antes de confirmar (a "inbox" do lote).
--
-- Espelha o padrão já usado na correção de valor (corrected_amount_cents...):
-- o número de parcelas automático continua sendo derivado da regra por faixa;
-- o override manual vive em colunas separadas e só é usado na confirmação
-- quando presente. Nada aqui altera valores já lançados.
--
-- Idempotente.
-- =========================================================================
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS installment_count_override integer;
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS installment_override_reason text;
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS installment_override_by uuid REFERENCES auth.users(id);
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS installment_override_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'import_items_installment_override_positive_chk'
  ) THEN
    ALTER TABLE public.import_items
      ADD CONSTRAINT import_items_installment_override_positive_chk
      CHECK (installment_count_override IS NULL OR installment_count_override >= 1);
  END IF;
END $$;

-- Limite de parcelas manuais (configurável). Fallback no código = 12.
INSERT INTO public.app_settings (setting_key, setting_value, description) VALUES
  ('max_manual_installments', '12'::jsonb, 'Número máximo de parcelas que o RH pode definir manualmente (importação / re-parcelamento)')
ON CONFLICT (setting_key) DO NOTHING;
