CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS submissions_passenger_name_trgm ON public.submissions USING gin (passenger_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS executions_passenger_name_trgm ON public.executions USING gin (passenger_name gin_trgm_ops);