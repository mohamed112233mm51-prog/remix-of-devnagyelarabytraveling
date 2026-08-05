-- Separate the accounting recognition date from the operational travel date.
--
-- financial_posting_date is the first date on which an execution was posted
-- financially as "منفذ". It is used by agent/company ledgers and accounting
-- period reports. travel_date remains the source for travel operations,
-- archiving and historical FX resolution.

ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS financial_posting_date date;

COMMENT ON COLUMN public.executions.financial_posting_date IS
  'Immutable accounting recognition date set when the execution is first posted as منفذ; independent from travel_date.';

-- Backfill legacy executed rows. Best available evidence, in order:
--   1) earliest created_at of a linked agent transaction;
--   2) earliest created_at of a linked company transaction;
--   3) execution.updated_at;
--   4) execution.created_at.
-- All timestamptz values are converted to the Africa/Cairo calendar date.
WITH posting_candidates AS (
  SELECT
    e.id AS execution_id,
    COALESCE(
      (
        SELECT MIN(t.created_at)
        FROM public.transactions t
        WHERE t.source_service_type = 'execution'
          AND t.source_service_id LIKE e.id::text || '::%'
      ),
      (
        SELECT MIN(ct.created_at)
        FROM public.company_transactions ct
        WHERE ct.source_service_type = 'execution'
          AND ct.source_service_id LIKE e.id::text || '::%'
      ),
      e.updated_at,
      e.created_at
    ) AS posting_timestamp
  FROM public.executions e
  WHERE e.operation_status = 'منفذ'
    AND e.financial_posting_date IS NULL
), resolved AS (
  SELECT
    execution_id,
    (posting_timestamp AT TIME ZONE 'Africa/Cairo')::date AS posting_date
  FROM posting_candidates
  WHERE posting_timestamp IS NOT NULL
)
UPDATE public.executions e
SET financial_posting_date = r.posting_date
FROM resolved r
WHERE e.id = r.execution_id
  AND e.financial_posting_date IS NULL;

-- Align only execution-generated ledger rows with the resolved accounting date.
-- This is deliberately idempotent and does not touch manual payments,
-- settlements, opening balances or unrelated transactions.
UPDATE public.transactions t
SET date = e.financial_posting_date
FROM public.executions e
WHERE e.financial_posting_date IS NOT NULL
  AND t.source_service_type = 'execution'
  AND t.source_service_id LIKE e.id::text || '::%'
  AND t.date IS DISTINCT FROM e.financial_posting_date;

UPDATE public.company_transactions ct
SET date = e.financial_posting_date
FROM public.executions e
WHERE e.financial_posting_date IS NOT NULL
  AND ct.source_service_type = 'execution'
  AND ct.source_service_id LIKE e.id::text || '::%'
  AND ct.date IS DISTINCT FROM e.financial_posting_date;

CREATE INDEX IF NOT EXISTS idx_executions_financial_posting_date
  ON public.executions (financial_posting_date);
