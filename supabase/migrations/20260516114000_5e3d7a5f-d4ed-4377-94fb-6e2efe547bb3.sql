ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'security_approval';
CREATE INDEX IF NOT EXISTS idx_approvals_service_type ON public.approvals(service_type);