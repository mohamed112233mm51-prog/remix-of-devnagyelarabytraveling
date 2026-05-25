
-- 1) Extend the dropdown validation trigger to allow the two new categories
CREATE OR REPLACE FUNCTION public.validate_system_dropdown_option()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.category := btrim(COALESCE(NEW.category, ''));
  NEW.value    := btrim(COALESCE(NEW.value, ''));
  NEW.is_active := COALESCE(NEW.is_active, true);

  IF NEW.category NOT IN (
    'authority','destination','airline','service_type',
    'execution_status','submission_status','departure_from','service_kind',
    'submission_notes','airport'
  ) THEN
    RAISE EXCEPTION 'Invalid dropdown category: %', NEW.category;
  END IF;

  IF NEW.value = '' THEN
    RAISE EXCEPTION 'Dropdown value cannot be empty';
  END IF;

  RETURN NEW;
END; $function$;

-- 2) Seed default values for each of the six requested lists.
--    Only insert when the (category, value) pair is missing so this is idempotent
--    and does NOT overwrite anything an admin has already added or disabled.
WITH defaults(category, value) AS (
  VALUES
    -- الحالة (status used by both submissions & executions)
    ('submission_status','بطيء'),
    ('submission_status','سريع'),
    ('submission_status','رفض أمني'),
    ('execution_status','بطيء'),
    ('execution_status','سريع'),
    ('execution_status','رفض أمني'),

    -- ملاحظات
    ('submission_notes','سيدات'),
    ('submission_notes','رضيع'),
    ('submission_notes','طفل تحت 8'),
    ('submission_notes','طفل تحت 12'),

    -- الوجهة
    ('destination','بنغازي'),
    ('destination','طرابلس'),
    ('destination','مصراته'),
    ('destination','سبها'),

    -- الطيران
    ('airline','العراق'),
    ('airline','البرنيق'),
    ('airline','الليبية'),
    ('airline','إير كايرو'),
    ('airline','تاج'),
    ('airline','مصر للطيران'),
    ('airline','الإفريقية'),

    -- المطار
    ('airport','برج العرب'),
    ('airport','القاهرة'),

    -- الخدمة (used by submissions services + execution service_kind)
    ('service_kind','موافقة أمنية'),
    ('service_kind','تذكرة'),
    ('service_kind','استثمار'),
    ('service_kind','استثمار بري'),
    ('service_kind','تذكرة واستثمار'),
    ('service_kind','بنغازي شغل كامل'),
    ('service_kind','طرابلس شغل كامل'),
    ('service_kind','مصراته شغل كامل'),
    ('service_kind','سبها شغل كامل'),
    ('service_kind','بري شغل كامل'),
    ('service_kind','نقل بري (طبرق واجدابيا)'),
    ('service_kind','نقل طرابلس'),
    ('service_kind','نقل مصراته'),
    ('service_kind','نقل ........'),
    ('service_kind','موافقة واستثمار بري'),
    ('service_kind','تأشيرة طرابلس'),
    ('service_kind','مصراته تنسيق'),
    ('service_kind','خدمات أخرى'),
    ('service_kind','نقل عن طريق سبها')
)
INSERT INTO public.system_dropdown_options (category, value, is_active)
SELECT d.category, d.value, true
FROM defaults d
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_dropdown_options o
  WHERE o.category = d.category AND o.value = d.value
);
