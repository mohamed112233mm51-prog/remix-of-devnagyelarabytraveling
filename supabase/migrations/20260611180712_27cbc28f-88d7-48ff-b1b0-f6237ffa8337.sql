CREATE UNIQUE INDEX IF NOT EXISTS transactions_submission_fine_unique
ON public.transactions (source_service_id)
WHERE source_service_type = 'submission_fine';