
# خطة التنفيذ

## 1) حقل "البيان" في كل النماذج المالية
- إضافة عمود `statement` (nullable text) في جدول `transactions` عبر migration، وإضافته لجدول `payment_splits` إذا لزم للحركات التي لا تمر عبر transactions (سنعتمد فقط على `transactions` + `merchant_cash_collections` + `expenses` + `investor_transactions` + `currency_supplier_transactions` + `agent_payments/company_transactions` — سنراجع كل جدول ونضيف `statement` حيث تُخزن الحركة).
- تعديل `postMovement` في `src/lib/financialEngine.ts` لقبول `statement` وتمريره لصف الحركة (بدون توليد تلقائي).
- إضافة input "البيان" في كل النماذج:
  - `CashMovementForms.tsx` (AgentCashOut / MerchantCashOut / CompanySupply)
  - `AgentPaymentForm.tsx`
  - نماذج قبض/دفع الشركة، مورد العملة، تحصيل نقدية، مصروف، تحويل بين خزائن، وأي نموذج مالي آخر.
- عرض عمود "البيان" في كشوف الحساب (منفصل عن "الملاحظات").

## 2) إزالة أي ملاحظات/بيانات تلقائية
- في جميع استدعاءات `postMovement` وإدراجات الحركات: إزالة قيم مثل `note.trim() || "صرف نقدية للتاجر"`، وجعلها `note.trim() || null` (بدون fallback نصي).
- إزالة أي `default note` مولّد من نوع الحركة أو اسم الجهة.

## 3) ملاحظات التنفيذ في الكشوف المرتبطة
- في `src/routes/executions.tsx`: التأكد من تخزين `notes` كما هي.
- في `postMovement` عند إنشاء حركات مرتبطة بالتنفيذ (وكيل + شركة): نسخ `execution.notes` إلى `transactions.note` (وليس بيان). بدون توليد نص.
- كشف الوكيل / الشركة يعرض حقل الملاحظات الحالي — نتأكد أنه يقرأ `notes` الأصلي من التنفيذ.

## 4) إخفاء/إظهار الأعمدة في كل كشوف الحساب القابلة للتصدير
استخدام المكوّن الحالي `ColumnVisibility` + `usePersistentColumnVisibility` (نفس النمط المستخدم في executions/submissions) في:
- `src/routes/agent-statement.$agentId.tsx`
- `src/routes/currency-supplier-statement.$supplierId.tsx`
- كشف الشركة (`companies.tsx` statement tab)
- كشف تاجر الكاش (`merchants.tsx` statement tab)
- كشف الخزائن (`accounts.tsx`)
- `expenses.tsx`
- أي جدول قابل للتصدير في `reports.tsx`

لكل جدول:
- تعريف `ColumnDef[]`
- استخدام `usePersistentColumnVisibility(tableKey, columns)`
- تمرير `visible` للـ `<thead>/<tbody>` (شرط render لكل خلية)
- تمريره لدالة التصدير (Excel/PDF/Print) لتصفية الأعمدة قبل التصدير

## تفاصيل تقنية
- Migration واحد يضيف `statement text` لجداول الحركات المالية ذات الصلة، مع GRANT بدون تغيير.
- لا تغييرات تصميمية على الجداول أو النماذج بخلاف إضافة صف/عمود "البيان".
- كل التعديلات backward-compatible: `statement` و`note` يمكن أن يكونا NULL.

## نطاق كبير — تأكيد
هذا العمل يمس ~15 ملف نموذج + ~8 صفحات كشوف + migration واحد. سأنفذها بالترتيب: (أ) migration و engine، (ب) النماذج، (ج) الكشوف + column visibility.

هل أبدأ التنفيذ الكامل، أم تفضل تقسيمه على مراحل (مثلاً: البند 4 أولاً لأنه الأسهل والأكثر وضوحاً، ثم 1+2، ثم 3)؟
