
-- 1) Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('system-backups', 'system-backups', false)
ON CONFLICT (id) DO NOTHING;

-- 2) Storage RLS: admins only
DROP POLICY IF EXISTS "system_backups admin read" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin write" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin update" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin delete" ON storage.objects;

CREATE POLICY "system_backups admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "system_backups admin write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "system_backups admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "system_backups admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));

-- 3) Backup logs table
CREATE TABLE IF NOT EXISTS public.backup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT NOT NULL,            -- daily | weekly | monthly | manual | emergency | restore
  file_path TEXT,
  file_size BIGINT,
  status TEXT NOT NULL DEFAULT 'success', -- success | failed | running
  failure_reason TEXT,
  restore_date TIMESTAMPTZ,
  restored_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.backup_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backup_logs admin all" ON public.backup_logs;
CREATE POLICY "backup_logs admin all" ON public.backup_logs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON public.backup_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_logs_type ON public.backup_logs (backup_type);

-- 4) Schedule cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
