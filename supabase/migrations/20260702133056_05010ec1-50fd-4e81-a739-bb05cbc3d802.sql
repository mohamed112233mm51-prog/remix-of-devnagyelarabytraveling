
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS statement text;
ALTER TABLE public.merchant_cash_collections ADD COLUMN IF NOT EXISTS statement text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS statement text;
ALTER TABLE public.expense_deductions ADD COLUMN IF NOT EXISTS statement text;
ALTER TABLE public.investor_transactions ADD COLUMN IF NOT EXISTS statement text;
ALTER TABLE public.currency_supplier_transactions ADD COLUMN IF NOT EXISTS statement text;
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS statement text;
ALTER TABLE public.usd_treasury_transactions ADD COLUMN IF NOT EXISTS statement text;
