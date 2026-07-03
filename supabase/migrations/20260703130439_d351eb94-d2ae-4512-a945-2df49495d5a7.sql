-- Allow 'create' action in financial audit log
ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_action_check;
ALTER TABLE public.financial_audit_log
  ADD CONSTRAINT financial_audit_log_action_check
  CHECK (action IN ('create','cancel','restore','edit','delete'));