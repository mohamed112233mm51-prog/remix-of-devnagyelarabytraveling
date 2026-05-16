# خطة: ربط تقديم الخدمة بالحسابات المالية

> ملاحظة: كشف حساب الوكيل يبقى كما هو 100% — لا تغيير في الأعمدة أو الحسابات. كل ما سيتم هو إنشاء سجلات `transactions` / `company_transactions` تلقائياً حتى يظهر الدين فيها مباشرة.

---

## 1) Database Migration

أضف الأعمدة التالية:

**جدول `flights` و `approvals`** (لحفظ المالية مع الخدمة):
- `count` INTEGER DEFAULT 1
- `price` NUMERIC DEFAULT 0  (سعر الوحدة على الوكيل)
- `company_value` NUMERIC DEFAULT 0  (قيمة الشركة الصادرة)

**جدول `transactions` و `company_transactions`** (لربط الحركة بالخدمة):
- `source_service_id` UUID
- `source_service_type` TEXT  (`flight_ticket` | `security_approval` | `libyan_investment`)
- INDEX على `source_service_id`

(لن يتم تعديل أي بيانات قديمة — السجلات الحالية تبقى كما هي بدون ربط)

---

## 2) نموذج "تقديم خدمة" — حقول جديدة

في كل من `FlightForm` / `ApprovalForm` / `InvestmentForm` أضف:
- **العدد** (`count`) — افتراضي 1
- **السعر** (`price`) — سعر الوحدة
- **قيمة الرحلة** (`count × price`) — محسوب تلقائياً ومعطّل
- **قيمة الشركة الصادرة** (`company_value`) — حقل منفصل

عند الحفظ (`save`):
1. حفظ الخدمة كما هو الآن في `flights` / `approvals`.
2. **إنشاء حركة وكيل تلقائياً** في `transactions`:
   - `agent_id`, `date` = `travel_date` أو اليوم
   - `destination`, `count`, `price`, `service_type` (الاسم العربي)
   - `travel_statement` = البيان التلقائي
   - `total_paid` = 0, `paid` = 0  ← يظهر كدين كامل في كشف حساب الوكيل
   - `note` = اسم المسافر
   - `source_service_id` = id الخدمة, `source_service_type` = نوع الخدمة
3. **إنشاء حركة شركة تلقائياً** في `company_transactions`:
   - `company_id` = id الشركة المختارة
   - `date`, `destination`, `count` = 1, `price` = `company_value`, `trip_value` = `company_value`
   - `service_type` (الاسم العربي), `total_paid` = 0
   - `source_service_id`, `source_service_type`
4. عند تعديل الخدمة (Edit modals): UPDATE الحركات المرتبطة عبر `source_service_id` بنفس القيم.
5. مساعد `deleteServiceLinkedRows(id)` يحذف السجلات المرتبطة (للاستخدام مستقبلاً مع زر الحذف).

كل ذلك في ملف مساعد جديد: `src/lib/servicePosting.ts`.

---

## 3) تعديل نموذج "إضافة حركة" للوكلاء (`TxnForm` في accounts.tsx)

الحقول بنفس الترتيب المطلوب:
1. الوكيل
2. التاريخ
3. نوع الخدمة
4. **الخدمة المستحقة** (Dropdown جديد) — يعرض الخدمات غير المسددة لهذا الوكيل + نوع الخدمة المختار (سجلات `transactions` المرتبطة بـ `source_service_id` حيث المدفوع < قيمة الرحلة)
5. العدد، السعر، قيمة الرحلة، الوجهة → تُجلب تلقائياً من الخدمة المختارة (قراءة فقط)
6. طريقة الدفع (كما هي حالياً: انستا / نقدي / كاش تاجر / نقدي تاجر)
7. بيان السفر (تلقائي كما هو)

**عند الحفظ:** بدلاً من INSERT جديد، يتم **UPDATE** للسجل المختار في `transactions` بقيم الدفع الجديدة (instapay/cash/merchant + total_paid + merchant_id). هكذا يبقى نفس سطر الدين في كشف الحساب لكن يظهر "المدفوع" و"الصافي = 0" بعد السداد.

(لو لم يختر المستخدم خدمة مستحقة، يسلك السلوك القديم: INSERT جديد، حفاظاً على المرونة للحركات اليدوية.)

---

## 4) ما لن يتغير

- كشف حساب الوكيل (`AgentStatementTab`): نفس الأعمدة، نفس الحسابات، نفس التصدير.
- السجلات اليدوية القديمة في `transactions`/`company_transactions`: تبقى كما هي.
- صفحات الموافقات / الرحلات / الاستثمار: نفس الأعمدة المعروضة (الحقول الجديدة تُحفظ فقط ولا تُضاف للجداول لتجنب كسر التخطيط).
- الصلاحيات، التقارير، المصاريف، المستثمرين.

---

## 5) ملفات سيتم تعديلها

| الملف | التغيير |
|---|---|
| `supabase/migrations/<new>.sql` | إضافة الأعمدة + الفهارس |
| `src/integrations/supabase/types.ts` | يتحدث تلقائياً |
| `src/lib/db.ts` | إضافة الحقول الجديدة لأنواع `Flight` و `Approval` |
| `src/lib/servicePosting.ts` | **جديد** — دوال `postServiceFinancials` / `updateServiceFinancials` / `deleteServiceLinkedRows` |
| `src/routes/flights.tsx` | إضافة حقول count/price/company_value + استدعاء servicePosting في FlightForm وEditFlightModal |
| `src/routes/approvals.tsx` | نفس الشيء في ApprovalForm وEditApprovalModal |
| `src/routes/libyan-investment.tsx` | نفس الشيء في InvestmentForm وEditInvestmentModal |
| `src/routes/accounts.tsx` | تعديل `TxnForm`: dropdown الخدمة المستحقة + autofill + UPDATE بدل INSERT عند اختيار خدمة |

---

## 6) خطوات التنفيذ

1. الـ migration أولاً (يحتاج موافقتك قبل التنفيذ).
2. تحديث `db.ts` بالأنواع.
3. إنشاء `src/lib/servicePosting.ts`.
4. تعديل الـ 3 نماذج تقديم + تعديل المودالات.
5. تعديل `TxnForm` في accounts.
6. التحقق من البناء.

هل أمضي بهذه الخطة؟
