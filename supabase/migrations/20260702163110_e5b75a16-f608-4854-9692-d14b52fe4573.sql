-- Opening balance support for merchants, currency suppliers, and cash boxes.

-- 1) merchants: add opening balance fields
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS opening_debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text,
  ADD COLUMN IF NOT EXISTS opening_currency text NOT NULL DEFAULT 'EGP';

-- 2) currency_suppliers: add opening balance fields
ALTER TABLE public.currency_suppliers
  ADD COLUMN IF NOT EXISTS opening_debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text,
  ADD COLUMN IF NOT EXISTS opening_currency text NOT NULL DEFAULT 'EGP';

-- 3) cash_boxes: add opening balance fields (currency already exists on the box itself)
ALTER TABLE public.cash_boxes
  ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text;

-- 4) tag columns on ledger tables so we can identify opening rows and dedupe them.
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS source_service_type text,
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS opening_currency text;

ALTER TABLE public.currency_supplier_transactions
  ADD COLUMN IF NOT EXISTS source_service_type text,
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS opening_currency text;

ALTER TABLE public.usd_treasury_transactions
  ADD COLUMN IF NOT EXISTS source_service_type text,
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS cash_box_id uuid REFERENCES public.cash_boxes(id) ON DELETE SET NULL;

-- 5) partial unique indexes: prevent duplicate opening rows per entity+currency.
CREATE UNIQUE INDEX IF NOT EXISTS ux_merchant_opening_row
  ON public.merchant_cash_collections (merchant_id, opening_currency, source_service_type)
  WHERE source_service_type IN ('opening_debit','opening_credit');

CREATE UNIQUE INDEX IF NOT EXISTS ux_currency_supplier_opening_row
  ON public.currency_supplier_transactions (supplier_id, opening_currency, source_service_type)
  WHERE source_service_type IN ('opening_debit','opening_credit');

CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_box_opening_row
  ON public.usd_treasury_transactions (cash_box_id, source_service_type)
  WHERE source_service_type = 'opening';
