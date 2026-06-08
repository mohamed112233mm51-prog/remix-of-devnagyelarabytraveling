
CREATE TABLE public.currency_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  notes text,
  status text NOT NULL DEFAULT 'نشط',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.currency_suppliers TO authenticated;
GRANT ALL ON public.currency_suppliers TO service_role;

ALTER TABLE public.currency_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read currency_suppliers" ON public.currency_suppliers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert currency_suppliers" ON public.currency_suppliers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update currency_suppliers" ON public.currency_suppliers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete currency_suppliers" ON public.currency_suppliers
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_currency_suppliers_updated_at
  BEFORE UPDATE ON public.currency_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.currency_supplier_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.currency_suppliers(id) ON DELETE CASCADE,
  tx_date date NOT NULL DEFAULT CURRENT_DATE,
  tx_type text NOT NULL CHECK (tx_type IN ('شراء عملة','بيع عملة')),
  bought_currency text NOT NULL,
  bought_amount numeric NOT NULL DEFAULT 0,
  sold_currency text NOT NULL,
  sold_amount numeric NOT NULL DEFAULT 0,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.currency_supplier_transactions TO authenticated;
GRANT ALL ON public.currency_supplier_transactions TO service_role;

ALTER TABLE public.currency_supplier_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read cs_tx" ON public.currency_supplier_transactions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert cs_tx" ON public.currency_supplier_transactions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update cs_tx" ON public.currency_supplier_transactions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete cs_tx" ON public.currency_supplier_transactions
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_cs_tx_updated_at
  BEFORE UPDATE ON public.currency_supplier_transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_cs_tx_supplier ON public.currency_supplier_transactions(supplier_id, tx_date DESC);
