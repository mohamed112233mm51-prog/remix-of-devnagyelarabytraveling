ALTER TABLE public.profiles DISABLE TRIGGER USER;
UPDATE public.profiles SET is_super_admin = true WHERE email = 'mohamed112233.mm51@gmail.com';
ALTER TABLE public.profiles ENABLE TRIGGER USER;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM public.profiles WHERE email = 'mohamed112233.mm51@gmail.com'
ON CONFLICT DO NOTHING;