# قسم حسابات موردي العملة

قسم مستقل تمامًا، بنفس أسلوب "حسابات الوكلاء" و"حسابات الشركات الصادرة"، بدون أي ارتباط بالوكلاء/الشركات/تجار الكاش.

## 1. قاعدة البيانات (Migration)

جدولان جديدان في `public`:

### `currency_suppliers`
- `id` uuid PK
- `name` text NOT NULL (اسم المورد)
- `phone` text
- `notes` text
- `status` text default 'نشط'
- `created_at`, `updated_at`

### `currency_supplier_transactions`
- `id` uuid PK
- `supplier_id` uuid FK → currency_suppliers
- `tx_date` date NOT NULL
- `tx_type` text NOT NULL CHECK in ('شراء عملة','بيع عملة')
- `bought_currency` text NOT NULL  (العملة المشتراة)
- `bought_amount` numeric NOT NULL  (قيمة العملة المشتراة)
- `sold_currency` text NOT NULL  (العملة المباعة)
- `sold_amount` numeric NOT NULL  (قيمة العملة المباعة)
- `description` text
- `created_by` uuid
- `created_at`, `updated_at`

GRANTs لـ authenticated + service_role، RLS مفعّل، policies تسمح للمستخدم المسجّل بالقراءة/الكتابة (نفس نمط الجداول الحالية في المشروع).

تحديث خزائن العملات: عند الحفظ من الواجهة، نزيد رصيد خزينة `bought_currency` بـ `bought_amount`، وننقص خزينة `sold_currency` بـ `sold_amount`، عبر `cash_boxes` (نفس الجدول المستخدم حاليًا). لا triggers — المنطق في الواجهة ليبقى متّسقًا مع باقي النظام.

## 2. Routes

- `src/routes/currency-suppliers.tsx` — قائمة الموردين + إضافة/تعديل + زر "كشف الحساب".
- `src/routes/currency-supplier-statement.$supplierId.tsx` — كشف حساب المورد.

تسجيلهما في `routeTree.gen.ts` (يتم تلقائيًا).

## 3. الواجهات

### قائمة الموردين
- جدول بأعمدة: الاسم، الهاتف، الحالة، إجراءات (تعديل/كشف الحساب/حذف).
- زر "إضافة مورد" يفتح Modal.
- نفس مكوّنات `ColumnFilter` و`ColumnVisibility` و`SearchBox` المستخدمة في `accounts.tsx`.

### كشف حساب المورد
- ترويسة: اسم المورد + ملخص أرصدة لكل عملة (صافي = مشترى - مباع لكل عملة).
- شريط أدوات: فلاتر (تاريخ من/إلى، نوع الحركة، العملة)، زر "إضافة حركة شراء"، زر "إضافة حركة بيع"، زر التصدير الموحّد (`ExportButton`) — Excel/PDF.
- جدول بأعمدة:
  - التاريخ
  - نوع الحركة
  - العملة المشتراة
  - قيمة العملة المشتراة
  - العملة المباعة
  - قيمة العملة المباعة
  - البيان
  - الرصيد الحالي (نعرض رصيد جاري بالعملة الأساسية المختارة في الفلتر؛ بدون فلتر يُعرض "متعدد")

### Modal الحركة (شراء/بيع)
حقول:
- التاريخ (افتراضي اليوم)
- نوع الحركة (مُحدّد مسبقًا حسب الزر)
- العملة المشتراة + قيمتها
- العملة المباعة + قيمتها
- البيان

عند الحفظ:
1. insert في `currency_supplier_transactions`.
2. update `cash_boxes`: +bought / -sold للعملات المناظرة.
3. toast نجاح + إعادة تحميل.

## 4. القائمة الجانبية

إضافة عنصر جديد في `src/components/Layout.tsx` تحت قسم "الحسابات المالية":
- `حسابات موردي العملة` → `/currency-suppliers` (أيقونة Coins من lucide).
- `permKey: "currency_suppliers"` (نضيفه إلى نظام الصلاحيات).

## 5. التصدير

استخدام `ExportButton` الحالي مع `exportStatement` لتصدير الأعمدة المرئية مع احترام الفلاتر — نفس الأسلوب في كشف حساب الوكيل تمامًا.

## 6. لا يُمسّ

- لا تعديل في: agents, companies, merchants, executions, submissions, expenses.
- لا تغيير في أي منطق حسابي قائم.
- لا تعديل على جدول `cash_boxes` نفسه (نستخدمه فقط).

## الملفات المعدّلة/المنشأة

- `supabase/migrations/<new>.sql` — جدولان + GRANT + RLS + policies.
- `src/routes/currency-suppliers.tsx` (جديد)
- `src/routes/currency-supplier-statement.$supplierId.tsx` (جديد)
- `src/components/Layout.tsx` — عنصر قائمة جديد + permKey.
- `src/hooks/usePerm.tsx` — إضافة مفتاح صلاحية `currency_suppliers` للقائمة الافتراضية.
- `src/integrations/supabase/types.ts` — يُعاد توليده بعد الـ migration.

بعد موافقتك أبدأ بـ migration ثم بقية التنفيذ.
