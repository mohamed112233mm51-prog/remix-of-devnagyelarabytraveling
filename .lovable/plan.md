# خطة: إضافة الرصيد السابق للتجار، موردي العملة، وخزائن الشركة

نُطبّق نفس نموذج ومنطق الرصيد السابق المستخدم حالياً في الوكلاء والشركات (حقول `opening_debit` / `opening_credit` على الجهة + سطر افتتاحي في جدول الحركات) على الجهات الثلاث المطلوبة، مع دعم العملة ومنع التكرار وصلاحية مخصصة.

## 1) قاعدة البيانات (migration واحدة)

- `merchants`:
  - `opening_debit numeric default 0`, `opening_credit numeric default 0`
  - `opening_date date`, `opening_note text`, `opening_currency text default 'EGP'`
- `currency_suppliers`:
  - نفس الأعمدة أعلاه
- `cash_boxes`:
  - `opening_balance numeric default 0`, `opening_date date`, `opening_note text` (العملة موجودة أصلاً على الخزينة)
- `merchant_cash_collections`, `currency_supplier_transactions`, `usd_treasury_transactions`:
  - `source_service_type text`, `source_service_id uuid` (لتعليم السطر الافتتاحي بشكل ثابت مثل ما هو موجود في transactions/company_transactions)
- فهارس فريدة جزئية لمنع التكرار لنفس الجهة + نفس العملة:
  - `unique (merchant_id, opening_currency, source_service_type)` where `source_service_type in ('opening_debit','opening_credit')`
  - نفس الشيء لموردي العملة و للخزائن (`cash_box_id`)

## 2) صلاحية جديدة

- مفتاح صلاحية واحد: `manage_opening_balance` (إضافة/تعديل/حذف الرصيد السابق لأي جهة).
- يُستخدم عبر `usePerm` لتفعيل/تعطيل حقول الرصيد السابق في النماذج.

## 3) `src/lib/openingBalance.ts` (توسيع)

نضيف:

- `syncMerchantOpeningBalance(merchantId, { debit, credit, currency, date, note })`
  - يمسح السطور القديمة (`source_service_type in (opening_debit, opening_credit)` + `merchant_id`) ثم يُدرج سطراً واحداً أو اثنين في `merchant_cash_collections` بعلامة `service_type: 'رصيد سابق'`.
- `syncCurrencySupplierOpeningBalance(supplierId, {...})`
  - نفس الفكرة على `currency_supplier_transactions`.
- `syncCashBoxOpeningBalance(cashBoxId, { amount, date, note })`
  - يمسح السطور الافتتاحية القديمة من `usd_treasury_transactions` للخزينة، ثم يُدرج سطر افتتاحي واحد بـ `service_type: 'رصيد افتتاحي'`.
  - يُحدّث `cash_boxes.balance` ليعكس الرصيد الافتتاحي + مجموع الحركات (أو نعتمد على trigger `apply_payment_split_to_cash_box` القائم إذا أُدرج السطر عبر `payment_splits`).

كل الحركات تمرّ بنفس نمط الجدول المعني، فلا يوجد منطق منفصل.

## 4) واجهة المستخدم

- `src/routes/merchants.tsx`: قسم "رصيد سابق" في نموذج التاجر (مدين/دائن/تاريخ/عملة/ملاحظات) + عرض في بطاقة الملف. ينادي `syncMerchantOpeningBalance` بعد الحفظ.
- `src/routes/currency-suppliers.tsx`: نفس القسم على مورد العملة.
- `src/routes/accounts.tsx` (تبويب الخزائن) أو مكان إدارة الخزائن: حقل "رصيد افتتاحي" لكل خزينة + زر تعديل محمي بالصلاحية.

عند وجود رصيد سابق مسبق لنفس الجهة/العملة يظهر التنبيه: **"يوجد رصيد سابق لهذه الجهة بهذه العملة"** — وزر التعديل يعمل فقط لمن يملك `manage_opening_balance`.

## 5) الظهور في كشوف الحساب والتقارير

- كشف حساب التاجر (`src/routes/merchants.tsx` / تبويب الكشف) — يقرأ من `merchant_cash_collections` أصلاً؛ السطر الافتتاحي سيظهر تلقائياً في الأعلى (نفرزه بـ `date` ثم بـ `source_service_type` ليكون أول سطر).
- كشف مورد العملة (`currency-supplier-statement.$supplierId.tsx`) — نفس المنطق.
- كشف حركة الخزينة والتقارير (`reports.tsx`) — تتضمّن السطر الافتتاحي تلقائياً لأن مصدر البيانات نفسه.
- الرصيد الحالي وكروت الداشبورد والتحقق قبل الصرف (`balanceGuard.ts`) — يعتمدون على مجموع الحركات، فيدخل الرصيد الافتتاحي فوراً بدون تعديل إضافي.
- التصدير (`exportStatement.ts`) — يتبع نفس المصدر، يظهر السطر الافتتاحي.

## 6) الاختبارات اليدوية المطلوبة

1. إدخال رصيد سابق لتاجر (EGP و USD) → ظهور سطرين افتتاحيين، وتغيّر الرصيد.
2. إدخال رصيد سابق لمورد عملة (LYD) → ظهور في الكشف والرصيد.
3. إدخال رصيد افتتاحي لخزينة → ظهور في كشف الخزينة، تقرير الخزائن، كارت الداشبورد، ومنع الصرف عند تجاوز الرصيد.
4. محاولة إدخال رصيد سابق ثانٍ لنفس الجهة/العملة → رسالة "يوجد رصيد سابق…" ورفض الإدراج.
5. مستخدم بدون صلاحية `manage_opening_balance` → الحقول للقراءة فقط.

## تفاصيل تقنية

- كل الحركات الافتتاحية تُعلّم بـ `source_service_type = 'opening_debit' | 'opening_credit' | 'opening'` و `source_service_id = <entity id>`، بنفس الاصطلاح المستخدم للوكلاء والشركات.
- منع التكرار على مستوى قاعدة البيانات عبر unique index جزئي، مع رسالة خطأ عربية في الواجهة.
- لا توجد حركات مالية جديدة خارج جداول الحركات القائمة — لا حاجة لتوسيع `financialEngine.postMovement` لهذه المرحلة، لأن `cash_boxes.balance` يُحدّث عبر trigger موجود، والتجار/موردي العملة يعتمدون على مجموع صفوف الجداول الخاصة بهم.

هل تريد المتابعة بهذا التنفيذ؟
