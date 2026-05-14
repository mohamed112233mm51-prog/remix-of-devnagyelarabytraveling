CREATE TABLE public.system_dropdown_options (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  value text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, value)
);

ALTER TABLE public.system_dropdown_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dropdown read auth" ON public.system_dropdown_options
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "dropdown admin write" ON public.system_dropdown_options
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_system_dropdown_options_cat ON public.system_dropdown_options(category, is_active);

INSERT INTO public.system_dropdown_options (category, value) VALUES
  ('destination','بنغازي'),('destination','مصراته'),('destination','طرابلس'),
  ('authority','مطار برج العرب'),('authority','مطار القاهرة'),('authority','جمرك بري'),
  ('airline','برنيق'),('airline','بنغازي'),('airline','البرج'),
  ('service_type','تذاكر طيران'),('service_type','موافقة أمنية'),('service_type','استثمار عسكري')
ON CONFLICT (category, value) DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE public.system_dropdown_options;