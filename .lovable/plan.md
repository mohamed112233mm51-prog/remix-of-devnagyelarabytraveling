## نظرة عامة
إضافة زر "توليد داتا جاهزة" + زر "حذف الداتا التجريبية" في صفحة الإعدادات، يظهر فقط للـ Admin وفقط في وضع التطوير (`import.meta.env.DEV`). الزر ينشئ بيانات تجريبية واقعية موسومة بـ `is_demo = true` بدون المساس بأي بيانات حقيقية.

## 1) تغييرات قاعدة البيانات (Migration)
إضافة عمود `is_demo BOOLEAN NOT NULL DEFAULT false` إلى الجداول:
- `agents`
- `issuing_companies`
- `merchants`
- `investors`
- `flights`
- `approvals`
- `transactions` (المدفوعات/التحصيلات/البيع)
- `company_transactions`
- `merchant_cash_collections`
- `investor_transactions`
- `expenses`
- `expense_deductions`

(لا تغيير في الأعمدة الأخرى أو RLS أو الدوال — الجداول الموجودة سياستها `open_all`.)

## 2) Server Functions جديدة (`src/lib/demo-data.functions.ts`)
محمية بـ `requireSupabaseAuth` + فحص دور admin (نفس نمط `admin.functions.ts`):

- `checkDemoData()` → يرجع عدد السجلات `is_demo=true` لكل جدول.
- `generateDemoData()` → ينشئ:
  - 6 وكلاء، 4 شركات مصدرة، 4 تجار، 3 مستثمرين
  - 25 رحلة، 20 موافقة أمنية
  - 30 معاملة بيع/مدفوعات (transactions)
  - 10 تحصيلات تجار، 8 معاملات مستثمرين
  - 12 مصروف + بعض الخصومات
  - تواريخ موزعة على آخر 60 يومًا، أسماء/مبالغ واقعية بالعربية
  - الكل بـ `is_demo = true`
  - يرجع ملخص أعداد ما تم إدراجه
- `deleteDemoData()` → `DELETE WHERE is_demo = true` لكل الجداول السابقة، يرجع الأعداد المحذوفة.

كل العمليات تستخدم `supabaseAdmin` (server-side فقط)، لا تلمس صفًا حيث `is_demo = false`.

## 3) واجهة المستخدم
في `src/routes/settings.tsx` — قسم جديد "أدوات التطوير" يظهر فقط عندما:
```ts
import.meta.env.DEV && isAdmin
```
يحتوي على:
- زر **"توليد داتا جاهزة"** — gold style (نفس `.btn-gold-primary` الموجودة) مع أيقونة `Database` بيضاء ونص داكن.
- زر **"حذف الداتا التجريبية"** — variant خطر (أحمر) أو outline.
- عند الضغط:
  1. يستدعي `checkDemoData()`.
  2. لو فيه بيانات تجريبية → AlertDialog تحذير "يوجد X سجلات تجريبية، هل تريد إضافة المزيد؟".
  3. AlertDialog تأكيد قبل التوليد.
  4. بعد التنفيذ → toast نجاح + Dialog ملخص بأعداد كل نوع.
- زر الحذف بنفس الفكرة: AlertDialog تأكيد ثم تنفيذ + toast.

## 4) ضمانات الأمان
- التحقق من `import.meta.env.DEV` في الواجهة (يختفي تمامًا في الإنتاج).
- التحقق من دور admin في الـ server function (لا يكفي إخفاء الواجهة).
- كل INSERT/DELETE مقيّد بـ `is_demo = true`.
- لا تغيير في منطق الأعمال أو التقارير أو الصلاحيات.

## ملاحظات تقنية
- التقارير تعرض كل البيانات تلقائيًا (بما فيها التجريبية) بدون تعديل، وهذا مطلوب للديمو.
- لا حاجة لتحديث `types.ts` يدويًا — يتولد تلقائيًا بعد الـ migration.
- لا تغيير في `erp.css` (نستعمل كلاس الذهبي الموجود).

هل أبدأ التنفيذ؟
