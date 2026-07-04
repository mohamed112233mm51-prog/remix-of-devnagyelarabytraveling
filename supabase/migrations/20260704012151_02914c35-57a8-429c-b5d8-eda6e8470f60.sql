-- Add stable method_key identifier to cash_boxes so cash box selection no longer
-- depends on Arabic name substring matching. Nullable + partial unique index
-- to preserve full backward compatibility with existing data.
ALTER TABLE public.cash_boxes
  ADD COLUMN IF NOT EXISTS method_key text;

COMMENT ON COLUMN public.cash_boxes.method_key IS
  'Stable identifier used by the app to resolve which cash box a payment method/currency maps to. Examples: company_cash, company_instapay, company_usd, company_lyd. Nullable to keep legacy rows working via name-based fallback.';

-- Prevent two active boxes claiming the same method_key.
CREATE UNIQUE INDEX IF NOT EXISTS cash_boxes_method_key_uniq
  ON public.cash_boxes (method_key)
  WHERE method_key IS NOT NULL;

-- Backfill stable keys for the known canonical boxes based on their current
-- name+currency pairing. This does NOT touch balances, payment splits, or any
-- financial data — only the new descriptor column.
UPDATE public.cash_boxes
   SET method_key = 'company_cash'
 WHERE method_key IS NULL
   AND currency  = 'EGP'
   AND name LIKE '%نقدي%'
   AND name LIKE '%الشركة%';

UPDATE public.cash_boxes
   SET method_key = 'company_instapay'
 WHERE method_key IS NULL
   AND currency  = 'EGP'
   AND name LIKE '%إنستا%'
   AND name LIKE '%الشركة%';

UPDATE public.cash_boxes
   SET method_key = 'company_usd'
 WHERE method_key IS NULL
   AND currency  = 'USD'
   AND name LIKE '%الرئيسية%';

UPDATE public.cash_boxes
   SET method_key = 'company_lyd'
 WHERE method_key IS NULL
   AND currency  = 'LYD'
   AND name LIKE '%الرئيسية%';

-- Legacy orphan EGP main box (from the unification migration) intentionally
-- left with method_key = NULL so no new operation resolves to it.
