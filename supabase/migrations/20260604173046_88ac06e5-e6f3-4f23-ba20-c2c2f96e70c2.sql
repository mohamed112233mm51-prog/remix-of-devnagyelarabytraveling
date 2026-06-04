-- Cash boxes: one wallet per currency (EGP / USD / LYD)
CREATE TABLE public.cash_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('EGP','USD','LYD')),
  balance numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_boxes TO authenticated;
GRANT ALL ON public.cash_boxes TO service_role;

ALTER TABLE public.cash_boxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_boxes_auth_select ON public.cash_boxes FOR SELECT TO authenticated USING (true);
CREATE POLICY cash_boxes_auth_insert ON public.cash_boxes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY cash_boxes_auth_update ON public.cash_boxes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY cash_boxes_auth_delete ON public.cash_boxes FOR DELETE TO authenticated USING (true);

CREATE TRIGGER cash_boxes_touch_updated_at
  BEFORE UPDATE ON public.cash_boxes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed default cash boxes
INSERT INTO public.cash_boxes (name, currency, balance) VALUES
  ('الخزينة الرئيسية - جنيه', 'EGP', 0),
  ('الخزينة الرئيسية - دولار', 'USD', 0),
  ('الخزينة الرئيسية - دينار ليبي', 'LYD', 0);

-- Payment splits: multi-line allocation of a single transaction payment
CREATE TABLE public.payment_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  method text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('EGP','USD','LYD')),
  cash_box_id uuid REFERENCES public.cash_boxes(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  exchange_rate numeric,
  egp_equivalent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_splits_transaction_id_idx ON public.payment_splits(transaction_id);
CREATE INDEX payment_splits_cash_box_id_idx ON public.payment_splits(cash_box_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_splits TO authenticated;
GRANT ALL ON public.payment_splits TO service_role;

ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_splits_auth_select ON public.payment_splits FOR SELECT TO authenticated USING (true);
CREATE POLICY payment_splits_auth_insert ON public.payment_splits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY payment_splits_auth_update ON public.payment_splits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY payment_splits_auth_delete ON public.payment_splits FOR DELETE TO authenticated USING (true);

-- Keep cash_boxes.balance in sync with payment_splits in the matching currency
CREATE OR REPLACE FUNCTION public.apply_payment_split_to_cash_box()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
        SET balance = COALESCE(balance, 0) + COALESCE(NEW.amount, 0),
            updated_at = now()
      WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
        SET balance = COALESCE(balance, 0) - COALESCE(OLD.amount, 0),
            updated_at = now()
      WHERE id = OLD.cash_box_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
        SET balance = COALESCE(balance, 0) - COALESCE(OLD.amount, 0),
            updated_at = now()
      WHERE id = OLD.cash_box_id;
    END IF;
    IF NEW.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
        SET balance = COALESCE(balance, 0) + COALESCE(NEW.amount, 0),
            updated_at = now()
      WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER payment_splits_balance_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_splits
  FOR EACH ROW EXECUTE FUNCTION public.apply_payment_split_to_cash_box();

-- Realtime for live ledger + wallet updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_boxes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_splits;