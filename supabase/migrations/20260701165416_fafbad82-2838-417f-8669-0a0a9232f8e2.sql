
-- 1) Extend payment_splits schema
ALTER TABLE public.payment_splits
  ALTER COLUMN transaction_id DROP NOT NULL;

ALTER TABLE public.payment_splits
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in',
  ADD COLUMN IF NOT EXISTS source_table TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_splits_direction_check'
  ) THEN
    ALTER TABLE public.payment_splits
      ADD CONSTRAINT payment_splits_direction_check CHECK (direction IN ('in','out'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payment_splits_source_idx
  ON public.payment_splits (source_table, source_id);

-- Existing splits are all agent receipts (direction 'in' by default). Tag source.
UPDATE public.payment_splits
   SET source_table = 'transactions', source_id = transaction_id
 WHERE source_table IS NULL AND transaction_id IS NOT NULL;

-- 2) Update trigger to respect direction
CREATE OR REPLACE FUNCTION public.apply_payment_split_to_cash_box()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $function$
DECLARE
  sign_new int := CASE WHEN COALESCE(NEW.direction,'in') = 'out' THEN -1 ELSE 1 END;
  sign_old int := CASE WHEN COALESCE(OLD.direction,'in') = 'out' THEN -1 ELSE 1 END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) + sign_new * COALESCE(NEW.amount,0),
             updated_at = now()
       WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) - sign_old * COALESCE(OLD.amount,0),
             updated_at = now()
       WHERE id = OLD.cash_box_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) - sign_old * COALESCE(OLD.amount,0),
             updated_at = now()
       WHERE id = OLD.cash_box_id;
    END IF;
    IF NEW.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) + sign_new * COALESCE(NEW.amount,0),
             updated_at = now()
       WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

-- 3) Merge duplicate cash boxes (same name + currency): keep oldest, reassign splits, deactivate rest
WITH ranked AS (
  SELECT id, name, currency,
    row_number() OVER (PARTITION BY name, currency ORDER BY created_at) AS rn,
    first_value(id) OVER (PARTITION BY name, currency ORDER BY created_at
                          ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS canonical_id
  FROM public.cash_boxes
)
UPDATE public.payment_splits ps
   SET cash_box_id = r.canonical_id
  FROM ranked r
 WHERE ps.cash_box_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY name, currency ORDER BY created_at) AS rn
  FROM public.cash_boxes
)
UPDATE public.cash_boxes
   SET is_active = false, updated_at = now()
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 4) Backfill payment_splits for legacy movements written only to old columns
DO $$
DECLARE
  cash_box_id_v UUID;
  insta_box_id_v UUID;
BEGIN
  SELECT id INTO cash_box_id_v FROM public.cash_boxes
    WHERE name='خزينة نقدي الشركة' AND currency='EGP' AND is_active=true
    ORDER BY created_at LIMIT 1;
  SELECT id INTO insta_box_id_v FROM public.cash_boxes
    WHERE name='خزينة إنستا الشركة' AND currency='EGP' AND is_active=true
    ORDER BY created_at LIMIT 1;

  -- Company outflows (cash)
  IF cash_box_id_v IS NOT NULL THEN
    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT NULL, 'company_transactions', ct.id, 'company_cash', 'EGP', cash_box_id_v,
           ct.cash_amount, ct.cash_amount, ct.cash_amount, ct.cash_amount, 'out'
      FROM public.company_transactions ct
     WHERE COALESCE(ct.cash_amount,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.source_table='company_transactions' AND ps.source_id=ct.id
            AND ps.method='company_cash'
       );

    -- Expense deductions paid from company cash
    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT NULL, 'expense_deductions', ed.id, 'company_cash', 'EGP', cash_box_id_v,
           ed.amount, ed.amount, ed.amount, ed.amount, 'out'
      FROM public.expense_deductions ed
     WHERE COALESCE(ed.amount,0) > 0
       AND (ed.funding_source = 'cash_company' OR ed.funding_source IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.source_table='expense_deductions' AND ps.source_id=ed.id
       );

    -- Agent-transaction receipts that lack any 'company_cash' split
    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT t.id, 'transactions', t.id, 'company_cash', 'EGP', cash_box_id_v,
           t.cash_amount, t.cash_amount, t.cash_amount, t.cash_amount, 'in'
      FROM public.transactions t
     WHERE COALESCE(t.cash_amount,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.transaction_id = t.id AND ps.method='company_cash'
       );
  END IF;

  IF insta_box_id_v IS NOT NULL THEN
    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT NULL, 'company_transactions', ct.id, 'company_instapay', 'EGP', insta_box_id_v,
           ct.instapay_amount, ct.instapay_amount, ct.instapay_amount, ct.instapay_amount, 'out'
      FROM public.company_transactions ct
     WHERE COALESCE(ct.instapay_amount,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.source_table='company_transactions' AND ps.source_id=ct.id
            AND ps.method='company_instapay'
       );

    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT NULL, 'expense_deductions', ed.id, 'company_instapay', 'EGP', insta_box_id_v,
           ed.amount, ed.amount, ed.amount, ed.amount, 'out'
      FROM public.expense_deductions ed
     WHERE COALESCE(ed.amount,0) > 0
       AND ed.funding_source = 'insta_company'
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.source_table='expense_deductions' AND ps.source_id=ed.id
       );

    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT t.id, 'transactions', t.id, 'company_instapay', 'EGP', insta_box_id_v,
           t.instapay_amount, t.instapay_amount, t.instapay_amount, t.instapay_amount, 'in'
      FROM public.transactions t
     WHERE COALESCE(t.instapay_amount,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.transaction_id = t.id AND ps.method='company_instapay'
       );
  END IF;
END $$;

-- 5) Recompute cash_boxes.balance from payment_splits authoritatively
UPDATE public.cash_boxes cb
   SET balance = COALESCE((
         SELECT SUM(CASE WHEN ps.direction='out' THEN -ps.amount ELSE ps.amount END)
           FROM public.payment_splits ps
          WHERE ps.cash_box_id = cb.id
       ), 0),
       updated_at = now();
