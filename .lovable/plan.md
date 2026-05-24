
# خطة إعادة هيكلة قسم العمليات

## الفكرة الأساسية

دمج (موافقات + تذاكر طيران + استثمار ليبي) في قسمين موحّدين:

1. **التقديمات** = متابعة وتجهيز فقط، **لا تأثير مالي إطلاقًا**.
2. **التنفيذ** = هو القسم الوحيد الذي يُنشئ الحركات على حسابات الوكلاء/الشركات ويُظهر الأرقام في الداشبورد والتقارير.

> الأقسام القديمة (`/flights`, `/approvals`, `/libyan-investment`) ستُحذف من القائمة الجانبية، لكن **الجداول في قاعدة البيانات تبقى كما هي** ولن نلمس بياناتها (لا فقد بيانات). البيانات القديمة تبقى ظاهرة في كشوف الحسابات لأنها مرتبطة بـ `transactions` / `company_transactions` السابقة.

---

## 1) قاعدة البيانات (Migration آمن)

جدولان جديدان فقط، بدون أي تعديل على الجداول الحالية:

### `submissions` (التقديمات — لا مالية)
- `id`, `created_at`, `updated_at`
- `services text[]` — Multi-select: `security_approval` / `flight_ticket` / `libyan_investment`
- `passenger_name`, `national_id`, `dob`, `passport`, `birth_place`
- `agent_id` (uuid)، `status` (نص — من dropdown)
- `departure_from` (الجهة = جهة المغادرة)
- `submit_date`, `issue_date`, `approval_authority`
- `notes`
- `executed_at` (nullable) — يُملأ عند التحويل للتنفيذ
- `execution_id` (nullable) — مرجع للسجل في `executions`

### `executions` (التنفيذ — هو الوحيد المالي)
- `id`, `created_at`, `updated_at`
- `submission_id` (nullable) — لو جاي من تقديم
- `passenger_name`, `national_id`, `dob`, `passport`, `birth_place`
- `agent_id`, `status` (قيد التنفيذ / منفذ / ملغي / مؤجل)
- `departure_from`, `destination`, `airline`, `travel_date`
- `notes`
- `services jsonb` — مصفوفة عناصر `{ service_type, company_id, count, agent_price, company_price, company_value }` لدعم تنفيذ أكثر من خدمة لنفس العميل
- روابط مالية: عند التنفيذ نُدرج صفوف في `transactions` و `company_transactions` بنفس النمط الحالي (`source_service_id` = `executions.id`, `source_service_type` = `'execution'`) لتظل كشوف الحسابات تعمل بدون أي تغيير في حساباتها.

### دروب‑داون جديدة قابلة للإدارة من الإعدادات
أضف categories جديدة في `system_dropdown_options`:
- `execution_status`, `submission_status`, `departure_from`, `service_kind`
(الـ `airline` / `destination` موجودة بالفعل، نُعيد استخدامها.)

### RLS
نفس نمط جداول العمليات الحالية (`auth` insert/select/update/delete = true).

### Realtime
إضافة الجدولين إلى `supabase_realtime` مع `REPLICA IDENTITY FULL`.

### الصلاحيات الجديدة (في `profiles.permissions`)
قسم `executions`: `view / add / edit / delete / approve / export`
قسم `submissions`: `view / add / edit / delete / export / convert`
(تُضاف في `usePerm.tsx` بنفس النمط الحالي ولا تكسر الموجود.)

---

## 2) واجهة المستخدم

### قائمة جانبية
- إخفاء: تذاكر طيران / موافقات / استثمار ليبي.
- إضافة: **التقديمات** (`/submissions`)، **التنفيذ** (`/executions`).
- (لا حذف للراوتس القديمة من الكود الآن — تبقى مخفية كي لا نكسر روابط داخلية، ويمكن حذفها لاحقًا.)

### صفحة `/submissions`
- جدول RTL بنفس ستايل ERP الحالي، فلاتر + بحث + Realtime عبر `useLive`.
- نموذج إضافة/تعديل بالحقول المطلوبة + Multi-select للخدمات.
- زر **«تحويل إلى تنفيذ»** ينقل البيانات تلقائيًا ويفتح نموذج التنفيذ مع ربط `submission_id`.

### صفحة `/executions`
- جدول مطابق لتنسيق Excel المعتاد في النظام (نفس أعمدة `flights` الحالية + عمود الخدمات).
- نموذج تنفيذ متعدد الخدمات (تكرار صف خدمة داخل النموذج).
- عند الحفظ بحالة «منفذ» → إنشاء صفوف في `transactions` + `company_transactions` لكل خدمة (إعادة استخدام `postServiceFinancials` بعد توسيع نوع `ServiceKind` ليقبل `execution`).
- تغيير الحالة لـ «ملغي» → حذف الصفوف المالية المرتبطة (`deleteServiceLinkedRows`).
- جميع الحقول المطلوبة Dropdown من `system_dropdown_options`.

### الداشبورد والتقارير
- لا تغيير في منطقها؛ تستمر بالقراءة من `transactions` / `company_transactions`. وبما أن التنفيذ هو الوحيد الذي يكتب فيها، يتحقق الشرط «التقديمات لا تؤثر ماليًا» تلقائيًا.

---

## 3) التفاصيل التقنية (للمراجعة)

- ملف migration واحد ينشئ الجدولين + الـ dropdowns + Realtime + الصلاحيات الافتراضية.
- `src/lib/db.ts`: إضافة `Submission` و `Execution` types + إدخالهما في union `useLive`.
- `src/lib/servicePosting.ts`: توسيع ليقبل قائمة خدمات من سجل تنفيذ واحد.
- `src/routes/submissions.tsx` و `src/routes/executions.tsx` صفحتان جديدتان (بنفس باترن `flights.tsx`).
- `src/components/Layout.tsx`: تحديث القائمة.
- `src/hooks/usePerm.tsx` + `RouteGuard`: إضافة المفاتيح الجديدة.
- `src/routes/settings.tsx`: تبويب الصلاحيات يعرض المفاتيح الجديدة تلقائيًا، وتبويب القوائم المنسدلة يعرض الـ categories الجديدة.

---

## 4) ما لن يتغيّر

- منطق كشف حساب الوكيل ✅
- شكل وحسابات `transactions` / `company_transactions` ✅
- البيانات القديمة في `flights` / `approvals` / `libyan_investment` ✅
- نظام RTL، الستايل، Lovable Cloud Auth ✅
- نسخة Production والـ Supabase الخارجي ✅

---

## 5) خارج نطاق هذه المرحلة (نتفق عليها لاحقًا)

- ربط التنفيذ بالخزائن وطرق الدفع تفصيليًا (مذكور في الطلب أنه «لاحقًا»).
- حذف الأقسام القديمة نهائيًا من الكود (نُبقيها مخفية الآن لسلامة الانتقال).

---

هل أبدأ التنفيذ بهذا الشكل؟ أو تريد تعديل أي جزء قبل ما أبدأ؟
