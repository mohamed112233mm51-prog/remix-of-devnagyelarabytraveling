ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invite_accepted boolean NOT NULL DEFAULT false;
-- Existing rows that already signed in are considered accepted
UPDATE public.profiles p SET invite_accepted = true
  WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id AND u.last_sign_in_at IS NOT NULL);