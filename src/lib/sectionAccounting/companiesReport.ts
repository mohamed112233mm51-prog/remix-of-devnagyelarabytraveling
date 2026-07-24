/**
 * Companies (issuing companies) — shared pure functions used by BOTH:
 *   - src/routes/companies.tsx     (section KPI cards + per-company list)
 *   - src/routes/reports.tsx       (CompaniesReport — period-scoped view)
 *
 * المصدر الوحيد للحساب هو نفس ما تستخدمه صفحة الشركات:
 *   `summarizeCompany` → `buildCompanyLedgerRows` (يستبعد الملغى داخلياً)
 *   + `resolveSplitCurrencyByRef(payment_splits, "company_transactions")`.
 *
 * التقرير يضيف فقط طبقة فلترة زمنية (predicate) فوق نفس الدوال، بحيث
 * كروت التقرير عند "كل الوقت" == كروت صفحة حسابات الشركات بكل عملة.
 */
import type { CompanyTransaction, IssuingCompany } from "@/lib/db";
import {
  CurrencyMap,
  summarizeCompany,
  resolveSplitCurrencyByRef,
} from "@/lib/financialSummary";

// نفس شكل الصف الذي يقبله resolveSplitCurrencyByRef (payment_splits lite).
type SplitCurrencyRowLite = {
  source_table: string | null;
  source_id: string | null;
  currency: string | null;
  cancelled_at?: string | null;
};

export type DatePredicate = (d: string | null | undefined) => boolean;

export type CompanyReportRow = {
  id: string;
  name: string;
  services: CurrencyMap; // totalDebit  (قيمة الخدمات)
  paid: CurrencyMap;     // totalCredit (المدفوعات)
  due: CurrencyMap;      // balance     (المستحق = debit - credit)
  txnCount: number;      // عدد حركات company_transactions ضمن الفترة
  approvalCount: number; // عدد التقديمات (approvals) ضمن الفترة
};

export type CompanyReportSummaryV2 = {
  rows: CompanyReportRow[];
  totals: {
    services: CurrencyMap;
    paid: CurrencyMap;
    due: CurrencyMap;
    txnCount: number;
    approvalCount: number;
  };
  filteredTxns: CompanyTransaction[];
  filteredApprovals: any[];
};

function approvalDateOf(a: any): string | null {
  return (a?.submit_date && String(a.submit_date)) ||
    (a?.issue_date && String(a.issue_date)) ||
    (a?.created_at ? String(a.created_at).slice(0, 10) : null);
}

export function computeCompanyReport(input: {
  companies: Pick<IssuingCompany, "id" | "company_name">[];
  companyTransactions: ReadonlyArray<CompanyTransaction>;
  paymentSplits?: ReadonlyArray<SplitCurrencyRow> | null;
  approvals?: ReadonlyArray<any>;
  predicate?: DatePredicate;
}): CompanyReportSummaryV2 {
  const { companies, companyTransactions, paymentSplits, approvals = [], predicate } = input;

  // Currency resolver من payment_splits — نفس المصدر الذي تستخدمه صفحة الشركات.
  const curMap = resolveSplitCurrencyByRef(
    (paymentSplits ?? []) as any,
    "company_transactions",
  );

  // فلترة الحركات بالفترة (حقل date — نفس ما يفعله كشف الحساب في العرض).
  const filteredTxns: CompanyTransaction[] = [];
  const byCompany = new Map<string, CompanyTransaction[]>();
  for (const c of companies) byCompany.set(c.id, []);
  for (const t of companyTransactions) {
    if ((t as any).cancelled_at) continue; // summarizeCompany يفعل ذلك، لكن نفلتر مبكرًا للعد.
    if (predicate && !predicate((t as any).date)) continue;
    filteredTxns.push(t);
    const cid = (t as any).company_id as string | null;
    if (cid) {
      const arr = byCompany.get(cid);
      if (arr) arr.push(t);
    }
  }

  // عد التقديمات ضمن الفترة لكل شركة.
  const approvalCountByCo = new Map<string, number>();
  const filteredApprovals: any[] = [];
  for (const a of approvals) {
    if (predicate && !predicate(approvalDateOf(a))) continue;
    filteredApprovals.push(a);
    const cid = (a as any).approval_company_id;
    if (cid) approvalCountByCo.set(String(cid), (approvalCountByCo.get(String(cid)) || 0) + 1);
  }

  const totalsServices = new CurrencyMap();
  const totalsPaid = new CurrencyMap();
  const totalsDue = new CurrencyMap();

  const rows: CompanyReportRow[] = companies.map((c) => {
    const list = byCompany.get(c.id) || [];
    const sum = summarizeCompany(list, curMap);
    totalsServices.merge(sum.totalDebit);
    totalsPaid.merge(sum.totalCredit);
    totalsDue.merge(sum.balance);
    return {
      id: c.id,
      name: (c as any).company_name,
      services: sum.totalDebit,
      paid: sum.totalCredit,
      due: sum.balance,
      txnCount: list.length,
      approvalCount: approvalCountByCo.get(c.id) || 0,
    };
  });

  return {
    rows,
    totals: {
      services: totalsServices,
      paid: totalsPaid,
      due: totalsDue,
      txnCount: filteredTxns.length,
      approvalCount: filteredApprovals.length,
    },
    filteredTxns,
    filteredApprovals,
  };
}
