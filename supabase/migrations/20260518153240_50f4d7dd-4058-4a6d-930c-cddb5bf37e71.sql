-- Add super admin flag to profiles for "owner" bypass of settings permissions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- Seed: mark current admins as super admins to avoid lockout
UPDATE public.profiles p
SET is_super_admin = true
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = p.id AND ur.role = 'admin'
);