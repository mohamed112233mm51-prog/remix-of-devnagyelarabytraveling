## المرحلة B — توحيد الكتابة على payment_splits وتنظيف المصطلحات

بعد أن أصبح `cash_boxes.balance` هو المصدر الوحيد للحقيقة (المرحلة A)، أي حركة جديدة لا تُسجَّل في `payment_splits` = لا تظهر في الرصيد. البحث كشف مسارين يكتبان بالطريقة القديمة فقط، بالإضافة إلى تسميات قديمة متبقية.

### 1. مسارات الكتابة المطلوب إصلاحها
- **`src/routes/expenses.tsx`** (نموذج إضافة مصروف): يكتب في `expenses` + `expense_deductions` + `merchant_cash_collections` بدون `payment_splits`. الإصلاح: بعد إدراج المصروف، إدراج صف `payment_splits` لكل سطر دفع بـ `direction='out'`، `source_table='expenses'`، `source_id=expenseRow.id`، `cash_box_id` مناسب لطريقة الدفع/العملة → الـ trigger يخصم الخزنة تلقائياً.
- **`src/routes/currency-supplier-statement.$supplierId.tsx`** (توريد/دفع مورد عملة): مراجعة سريعة والتأكد من كتابة splits بالاتجاه الصحيح (شراء = out من الخزنة، دفع = out عملة محلية).
- **`src/components/CashMovementForms.tsx`**: يستخدم مبالغ سالبة موقّعة يدوياً + `direction` افتراضي `'in'`. صحيح حسابياً لكن غير متسق. توحيد: مبالغ موجبة دائماً + `direction='out'`/`'in'` صريح.

### 2. حماية على مستوى القاعدة
إضافة `CHECK (amount >= 0)` على `payment_splits.amount` بعد تحويل المبالغ السالبة الحالية إلى موجبة + `direction='out'` (migration واحدة).

### 3. تنظيف المصطلحات (بدون حذف بيانات)
- استبدال تسميات الواجهة "الرحلات"→"التنفيذات"، "الموافقات"→"التقديمات" في:
  `src/routes/reports.tsx`, `src/lib/reportsData.ts` (حقل `approvals` مكرر لـ`submissions`)، `src/components/TopbarTools.tsx`، `src/routes/agent-statement.$agentId.tsx`.
- **الإبقاء** على أسماء الأعمدة/الجداول (`approval_company_id`, `investor_transactions`) — تغيير الـ schema مكلف وخارج النطاق. فقط تسميات UI.
- `investors` / `investor_transactions`: الاحتفاظ بها للقراءة فقط في التقارير القديمة. لا واجهة إدخال جديدة (موجود فعلياً).

### 4. التحقق
- بعد كل تعديل: إنشاء مصروف تجريبي والتأكد من انخفاض `cash_boxes.balance` فوراً بنفس المبلغ.
- تشغيل `SELECT name, balance FROM cash_boxes` قبل/بعد للتأكيد.

### التفاصيل التقنية

```text
payment_splits الجديد لأي مصروف:
  direction    = 'out'
  source_table = 'expenses'
  source_id    = expense.id
  cash_box_id  = مطابقة (currency + method → company_cash|company_instapay)
  amount       = موجب
  → trigger apply_payment_split_to_cash_box يخصم تلقائياً
```

**ما لن أفعله**: لن أغير schema الأعمدة القديمة، ولن أحذف `investor_transactions`، ولن ألمس واجهات تعمل بشكل صحيح.

هل أبدأ التنفيذ؟