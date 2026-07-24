# توحيد مصادر التقارير مع صفحات الأقسام

## المشكلة
تقارير `src/routes/reports.tsx` تستخدم دوال `summarize*Report` من `src/lib/financialSummary.ts` مستقلة عن الدوال المستخدمة في صفحات الأقسام (`accounts.tsx`, `companies.tsx`, `merchants.tsx`, `expenses.tsx`, `currency-suppliers.tsx`, `executions.tsx`, `submissions.tsx`) — فتنشأ فروقات في الأرقام، خصوصًا بين الكروت الإجمالية للقسم وكروت التقرير عند "كل الوقت".

## نطاق العمل (كبير — ~9600 سطر تقارير+صفحات)

هذا العمل يحتاج تنفيذ على **6 مراحل مستقلة** حتى نتمكن من التحقق (typecheck + مطابقة أرقام) بعد كل مرحلة قبل الانتقال للمرحلة التالية. تنفيذ كل التقارير في جلسة واحدة سيؤدي إلى تراجعات صامتة يصعب اكتشافها.

### قبل البدء — تدقيق مكتوب لكل تقرير
لكل تقرير أنتج جدولاً في المستودع `.lovable/reports-audit.md` يتضمن الأعمدة التي طلبتها (الصفحة المرجعية / مصدر الكروت / مصدر التقرير / الجداول / الدوال / سبب الاختلاف). هذا يحوّل التدقيق إلى مرجع دائم بدلاً من رسالة عابرة.

### المرحلة 1 — البنية التحتية المشتركة (بدون تغيير أرقام)
- استخراج currency resolver موحد + date-field موحد لكل قسم إلى `src/lib/sectionAccounting/` مع تعليقات محاسبية.
- إضافة helper `applyRange<T>(rows, dateField, inRange)` — نفس التوقيع يُستخدم في القسم والتقرير.
- Reconciliation Debug Hook (dev فقط، خلف `import.meta.env.DEV`) يطبع `{departmentTotals, reportAllTimeTotals, diffByCurrency}` في الكونسول لكل قسم.

### المرحلة 2 — الوكلاء
- تعميم `useAgentAccountTotals` (الموجود بالفعل) ليقبل `inRange` اختياري ودالة summarize لكل وكيل.
- استبدال `summarizeAgentReport` بالاعتماد على نفس دوال `dashboardCollections.ts` مع الفلترة.
- تطابق: كروت التقرير @ "كل الوقت" = كروت `accounts.tsx` لكل عملة.

### المرحلة 3 — الشركات الصادرة
- استخراج `summarizeCompany` / `buildCompanyLedgerRows` من `companies.tsx` إلى `src/lib/companyAccounting.ts`.
- إعادة كتابة `summarizeCompanyReport` باستدعاء الدوال المشتركة.

### المرحلة 4 — تجار الكاش + موردي العملة
- توحيد `buildMerchantMovements` (من `merchants.tsx`) واستخدامه في التقرير مع payment_splits لعملة التحصيل.
- توحيد `computeCurrencySupplierStatsByCurrency` (موجود بـ `dashboardCollections`) في صفحة الموردين والتقرير.

### المرحلة 5 — المصروفات + التنفيذات + التقديمات + أنواع الخدمات
- المصروفات: `computeExpensesByCurrency` مصدر واحد، إزالة أي جمع لـ `expense_deductions.amount`.
- التنفيذات/التقديمات: صفوف مباشرة من `executions`/`submissions` بنفس الفلاتر.
- أنواع الخدمات: `computeServiceExecutionDistribution` (موجود) — التحقق أنه مستخدم في كل مكان.

### المرحلة 6 — التصدير (PDF/Excel/طباعة) + اختبارات القبول
- المصدر = نفس `rows`/`summary` الظاهرين على الشاشة، بدون إعادة حساب.
- تشغيل يدوي لسيناريوهات القبول السبعة التي حددتها.

## قرارات تحتاج تأكيدك قبل التنفيذ

1. **حجم التنفيذ في هذه الجلسة**: هل تريد التنفيذ الكامل الآن (6 مراحل، احتمال تراجعات ووقت طويل جدًا)؟ أم مرحلة واحدة كل جلسة مع تقرير مطابقة أرقام بعد كل مرحلة؟ توصيتي: **مرحلة واحدة الآن (الوكلاء — الأعلى أثرًا)** ثم تقييم قبل الاستمرار.

2. **حقل التاريخ الموحد لكل قسم**: هل نعتمد `date` مع fallback إلى `created_at` (السياسة الحالية في `dashboardCollections.rowAccountingDate`) كمرجع لكل التقارير؟ أم لكل قسم قراره الخاص الموثق؟

3. **Reconciliation Debug**: كونسول dev فقط، أم صفحة `/reports/reconcile` مخفية خلف صلاحية admin؟

4. **العملة الافتراضية**: `normalizeCurrency` الحالي يعيد `EGP` عند الفراغ — تريد الإبقاء أم تغييره إلى "غير محدد" لسجلات جديدة (سيغير أرقام تاريخية)؟

**لا أستطيع بدء التعديل بمسؤولية دون هذه الإجابات لأنها تؤثر على كل مرحلة.**
