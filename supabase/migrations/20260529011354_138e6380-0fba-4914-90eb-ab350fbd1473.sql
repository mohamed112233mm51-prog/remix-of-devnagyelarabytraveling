-- Change source_service_id from uuid to text to support composite per-service link IDs
-- (format: `${executionId}::${index}`). This also restores correct behavior for
-- delete-by-prefix in execution financial posting.

ALTER TABLE public.transactions
  ALTER COLUMN source_service_id TYPE text USING source_service_id::text;

ALTER TABLE public.company_transactions
  ALTER COLUMN source_service_id TYPE text USING source_service_id::text;

CREATE INDEX IF NOT EXISTS idx_transactions_source_service_id
  ON public.transactions (source_service_id);

CREATE INDEX IF NOT EXISTS idx_company_transactions_source_service_id
  ON public.company_transactions (source_service_id);