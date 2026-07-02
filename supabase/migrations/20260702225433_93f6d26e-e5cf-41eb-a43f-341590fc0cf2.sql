
-- 1. Add cancellation columns to financial tables
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.currency_supplier_transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.expense_deductions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.usd_treasury_transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.payment_splits
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 2. Audit log table
CREATE TABLE IF NOT EXISTS public.financial_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('cancel','restore','edit','delete')),
  reason text,
  reference_no text,
  entity_type text,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  performed_by uuid REFERENCES auth.users(id),
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_log_record
  ON public.financial_audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_financial_audit_log_performed_at
  ON public.financial_audit_log(performed_at DESC);

GRANT SELECT, INSERT ON public.financial_audit_log TO authenticated;
GRANT ALL ON public.financial_audit_log TO service_role;

ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit log readable by authenticated"
  ON public.financial_audit_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "audit log insertable by authenticated"
  ON public.financial_audit_log FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = performed_by);
