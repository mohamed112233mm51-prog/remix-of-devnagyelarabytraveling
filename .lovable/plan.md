## الهدف
توحيد كل الحركات المالية في النظام على **محرك مالي واحد** يقرأ ويكتب من `payment_splits` فقط، مع الحفاظ على قاعدة البيانات الحالية بدون إضافة جداول أو تغيير schema.

## المصدر الوحيد للحقيقة (Single Source of Truth)
- **جدول واحد للحركات**: `payment_splits` (يحمل: `direction`, `amount`, `currency`, `cash_box_id`, `source_table`, `source_id`, `transaction_id`).
- **رصيد الخزنة**: `cash_boxes.balance` (يتحدّث تلقائياً عبر التريجر `apply_payment_split_to_cash_box` الموجود بالفعل).
- **ربط الجهة بالحركة**: عبر `source_table` + `source_id` — حيث يشير للجدول الأم (transactions للوكيل، company_transactions للشركة، currency_supplier_transactions للمورد، merchant_cash_collections للتاجر، expenses للمصروف).

## المحرك المالي — `src/lib/financialEngine.ts` (ملف جديد)

### واجهة الكتابة (نقطة واحدة)
```ts
type PartyType = 'agent' | 'company' | 'currency_supplier' | 'merchant' | 'expense' | 'treasury';
type MovementKind = 'receipt' | 'payment' | 'transfer' | 'settlement' | 'refund';

postMovement({
  partyType, partyId,
  kind,                    // receipt/payment/transfer/...
  date, note,
  splits: [{ method, currency, cashBoxId, amount, exchangeRate?, direction }],
  sourceTable, sourceId,   // اختياري: لو مرتبطة بعملية أم (تنفيذ/تقديم)
})
```
- تنشئ صف أم في الجدول المناسب (transactions/company_transactions/…) عند الحاجة، أو تكتفي بـ payment_splits فقط للحركات النقدية البحتة (قبض/صرف/تسوية/تحويل).
- **التحويل بين خزينتين**: صفّان في `payment_splits` (out من الأولى، in للثانية) بنفس `transaction_id`.

### واجهة القراءة (استعلامات موحّدة)
```ts
getEntityLedger(partyType, partyId, { from, to, currency? })  // كشف حساب
getEntityBalance(partyType, partyId, currency?)               // رصيد محسوب من الكشف
getCashBoxBalance(cashBoxId)                                  // من cash_boxes.balance
getCashBoxLedger(cashBoxId, { from, to })                     // من payment_splits
getFinancialSummary({ from, to })                             // للداشبورد والتقارير
```
- كل الاستعلامات تعتمد على `payment_splits` كمصدر أساسي، مع join خفيف على الجدول الأم لجلب اسم الجهة/الوصف عند الحاجة.

### واجهة التعديل/الحذف
```ts
voidMovement(id)              // يحذف payment_splits → التريجر يعكس الرصيد
updateMovement(id, patch)     // نفس الشيء
```

## الملفات التي ستتغير

### كتابة (يستدعون `postMovement` فقط بدل الكتابة المباشرة)
- `src/components/CashMovementForms.tsx` — قبض/صرف الوكلاء والشركات والموردين والتجار.
- `src/components/AgentPaymentForm.tsx` — دفعات الوكيل.
- `src/routes/companies.tsx` — مدفوعات الشركة.
- `src/routes/currency-suppliers.tsx` — حركات مورد العملة.
- `src/routes/merchants.tsx` — تحصيلات تاجر الكاش.
- `src/routes/expenses.tsx` — المصروفات (out فقط).
- `src/routes/executions.tsx` + `src/lib/executionPosting.ts` — التنفيذات (splits لكل جهة).
- `src/routes/submissions.tsx` + `src/lib/servicePosting.ts` — التقديمات.
- شاشة/نموذج "تحويل بين الخزائن" (داخل settings أو CashMovementForms).

### قراءة (يستدعون `getEntityLedger` / `getEntityBalance` / `getCashBoxBalance`)
- `src/components/AgentLedger.tsx` — كشف الوكيل.
- `src/routes/agent-statement.$agentId.tsx` — كشف مطبوع للوكيل.
- `src/routes/currency-supplier-statement.$supplierId.tsx` — كشف مطبوع للمورد.
- `src/components/EntityProfileModal.tsx` — كروت الأرصدة داخل بروفايل أي جهة.
- `src/lib/balanceGuard.ts` — منع الصرف بدون رصيد (يستخدم `getCashBoxBalance` و `getEntityBalance`).
- `src/lib/dashboard.functions.ts` — كل كروت الداشبورد.
- `src/lib/reportsData.ts` + `src/routes/reports.tsx` — كل التقارير المالية.
- `src/routes/index.tsx` — الداشبورد الرئيسي.
- `src/lib/statementCapture.ts` / `exportStatement.ts` — كشوف PDF.

## الجداول القديمة
`transactions`, `company_transactions`, `currency_supplier_transactions`, `merchant_cash_collections`, `usd_treasury_transactions`, `investor_transactions` تبقى **للـ metadata فقط** (تاريخ، ملاحظة، ربط بعملية أم). كل الأرقام المالية تُقرأ من `payment_splits`. الكتابة عليها تحصل فقط لتسجيل الـ metadata عبر `postMovement`.

## قواعد صارمة (Guardrails)
1. **ممنوع** أي `.insert('payment_splits')` أو `.insert('*_transactions')` خارج `financialEngine.ts` — نضيف ESLint pattern check + تعليق تحذيري على كل جدول.
2. **ممنوع** أي `sum(amount)` يدوي في شاشة — كل الحسابات عبر دوال Engine.
3. **ممنوع** أي حقل رصيد مخزّن على مستوى الجهة (agents.balance, companies.balance…) — إن وُجد يُتجاهل ويُحسب.
4. `balanceGuard` قبل أي صرف يستدعي **نفس** `getCashBoxBalance` اللي يستخدمها التقرير.

## خطوات التنفيذ (مرحلة واحدة، حسب اختيارك)
1. بناء `src/lib/financialEngine.ts` كامل (كتابة + قراءة + void + resolveParty).
2. تحديث كل شاشات الكتابة (8 ملفات) لاستدعاء `postMovement`.
3. تحديث كل شاشات القراءة (10+ ملفات) لاستدعاء دوال Engine.
4. تحديث `dashboard.functions.ts` و `reportsData.ts` و `balanceGuard.ts`.
5. اختبار يدوي عبر Playwright للـ 10 حالات المذكورة (قبض/صرف/دفع/تحويل/مصروف لكل جهة) والتأكد من تطابق: كشف + رصيد + خزنة + داشبورد + تقارير.

## المخاطر التي أنبّهك لها الآن
- **حجم التغيير كبير جداً** (~20 ملف، وسط الشاشات الأكثر حساسية بالنظام).
- بعض الشاشات القديمة قد تعتمد على أعمدة في `*_transactions` غير موجودة في `payment_splits` (مثل `service_type`, `destination`) — سنحتفظ بها كـ metadata على الجدول الأم ونقرأها من هناك، لكن قد تحتاج تعديلات إضافية بعد الاختبار.
- الـ backfill السابق للجداول القديمة موجود في `payment_splits` (كما ذكرت أنت في محادثات سابقة). لو ظهرت أرصدة قديمة غير متطابقة، سنحتاج migration `RECALC` لإعادة حساب `cash_boxes.balance` من `payment_splits` بعد التغيير.
- بعد التنفيذ، أي شاشة نسيتها ستظهر أرقام قديمة — سنكتشفها في الاختبار وتُصلَح.

## التقرير النهائي (سأقدمه بعد التنفيذ)
1. مخطط دورة الحركة المالية الجديدة (نص + ASCII).
2. قائمة الملفات المعدّلة.
3. مصفوفة تحقق: كل جهة × كل نوع حركة × (كشف/رصيد/خزنة/داشبورد/تقارير) → ✔.
4. لقطات Playwright للاختبارات العشرة.

---

**قبل ما أبدأ**: هذا العمل ضخم وسيستهلك رصيد كبير في هذه الجلسة (تقديري: 15-25 استدعاء ملفات + عدة اختبارات Playwright). لو موافق على الخطة كما هي، أبدأ فوراً بالمرحلة الشاملة. لو تريد تعديلاً على النطاق (مثلاً استبعاد الداشبورد أو المصروفات من هذه الجولة)، أخبرني.