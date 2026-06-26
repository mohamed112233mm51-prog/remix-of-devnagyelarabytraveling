## نظرة عامة

نحذف نظام التسعير القديم (`agent_service_pricing` + `AgentPricingSection`) ونبني نظاماً جديداً مرتبطاً بالشركة الصادرة، يعتمد على شرائح الوكلاء، مع مطابقة ذكية للأسعار وقت إنشاء التنفيذ.

---

## 1) قاعدة البيانات

### جدول جديد: `company_pricing_rules`
ملف التسعير لكل شركة، صف واحد = قاعدة سعر واحدة.

الحقول الرئيسية:
- `company_id` (FK → issuing_companies) — إلزامي
- `service_type` (text) — إلزامي
- `agent_tier` (text) — إلزامي (A/B/C…)
- `departure_from`, `destination`, `airline`, `approval_company_id`, `status`, `passenger_type` — كلها اختيارية (NULL = لا يؤثر)
- `company_price` (numeric) — إلزامي
- `commission_type` (text: 'percentage' | 'fixed') — إلزامي
- `commission_value` (numeric) — إلزامي (نسبة أو مبلغ)
- `agent_price` (numeric) — محسوب تلقائياً عبر trigger
- `created_at`, `updated_at`

### تعديل `agents`
- إضافة عمود `tier` (text) — إلزامي مع default 'A'

### قائمة منسدلة جديدة
- إضافة category جديدة في `system_dropdown_options` باسم `agent_tier` (يبدأ بـ A, B, C)
- تحديث trigger `validate_system_dropdown_option` لقبول الـ category الجديد

### Trigger لحساب سعر الوكيل
يحسب `agent_price = company_price + (percentage% أو fixed)` قبل INSERT/UPDATE.

### حذف القديم
- `DROP TABLE agent_service_pricing` (المستخدم أكد الحذف)

### الصلاحيات والـ RLS
- GRANT للـ authenticated + service_role
- RLS: authenticated يقدر يقرأ/يكتب (نفس نمط باقي الجداول التشغيلية)

---

## 2) واجهة الـ UI

### تبويب جديد داخل صفحة الشركة (`companies.tsx`)
تبويب "ملف التسعير" يظهر عند تعديل/فتح شركة. يحتوي:
- جدول بكل الحقول حسب الترتيب المطلوب (12 عمود)
- زر إضافة صف، تعديل سطري، حذف
- زر "استيراد من شركة أخرى" → modal فيه:
  - dropdown اختيار الشركة المصدر
  - radio: كل الخدمات / خدمة محددة
  - radio: استبدال / دمج
- كل dropdown مربوط بـ `useDropdownOptions(...)` الموجود
- حقل سعر الوكيل readonly + محسوب تلقائياً client-side للعرض الفوري

### حقل في صفحة الوكيل
- إضافة dropdown "شريحة الوكيل" مربوط بـ `agent_tier`

### حذف الكود القديم
- حذف `src/components/AgentPricingSection.tsx`
- حذف استخدامه من صفحة الوكيل
- إزالة spec `agent_pricing` من `src/lib/dataImport/specs.ts`

---

## 3) منطق المطابقة في التنفيذ

دالة جديدة `src/lib/pricingMatch.ts`:

```text
resolveAgentPrice({ companyId, agentId, serviceType, departureFrom?, 
                    destination?, airline?, approvalCompanyId?, 
                    status?, passengerType? })
```

خطوات:
1. اقرأ شريحة الوكيل من جدول agents
2. اقرأ كل قواعد التسعير حيث company_id = X و service_type = Y و agent_tier = Z
3. لكل قاعدة: تأكد أن كل حقل غير NULL في القاعدة يطابق المُدخل
4. احسب درجة التحديد = عدد الحقول غير الفارغة المطابقة
5. اختر القاعدة بأعلى درجة (لو تساوي → الأحدث)
6. أرجع agent_price، أو null + رسالة لو ما في مطابقة

استدعاء من `executions.tsx` و `submissions.tsx` عند تغيير الشركة/الوكيل/الخدمة → ملء `agent_price` تلقائياً مع رسالة "لم يتم العثور على سعر مطابق" لو فشلت المطابقة.

---

## 4) الصلاحيات

إضافة key جديد `pricing` في `SECTION_KEYS` ضمن `usePerm.tsx`:
- view, create, edit, delete, export (الـ export = استيراد)

تطبيق `usePerm("pricing")` على تبويب ملف التسعير وأزرار الاستيراد.

تحديث شاشة الصلاحيات (`settings.tsx`) لعرض القسم الجديد.

---

## 5) الملفات المتأثرة

**جديد:**
- migration واحد (جدول جديد + tier + dropdown + trigger + DROP القديم)
- `src/components/CompanyPricingTab.tsx`
- `src/components/PricingImportModal.tsx`
- `src/lib/pricingMatch.ts`

**تعديل:**
- `src/routes/companies.tsx` — إضافة التبويب
- `src/routes/executions.tsx` + `src/routes/submissions.tsx` — استدعاء resolveAgentPrice
- صفحة الوكيل (في `accounts.tsx` أو ما شابه) — حقل tier
- `src/hooks/usePerm.tsx` + `src/routes/settings.tsx` — صلاحية pricing
- `src/lib/db.ts` — hooks لقراءة قواعد التسعير live
- `src/lib/dataImport/specs.ts` — إزالة `agent_pricing`

**حذف:**
- `src/components/AgentPricingSection.tsx`
- جدول `agent_service_pricing` من DB

---

## 6) مثال عملي

**قواعد شركة "X" للخدمة "تأشيرة":**

| service | tier | destination | airline | company_price | type | value | → agent_price |
|---------|------|-------------|---------|---------------|------|-------|---------------|
| تأشيرة | A | — | — | 1000 | % | 10 | 1100 |
| تأشيرة | A | ليبيا | — | 1000 | fixed | 150 | 1150 |
| تأشيرة | B | — | — | 1000 | % | 5 | 1050 |

**تنفيذ:** شركة=X، وكيل شريحته A، خدمة=تأشيرة، وجهة=ليبيا، طيران=مصر للطيران
- القاعدة 1 تطابق (0 حقول اختيارية مملوءة)
- القاعدة 2 تطابق (1 حقل = الوجهة)
- القاعدة 3 لا تطابق (شريحة مختلفة)
- → يُختار صف 2، السعر = 1150

**استيراد:** فتح شركة Y → ملف التسعير → استيراد من X → اختيار "تأشيرة" فقط + "دمج" → ينسخ كل قواعد تأشيرة من X إلى Y.

---

## 7) قيود الأمان

- Migration يستخدم `IF NOT EXISTS` لكل CREATE
- `DROP TABLE agent_service_pricing` (تأكيد المستخدم على الحذف)
- لا تعديل على auth/invites/الصلاحيات الحالية عدا إضافة pricing
- GRANT صريح على الجدول الجديد قبل RLS