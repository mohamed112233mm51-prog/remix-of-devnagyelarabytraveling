ALTER TABLE public.merchant_cash_collections ADD COLUMN IF NOT EXISTS expense_id uuid;
CREATE INDEX IF NOT EXISTS idx_mcc_expense_id ON public.merchant_cash_collections(expense_id);
ALTER TABLE public.usd_treasury_transactions ADD COLUMN IF NOT EXISTS expense_id uuid;
CREATE INDEX IF NOT EXISTS idx_usd_expense_id ON public.usd_treasury_transactions(expense_id);