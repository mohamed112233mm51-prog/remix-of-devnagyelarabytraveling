ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS fx_rate numeric,
  ADD COLUMN IF NOT EXISTS fx_locked_at timestamptz;

-- EGP expenses: lock at 1 immediately.
UPDATE public.expenses
   SET fx_rate = 1,
       fx_locked_at = COALESCE(fx_locked_at, now())
 WHERE fx_rate IS NULL
   AND (currency IS NULL OR upper(currency) = 'EGP');

-- Foreign expenses that already carry a positive exchange_rate: promote it to
-- the locked fx_rate. Never fabricate a rate for rows without one.
UPDATE public.expenses
   SET fx_rate = exchange_rate,
       fx_locked_at = COALESCE(fx_locked_at, now())
 WHERE fx_rate IS NULL
   AND currency IS NOT NULL
   AND upper(currency) <> 'EGP'
   AND exchange_rate IS NOT NULL
   AND exchange_rate > 0;