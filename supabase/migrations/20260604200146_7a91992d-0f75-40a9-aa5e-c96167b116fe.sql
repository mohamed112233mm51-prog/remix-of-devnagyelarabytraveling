INSERT INTO public.cash_boxes (name, currency, balance, is_active)
SELECT v.name, 'EGP', 0, true
FROM (VALUES ('خزينة إنستا الشركة'), ('خزينة نقدي الشركة')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM public.cash_boxes c WHERE c.name = v.name);