# مركز استيراد البيانات

نظام استيراد احترافي من Excel/CSV مع Smart Column Mapping، Validation كامل، منع التكرار، Preview قبل الحفظ، وتراجع (Undo) عن آخر استيراد.

## الملفات والمسارات

### 1. مكتبات
- إضافة `xlsx` و `papaparse` عبر `bun add xlsx papaparse`.

### 2. مسار جديد
- `src/routes/data-import.tsx` — صفحة "مركز استيراد البيانات".
- إضافة رابط في `src/components/Layout.tsx` (Sidebar) بصلاحية Admin فقط.

### 3. منطق الاستيراد
- `src/lib/dataImport/types.ts` — أنواع `ImportType`, `ColumnSpec`, `RowResult`.
- `src/lib/dataImport/specs.ts` — مخطط لكل نوع (9 أنواع):
  - حقول مطلوبة/اختيارية، أنواع (string/number/date/lookup)، أسماء مرادفة بالعربي للـ Smart Mapping.
- `src/lib/dataImport/parse.ts` — قراءة xlsx/csv → `{headers, rows}`.
- `src/lib/dataImport/mapper.ts` — اقتراح ربط الأعمدة (تطبيع + Levenshtein بسيط + مرادفات).
- `src/lib/dataImport/validate.ts` — تنفيذ Validation لكل صف حسب المخطط، إرجاع `{valid, errors, duplicates}`.
- `src/lib/dataImport/dedupe.ts` — مفاتيح فريدة لكل نوع (passport+date+name، agent+date+amount...).
- `src/lib/dataImport/lookups.ts` — مطابقة أسماء الوكلاء/الشركات/التجار مع الكاش الحالي (`useLive`).
- `src/lib/dataImport/insert.ts` — Batch insert (100 صف/دفعة) عبر `supabase.from(table).insert([...])` مع تسجيل العملية.
- `src/lib/dataImport/templates.ts` — توليد ملف Excel نموذج لكل نوع.

### 4. جدول سجل الاستيراد (Migration)
- `import_batches` (id, type, user_email, file_name, rows_inserted, inserted_ids jsonb, created_at).
- RLS: `has_role(auth.uid(), 'admin')` فقط للقراءة/الكتابة.
- Undo = حذف الصفوف الموجودة في `inserted_ids` من جدول النوع.

## واجهة المستخدم (data-import.tsx)

تدفق 4 خطوات في wizard واحد بنفس design tokens الحالية (Navy + Gold):

1. **اختيار النوع** — شبكة 9 كروت (وكلاء، شركات، رحلات، موافقات، استثمار ليبي، حركات مالية، مصروفات، تجار، تسعير). كل كرت فيه زر "تحميل النموذج".
2. **رفع الملف** — Drag & Drop area + input file. عرض اسم الملف وعدد الصفوف بعد القراءة.
3. **Mapping** — جدول صفّان: عمود قاعدة البيانات (من المخطط) ↔ Select فيه أعمدة الملف. اقتراحات تلقائية مع إمكانية التعديل. تمييز الحقول المطلوبة بنجمة.
4. **Preview + استيراد** — Cards: إجمالي، صالح، أخطاء، مكرر. جدول أول 20 صف صالح + جدول الأخطاء (رقم الصف + العمود + السبب). زر "تنفيذ الاستيراد" → Progress bar حقيقي (batch by batch) → toast نجاح + إظهار زر "تراجع".

شريط جانبي: آخر 10 عمليات استيراد مع زر Undo لكل واحدة.

## القرارات التقنية

- **بدون refetch**: استخدام `patchLive` بعد كل batch لتحديث الكاش فوريًا، والـ Realtime channels الحالية تتولى المزامنة مع باقي المستخدمين.
- **Smart Mapping**: dictionary مرادفات (مثال: `agent_name ← ["اسم الوكيل","الوكيل","العميل","المندوب"]`) + تطبيع (إزالة مسافات/تشكيل) + fallback تشابه نصي.
- **Lookup**: أسماء الوكلاء/الشركات/التجار تُحوَّل لـ id عبر الكاش الحالي. لو غير موجود → خطأ في الصف.
- **منع التكرار**: قبل الاستيراد، بناء `Set` من المفاتيح الموجودة في الكاش لنفس النوع، ثم تجاهل الصفوف التي مفتاحها موجود.
- **Batch**: 100 صف/دفعة، `await` بين الدفعات، تحديث progress.
- **Async**: استخدام `requestIdleCallback`/`setTimeout(0)` بين الدفعات لمنع التجميد.
- **Undo**: حذف بـ `delete().in('id', inserted_ids)` ثم حذف سجل `import_batches`.
- **الصلاحية**: التحقق من `useAuth` + `useRole('admin')` قبل عرض الصفحة وقبل الاستيراد.

## الأمان والتحقق

- Zod schema لكل نوع داخل `validate.ts`.
- حدود طول للنصوص (≤255)، تواريخ ISO صالحة، أرقام ≥0.
- RLS بالفعل مفعّل على كل الجداول.
- سجل كل عملية في `activity_logs` + `import_batches`.

## خارج النطاق (هذه الجولة)

- لا تعديل على صفحات الـ ERP الأخرى.
- لا تغيير على منطق الحفظ الموجود.
- التحديث اللحظي يعتمد على القنوات الحالية (`useLive`) بدون إضافة قنوات جديدة.
