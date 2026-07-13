-- =========================================================================
-- Correção rastreável do valor lido do PDF em import_items.
--
-- amount_cents permanece INTOCADO como o valor originalmente extraído pelo
-- parser. A correção do RH/admin vai em colunas separadas, nunca sobrescreve
-- o original. O valor "efetivo" (usado na confirmação do lote) é
-- corrected_amount_cents quando presente, senão amount_cents.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + guarda de constraint via DO block.
-- =========================================================================
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS corrected_amount_cents integer;
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS correction_reason text;
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES auth.users(id);
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS corrected_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'import_items_corrected_amount_nonneg_chk'
  ) THEN
    ALTER TABLE public.import_items
      ADD CONSTRAINT import_items_corrected_amount_nonneg_chk
      CHECK (corrected_amount_cents IS NULL OR corrected_amount_cents >= 0);
  END IF;
END $$;
