
## نطاق التغيير

تغيير كبير ومدمّر. التأكيد قبل البدء مهم.

---

## 1) قاعدة البيانات (Migration)

**حذف نهائي (لا تراجع):**
- جدول `flights`
- جدول `approvals`
- جدول `agent_service_pricing` (مرتبط بالتذاكر فقط — تأكيد قبل الحذف)
- إزالة الـ trigger `prevent_issuing_company_delete_if_used` من المراجع لـ approvals
- إزالة `flights/approvals/libyan-investment` من publication الـ Realtime

**تعديل publication الـ Realtime ليقتصر على:**
`agents, issuing_companies, submissions, executions, transactions`
(باقي الجداول تُزال من `supabase_realtime`)

**تحديث `system_dropdown_options`:**
- استبدال قيمة `airline = 'العراق'` بـ `'البراق'`
- إضافة `departure_from = 'جمرك بري'`
- تأكد من القيم: airline ∈ {البراق، البرنيق، الليبية، إير كايرو، تاج، مصر للطيران، الأفريقية}
- departure_from ∈ {مطار القاهرة، برج العرب، جمرك بري}

**عمود تاريخ الميلاد:** يبقى `date` في DB (submissions.dob, executions.dob). التحويل من/إلى DD/MM/YYYY في الواجهة فقط.

---

## 2) الكود — حذف

- حذف `src/routes/flights.tsx`
- حذف `src/routes/approvals.tsx`
- حذف `src/routes/libyan-investment.tsx`
- حذف `src/components/ServiceSubmissionModal.tsx` (لم يعد له معنى)
- حذف `src/routes/submit.tsx` (يعتمد على النماذج المحذوفة)
- إزالة من الـ Sidebar: روابط الطيران/الموافقات/الاستثمار
- إزالة من `ROUTE_PERM` و`SECTION_KEYS` المفاتيح: `flights, approvals`
- إزالة استيرادات `FlightForm/ApprovalForm/InvestmentForm` في أي مكان

---

## 3) الكود — تعديل

**`src/routes/submissions.tsx`** (نموذج إضافة/تعديل):
- حقل DOB: `<input type="text" placeholder="DD/MM/YYYY" />` مع تحقق `dd/mm/yyyy`
- حقل departure_from: select من `system_dropdown_options` (يتضمن جمرك بري تلقائيًا)
- حقل الخدمات: متعدد الاختيار (وسوم) من dropdown `service_type`
- لا منطق مالي

**`src/routes/executions.tsx`** (نموذج إضافة/تعديل):
- نفس معالجة DOB (DD/MM/YYYY)
- airline من dropdown (يحتوي البراق)
- المنطق المالي الحالي (`postExecutionFinancials`) يبقى — هو المصدر الوحيد للحركات

**Helper جديد `src/lib/dateFormat.ts`:**
- `toDisplayDate(iso) → "DD/MM/YYYY"`
- `parseDisplayDate("DD/MM/YYYY") → ISO | null`
- `isValidDisplayDate(s) → boolean`

**كل عرض DOB في الجداول والكشوف:** يستخدم `toDisplayDate`.

**`src/lib/db.ts`:** تقليل الجداول المشتركة في channels Realtime إلى الخمسة المحددة.

**`src/routes/settings.tsx`:** التأكد من إدارة dropdowns لكل الفئات (موجود — تحقق فقط).

**`src/components/Layout.tsx` (Sidebar):** إزالة عناصر القائمة المحذوفة.

---

## 4) التقاطعات والمخاطر

- `executions.tsx` و`agent-statement` و`accounts` تقرأ من `transactions/company_transactions` فقط — لا تتأثر.
- `reportsData.ts` قد يستورد من flights/approvals — يحتاج فحص وإزالة المراجع.
- `dataImport/specs.ts` يحتوي على specs لـ flights/approvals — تُزال.
- `executionPosting.ts` لا يتأثر.
- بيانات قديمة في `flights/approvals` ستُفقد نهائيًا (طلب المستخدم صريح).

---

## 5) العلاقات النهائية

```
agents ──┐
         ├──> submissions ──(تحويل)──> executions ──> transactions (مديونية وكيل)
companies┘                                       └──> company_transactions (تكلفة شركة)
```
- التقديم لا ينشئ أي حركة مالية.
- كل حركة مالية تخرج من التنفيذ (مربوطة بـ `source_service_id = executionId::index`).

---

## 6) Migrations المطلوبة (واحد فقط)

1. `DROP TABLE public.flights, public.approvals, public.agent_service_pricing CASCADE`
2. `ALTER PUBLICATION supabase_realtime DROP TABLE …` لكل الجداول غير المطلوبة، والتأكد من بقاء الخمسة.
3. `UPDATE system_dropdown_options SET value='البراق' WHERE category='airline' AND value='العراق'`
4. `INSERT system_dropdown_options (category, value) VALUES ('departure_from','جمرك بري') ON CONFLICT DO NOTHING`

---

## 7) الملفات المتأثرة (متوقعة)

محذوفة: `flights.tsx, approvals.tsx, libyan-investment.tsx, submit.tsx, ServiceSubmissionModal.tsx`
معدّلة: `submissions.tsx, executions.tsx, Layout.tsx, usePerm.tsx, db.ts, reportsData.ts, dataImport/specs.ts, agent-statement.$agentId.tsx (عرض DOB), AgentLedger.tsx (عرض DOB)`
جديدة: `src/lib/dateFormat.ts`
Migration: `supabase/migrations/<timestamp>_unify_system.sql`

---

## تأكيدات مطلوبة قبل التنفيذ

1. **حذف جدول `agent_service_pricing` نهائيًا؟** (يحوي تسعير الخدمات لكل وكيل — قد يكون مفيدًا للتنفيذ).
2. **حذف بيانات `flights` و`approvals` التاريخية نهائيًا**، أم نقلها أرشيفًا في جدول `archive_*` قبل الحذف؟
3. هل توافق على إزالة صفحة `/submit` (الموحّدة لتقديم خدمة) واستبدالها بصفحة `/submissions` فقط؟

أنتظر الإجابات قبل تنفيذ Migration والحذف.
