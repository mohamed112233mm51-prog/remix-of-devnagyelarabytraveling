## الهدف
منع أي عملية حسابية بين عملتين مختلفتين في كامل النظام. كل رصيد/إجمالي يجب أن يكون **CurrencyMap** (خريطة عملة→قيمة)، لا رقماً واحداً.

## نتائج المسح — الأماكن التي تخلط العملات فعلياً

| # | المكان | السطر | السبب |
|---|--------|------|-------|
| 1 | `src/components/AgentLedger.tsx` | 166–169 | `totalServices/totalPayments/net = byCurrency.reduce(s+b.debit/credit,0)` ثم `accountStatus` مبني على `net` المدموج. يُصدَّر في summary التصدير. |
| 2 | `src/routes/companies.tsx` (CompanyStatementTab) | 344–347 | نفس النمط (شركات). |
| 3 | `src/routes/accounts.tsx` (كروت الوكلاء + صفوف + tfoot + بروفايل) | 54–66, 179–192, 227–230 | `s.totalDebit.total()` / `.totalCredit.total()` تجمع EGP+USD+LYD في `fmtDL`. |
| 4 | `src/routes/companies.tsx` (كروت الشركات + صفوف + tfoot + بروفايل) | 95–107, 140–154, 214–235, 270–273 | نفس النمط. |
| 5 | `src/routes/merchants.tsx` (كروت التجار + صفوف قائمة التجار) | 70–77, 200–203 | `useMerchantTotals()` و `merchantTotals.get(id).balance/incoming/outgoing/collected/paidOut` كلها Scalars مدموجة. |
| 6 | `src/lib/financialSummary.ts` — `summarizeMerchantMovementTotals` | 1690–1710 | `balance += m.delta` و `totalIncoming += m.net` بغض النظر عن العملة. |
| 7 | `src/lib/financialSummary.ts` — `MerchantAggregate` + `computeMerchantAggregates` + `useMerchantTotals` | 340–559 | يعتمد على النقطة 6 → كل الحقول Scalars مدموجة. |
| 8 | `src/lib/financialSummary.ts` — `summarizeMerchantMovements` (تقارير) | 1349–1367 | يجمع `merchantCashNet` و`merchant_cash_amount` عبر جميع العملات في رقم واحد. يظهر في `MerchantsReport` بـ `fmtDL`. |
| 9 | `CurrencyMap.total()` نفسه | 111–116 | Footgun — يعيد رقماً واحداً عبر كل العملات. سيُعلَّم كـ `@deprecated` ولن يبقى مستخدَماً إلا في سياقات عملة واحدة مثبتة. |

## المعمارية الجديدة

كل ملخص يُرجع خرائط عملة بدل رقم واحد:

```
EntitySummary
  totalDebit  : CurrencyMap
  totalCredit : CurrencyMap
  balance     : CurrencyMap
MerchantAggregate → { incoming, outgoing, collected, paidOut, converted, balance } : كل حقل CurrencyMap
```

مساعد عرض جديد `formatCurrencyLines(map)` يُرجع سطراً لكل عملة (EGP → USD → LYD → أبجدي، بدون العملات الصفرية).

## التغييرات على `financialSummary.ts`

1. **`MerchantAggregate`** → كل حقل يصبح `CurrencyMap` بدل `number`.
2. **`summarizeMerchantMovementTotals`** → تُرجع `balance/totalIncoming/…` كـ `CurrencyMap` (يُضاف `m.delta` إلى `balanceByCurrency` تحت `m.currency`).
3. **`computeMerchantAggregates`** / **`useMerchantAggregates`** → توزّع النتائج CurrencyMap.
4. **`useMerchantTotals`** → يعيد CurrencyMaps مجمَّعة عبر كل التجار (كل عملة على حدة).
5. **`summarizeMerchantMovements`** (تقرير الفترة) → يضيف حقول `*ByCurrency: CurrencyMap`؛ الحقول الحالية (`incoming/outgoing/collected/fee/balance` كأرقام) تُحذف أو تظل EGP-only فقط عندما جميع الحركات EGP.
6. **`summarizeMerchantReport`** → صفوفه تحمل `MerchantReportRowByCurrency`.
7. **`CurrencyMap.total()`** → JSDoc `@deprecated — do not use for balances/aggregates that may contain multiple currencies`.
8. مساعد جديد **`formatCurrencyLines(map)`** (موجود بالفعل، سيُوسَّع).

## التغييرات على الصفحات (KPI cells تعرض سطراً لكل عملة)

- **`accounts.tsx`**: `stats.get(id) = { debit: CurrencyMap, credit: CurrencyMap, balance: CurrencyMap }`. الكروت والصفوف وtfoot والبروفايل تعرض `formatCurrencyLines(map)` (سطر لكل عملة، نفس مكان `fmtDL` القديم).
- **`companies.tsx`** (list + statement): نفس النمط.
- **`merchants.tsx`**: كروت KPI + صفوف قائمة التجار تعرض CurrencyMap.
- **`AgentLedger.tsx`** + **`CompanyStatementTab`**: يُحذف `totalServices/totalPayments/net` المدموج؛ `accountStatus` يصبح **سطراً لكل عملة** في summary التصدير (`مستحق على الوكيل (EGP): X` / `مستحق للوكيل (LYD): Y`).
- **`reports.tsx`** — `MerchantsReport`: أعمدة الوارد/الصادر/المحصل/الرصيد تعرض CurrencyMap. KPI الأعلى كذلك.

## الملفات المعدَّلة

- `src/lib/financialSummary.ts` (النقاط 1–8)
- `src/components/AgentLedger.tsx` (accountStatus per currency)
- `src/routes/accounts.tsx` (KPI + صفوف + tfoot + بروفايل)
- `src/routes/companies.tsx` (KPI + صفوف + tfoot + بروفايل + CompanyStatementTab.accountStatus)
- `src/routes/merchants.tsx` (KPI + صفوف قائمة التجار)
- `src/routes/reports.tsx` (MerchantsReport فقط — التقارير الأخرى EGP-only بطبيعتها)

## Invariant النهائي المضمون

بعد الانتهاء: **لا يوجد أي `.reduce(s+b.currency-bearing)` عبر عملات مختلفة، ولا `.total()` على CurrencyMap متعددة العملات.** كل قيمة تظهر في UI أو تُصدَّر مصحوبة بعملتها. لا تحويلات صرف ضمنية إطلاقاً.

## التقرير بعد التنفيذ
سأعطي:
1. قائمة الأماكن التي كانت تخلط العملات (كما في جدول المسح أعلاه).
2. سبب حدوث كل حالة.
3. الإصلاح المُطبَّق.
4. تأكيد أن النظام Currency-Safe.

هل أبدأ التنفيذ؟