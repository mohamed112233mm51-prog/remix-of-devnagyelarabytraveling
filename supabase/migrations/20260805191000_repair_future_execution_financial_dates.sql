-- Repair legacy execution-generated debts/costs that are still dated in the future.
--
-- Background:
-- Older posting logic used executions.travel_date as transactions.date and
-- company_transactions.date. Therefore an execution approved financially today
-- with a future departure date disappeared from the current agent/company
-- statement until the departure day.
--
-- This migration is deliberately limited to rows generated from executions:
--   source_service_type = 'execution'
--   source_service_id   = '<execution_uuid>::<service_index>'
-- Manual payments, opening balances and unrelated movements are never touched.

DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  -- 1) Resolve a safe accounting date for every executed operation that has:
  --    - no financial_posting_date,
  --    - a future financial_posting_date, or
  --    - linked ledger rows whose date is still in the future.
  --
  -- Resolution policy:
  --    a) keep an existing non-future financial_posting_date;
  --    b) otherwise use the earliest linked row created_at (agent or company);
  --    c) fallback to execution.updated_at, then execution.created_at;
  --    d) never allow a date later than Cairo today.
  WITH candidates AS (
    SELECT
      e.id,
      CASE
        WHEN e.financial_posting_date IS NOT NULL
         AND e.financial_posting_date <= v_today
          THEN e.financial_posting_date
        ELSE LEAST(
          COALESCE(
            (
              SELECT MIN(x.created_date)
              FROM (
                SELECT (t.created_at AT TIME ZONE 'Africa/Cairo')::date AS created_date
                FROM public.transactions t
                WHERE t.source_service_type = 'execution'
                  AND t.source_service_id LIKE e.id::text || '::%'
                UNION ALL
                SELECT (ct.created_at AT TIME ZONE 'Africa/Cairo')::date AS created_date
                FROM public.company_transactions ct
                WHERE ct.source_service_type = 'execution'
                  AND ct.source_service_id LIKE e.id::text || '::%'
              ) x
            ),
            (e.updated_at AT TIME ZONE 'Africa/Cairo')::date,
            (e.created_at AT TIME ZONE 'Africa/Cairo')::date,
            v_today
          ),
          v_today
        )
      END AS resolved_date
    FROM public.executions e
    WHERE e.operation_status = 'منفذ'
      AND (
        e.financial_posting_date IS NULL
        OR e.financial_posting_date > v_today
        OR EXISTS (
          SELECT 1
          FROM public.transactions t
          WHERE t.source_service_type = 'execution'
            AND t.source_service_id LIKE e.id::text || '::%'
            AND t.date > v_today
        )
        OR EXISTS (
          SELECT 1
          FROM public.company_transactions ct
          WHERE ct.source_service_type = 'execution'
            AND ct.source_service_id LIKE e.id::text || '::%'
            AND ct.date > v_today
        )
      )
  )
  UPDATE public.executions e
  SET financial_posting_date = c.resolved_date
  FROM candidates c
  WHERE e.id = c.id
    AND e.financial_posting_date IS DISTINCT FROM c.resolved_date;

  -- 2) Synchronize every execution-generated agent debt with the resolved date.
  UPDATE public.transactions t
  SET date = e.financial_posting_date
  FROM public.executions e
  WHERE e.operation_status = 'منفذ'
    AND e.financial_posting_date IS NOT NULL
    AND e.financial_posting_date <= v_today
    AND t.source_service_type = 'execution'
    AND t.source_service_id LIKE e.id::text || '::%'
    AND t.date IS DISTINCT FROM e.financial_posting_date;

  -- 3) Synchronize every execution-generated company cost with the same date.
  UPDATE public.company_transactions ct
  SET date = e.financial_posting_date
  FROM public.executions e
  WHERE e.operation_status = 'منفذ'
    AND e.financial_posting_date IS NOT NULL
    AND e.financial_posting_date <= v_today
    AND ct.source_service_type = 'execution'
    AND ct.source_service_id LIKE e.id::text || '::%'
    AND ct.date IS DISTINCT FROM e.financial_posting_date;
END $$;

-- Supporting indexes for statement filtering and linked-row reconciliation.
CREATE INDEX IF NOT EXISTS idx_transactions_execution_source_date
  ON public.transactions (source_service_type, date, source_service_id)
  WHERE source_service_type = 'execution';

CREATE INDEX IF NOT EXISTS idx_company_transactions_execution_source_date
  ON public.company_transactions (source_service_type, date, source_service_id)
  WHERE source_service_type = 'execution';

-- Post-migration verification result. Both values should be zero for executed
-- operations. Kept as a SELECT so Supabase SQL Editor displays the result.
SELECT
  (
    SELECT COUNT(*)
    FROM public.transactions t
    JOIN public.executions e
      ON t.source_service_id LIKE e.id::text || '::%'
    WHERE t.source_service_type = 'execution'
      AND e.operation_status = 'منفذ'
      AND t.date > (now() AT TIME ZONE 'Africa/Cairo')::date
  ) AS future_agent_execution_debts,
  (
    SELECT COUNT(*)
    FROM public.company_transactions ct
    JOIN public.executions e
      ON ct.source_service_id LIKE e.id::text || '::%'
    WHERE ct.source_service_type = 'execution'
      AND e.operation_status = 'منفذ'
      AND ct.date > (now() AT TIME ZONE 'Africa/Cairo')::date
  ) AS future_company_execution_costs;
