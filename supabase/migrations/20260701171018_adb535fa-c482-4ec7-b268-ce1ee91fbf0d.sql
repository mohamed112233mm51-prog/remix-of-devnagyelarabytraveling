CREATE UNIQUE INDEX IF NOT EXISTS cash_boxes_name_currency_uniq
  ON public.cash_boxes (name, currency);