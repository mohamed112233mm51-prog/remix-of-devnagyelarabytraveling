import { createFileRoute } from "@tanstack/react-router";
import { CurrencyLines } from "@/components/CurrencyLines";
import { CancelTransactionButton } from "@/components/CancelTransactionButton";
import { EditTransactionButton } from "@/components/EditTransactionButton";
import { CurrencyTotalsCards } from "@/components/CurrencyTotalsCards";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDL, fmtNum, fmtUSD, fmtCurrency, useLive, useDropdownOptions, withSelected, useTreasuryBalances,
  type IssuingCompany, type CompanyTransaction, type Merchant, type Agent, type UsdTreasuryTransaction, type Execution,
} from "@/lib/db";
import { buildAbsentLookup, ABSENT_ROW_STYLE } from "@/lib/absentApproval";
import { ExportButton } from "@/components/ExportButton";
import { buildArabicFileName } from "@/lib/exportStatement";
import CurrencyFilter from "@/components/CurrencyFilter";
import { useRegisterStatementCapture } from "@/lib/statementCapture";
import { usePerm, checkPerm } from "@/hooks/usePerm";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { syncEntityOpeningEntries, readEntityOpeningEntries, type OpeningEntry } from "@/lib/openingBalance";
import { OpeningEntriesEditor } from "@/components/OpeningEntriesEditor";
import { usePersistentState } from "@/hooks/usePersistentState";
import { CompanyPricingTab } from "@/components/CompanyPricingTab";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { logCreate } from "@/lib/financialAudit";
import { postMerchantCashOutToCompanyCounterparts } from "@/lib/merchantCounterparty";
import { useCompaniesSummary, summarizeLedgerByCurrency, attachLedgerRunningBalance, resolveSplitCurrencyByRef, buildCompanyLedgerRows, computeUsdConversionSourceBalance, formatCurrencyMap, CurrencyMap, type LedgerRow } from "@/lib/financialSummary";

import {
  PaymentSplits,
  newPaymentSplitRow,
  methodsForSplit as methodsForSplitWidget,
  validatePaymentSplits,
  filterValidSplits,
  type PaymentSplitRow,
} from "@/components/PaymentSplits";
import { resolveCompanyCashBoxForSplit, useSourceBalances, validateSplitOutflows } from "@/lib/balanceGuard";

import { Building2, Briefcase, Wallet, AlertCircle, Search, Plus, CreditCard, FileText, ChevronLeft, Banknote, BadgeDollarSign } from "lucide-react";
import { CompanySupplyForm } from "@/components/CashMovementForms";
import { EntityProfileModal } from "@/components/EntityProfileModal";
import * as CF from "@/components/ColumnFilter";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { ColumnVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";

const COMPANY_STATEMENT_COLUMNS: ColumnDef[] = [
  { key: "n", label: "#" },
  { key: "date", label: "التاريخ" },
  { key: "description", label: "البيان" },
  { key: "service", label: "نوع الخدمة" },
  { key: "destination", label: "وجهة السفر" },
  { key: "count", label: "العدد" },
  { key: "price", label: "السعر" },
  { key: "serviceValue", label: "قيمة الرحلة" },
  { key: "debit", label: "مدين" },
  { key: "credit", label: "دائن" },
  { key: "balance", label: "الرصيد الحالي" },
  { key: "method", label: "وسيلة الدفع" },
  { key: "note", label: "ملاحظات" },
  { key: "actions", label: "إجراءات" },
];
import { activeOptions } from "@/lib/activeFilter";
import { NumberInput } from "@/components/inputs/NumberInput";
import { DateInput } from "@/components/inputs/DateInput";

export const Route = createFileRoute("/companies")({
  component: () => <AppErrorBoundary><CompaniesPage /></AppErrorBoundary>,
});



function CompaniesPage() {
  const perm = usePerm("companies");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: txns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const flights: any[] = [];
  const approvals: any[] = [];
  const { rows: agents } = useLive<Agent>("agents");

  // Trigger approval-expiry fine scan when this page is opened.
  useEffect(() => {
    import("@/lib/approvalFines").then((m) => m.processExpiredApprovalPenalties({ silent: true })).catch(() => {});
  }, []);
  const [tab, setTab] = useState<"list" | "add" | "txn" | "supply" | "statement">("list");
  const [statementCompanyId, setStatementCompanyId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [editCompany, setEditCompany] = useState<IssuingCompany | null>(null);
  const [viewCompany, setViewCompany] = useState<IssuingCompany | null>(null);

  // ⚠️ Currency-Safe: كل حقل CurrencyMap مستقل بالعملة (لا خلط EGP/USD/LYD).
  const companiesSummary = useCompaniesSummary();
  const { stats, totalTrips, totalPaid, totalDue } = useMemo(() => {
    const map = new Map<string, { trips: CurrencyMap; paid: CurrencyMap; due: CurrencyMap }>();
    const tTrips = new CurrencyMap();
    const tPaid = new CurrencyMap();
    const tDue = new CurrencyMap();
    for (const [id, sum] of companiesSummary) {
      map.set(id, { trips: sum.totalDebit, paid: sum.totalCredit, due: sum.balance });
      tTrips.merge(sum.totalDebit);
      tPaid.merge(sum.totalCredit);
      tDue.merge(sum.balance);
    }
    return { stats: map, totalTrips: tTrips, totalPaid: tPaid, totalDue: tDue };
  }, [companiesSummary]);


  const debouncedSearch = useDebouncedValue(search, 250);
  const filtered = useMemo(() => companies.filter((c) =>
    !debouncedSearch || c.company_name.toLowerCase().includes(debouncedSearch.toLowerCase())
  ), [companies, debouncedSearch]);

  const { pageRows, Controls, page, pageSize } = usePagination(filtered, 50);

  return (
    <div className="section active fin-page accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الحسابات المالية</span>
            <ChevronLeft size={12} strokeWidth={2} />
            <span className="crumb-current">حسابات الشركات الصادرة</span>
          </div>
          <h1 className="page-h1"><Building2 size={20} strokeWidth={2.2} /> حسابات الشركات الصادرة</h1>
          <div className="page-sub">إدارة ومتابعة حسابات الشركات الصادرة</div>
        </div>
        {perm.create && (
          <button className="btn btn-gold page-head-cta" onClick={() => setTab("add")} type="button">
            <Plus size={16} strokeWidth={2.2} /> إضافة شركة
          </button>
        )}
      </div>

      <div className="account-summary kpi-rich">
        <div className="sum-box gold">
          <div className="kpi-icon"><Briefcase size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">إجمالي الخدمات</div>
            <div className="val"><CurrencyLines map={totalTrips} /></div>
          </div>
        </div>
        <div className="sum-box green">
          <div className="kpi-icon"><Wallet size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">إجمالي المدفوع</div>
            <div className="val"><CurrencyLines map={totalPaid} /></div>
          </div>
        </div>
        <div className="sum-box red">
          <div className="kpi-icon"><AlertCircle size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">المتبقي للشركات</div>
            <div className="val"><CurrencyLines map={totalDue} /></div>

          </div>
        </div>
      </div>





      <div className="action-toolbar">
        <div className={`tool-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          <Building2 size={15} strokeWidth={2} /> <span>قائمة الشركات</span>
        </div>
        {perm.create && (
          <div className={`tool-tab ${tab === "txn" ? "active" : ""}`} onClick={() => setTab("txn")}>
            <CreditCard size={15} strokeWidth={2} /> <span>تسجيل دفعة</span>
          </div>
        )}
        {perm.create && (
          <div className={`tool-tab ${tab === "supply" ? "active" : ""}`} onClick={() => setTab("supply")}>
            <Banknote size={15} strokeWidth={2} /> <span>توريد نقدية</span>
          </div>
        )}
        <div className={`tool-tab ${tab === "statement" ? "active" : ""}`} onClick={() => setTab("statement")}>
          <FileText size={15} strokeWidth={2} /> <span>كشف حساب</span>
        </div>
      </div>

      {tab === "list" && (
        <>
          <div className="filter-bar">
            <div className="search-wrap">
              <Search size={15} strokeWidth={2} className="search-wrap-icon" />
              <input
                className="search-input search-input--with-icon"
                placeholder="ابحث باسم الشركة الصادرة..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <div className="card-title">الشركات الصادرة <span className="muted-count">({filtered.length})</span></div>
            </div>
            <div className="card-body">
              <div className="table-wrap enterprise-table">
                <table className="mobile-cards">
                  <thead>
                    <tr>
                      <th>#</th><th>الشركة الصادرة</th><th>الهاتف</th><th>الواتساب</th>
                      <th className="num-col">إجمالي الخدمات</th><th className="num-col">المدفوع</th><th className="num-col">المتبقي</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8}><div className="empty"><div className="empty-icon">🏢</div><div className="empty-text">أضف شركة من تبويب "إضافة شركة جديدة"</div></div></td></tr>
                    ) : pageRows.map((c, i) => {
                      const idx = page * pageSize + i;
                      const s = stats.get(c.id) || { trips: new CurrencyMap(), paid: new CurrencyMap(), due: new CurrencyMap() };
                      return (
                        <tr key={c.id} onClick={() => setViewCompany(c)} style={{ cursor: "pointer" }}>
                          <td data-label="#">{idx + 1}</td>
                          <td className="bold" data-label="الشركة الصادرة">{c.company_name}</td>
                          <td data-label="الهاتف">{c.phone || "—"}</td>
                          <td data-label="الواتساب">{c.whatsapp || "—"}</td>
                          <td className="num-col" data-label="إجمالي الخدمات"><CurrencyLines map={s.trips} /></td>
                          <td className="num-col" data-label="المدفوع" style={{ color: "var(--green)", fontWeight: 700 }}><CurrencyLines map={s.paid} /></td>
                          <td className="num-col" data-label="المتبقي" style={{ fontWeight: 700 }}><CurrencyLines map={s.due} /></td>
                          <td data-label="الحالة"><span className={`badge pill-badge ${((c as any).status || "نشط") === "نشط" ? "badge-green" : "badge-red"}`}>{(c as any).status || "نشط"}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="totals-foot">
                    <tr>
                      <td colSpan={4}>الإجمالي</td>
                      <td className="num-col"><CurrencyLines map={totalTrips} /></td>
                      <td className="num-col"><CurrencyLines map={totalPaid} /></td>
                      <td className="num-col"><CurrencyLines map={totalDue} /></td>
                      <td></td>
                    </tr>


                  </tfoot>
                </table>
              </div>
              <Controls />
            </div>
          </div>
        </>
      )}

      {tab === "add" && perm.create && <CompanyForm onDone={() => setTab("list")} />}
      {tab === "txn" && perm.create && <CompanyTxnForm companies={companies} merchants={merchants} txns={txns} flights={flights} approvals={approvals} agents={agents} onDone={() => setTab("list")} />}
      {tab === "supply" && perm.create && <CompanySupplyForm onDone={() => setTab("statement")} />}
      {tab === "statement" && <AppErrorBoundary name="CompanyStatementTab"><CompanyStatementTab companies={companies} txns={txns} initialCompanyId={statementCompanyId} canExport={perm.export} /></AppErrorBoundary>}

      {editCompany && perm.edit && (
        <EditCompanyModal company={editCompany} onClose={() => setEditCompany(null)} />
      )}

      {viewCompany && (() => {
        const c = viewCompany as any;
        const s = stats.get(viewCompany.id) || { trips: new CurrencyMap(), paid: new CurrencyMap(), due: new CurrencyMap() };
        const dueSigns = new Set(s.due.entries().map((e) => Math.sign(e.amount)));
        const dueTone: "red" | "default" = dueSigns.size !== 1 ? "default" : dueSigns.has(1) ? "red" : "default";
        return (
          <EntityProfileModal
            open={!!viewCompany}
            onClose={() => setViewCompany(null)}
            titlePrefix="ملف الشركة"
            name={viewCompany.company_name}
            canEdit={perm.edit}
            editLabel="تعديل بيانات الشركة"
            onEdit={() => { setEditCompany(viewCompany); setViewCompany(null); }}
            kpis={[
              { label: "إجمالي الخدمات", value: <CurrencyLines map={s.trips} />, tone: "gold" },
              { label: "إجمالي المدفوعات", value: <CurrencyLines map={s.paid} />, tone: "green" },
              { label: "المتبقي", value: <CurrencyLines map={s.due} />, tone: dueTone },
            ]}

            fields={[
              { label: "اسم الشركة", value: viewCompany.company_name },
              { label: "الهاتف", value: viewCompany.phone },
              { label: "الواتساب", value: (viewCompany as any).whatsapp },
            ]}
          />
        );
      })()}
    </div>
  );
}

type CompanyLedgerEntry = LedgerRow<CompanyTransaction>;


function CompanyStatementTab({ companies, txns, initialCompanyId, canExport }: { companies: IssuingCompany[]; txns: CompanyTransaction[]; initialCompanyId: string; canExport: boolean }) {
  const safeCompanies = Array.isArray(companies) ? companies : [];
  const safeTxns = Array.isArray(txns) ? txns : [];
  const [companyId, setCompanyId] = useState(initialCompanyId || "");
  const { rows: liveMerchants } = useLive<Merchant>("merchants");
  const { rows: liveSplits } = useLive<{ source_table: string | null; source_id: string | null; transaction_id: string | null; currency: string | null }>("payment_splits");
  const merchants = Array.isArray(liveMerchants) ? liveMerchants : [];
  const merchantName = (mid: string | null | undefined) => mid ? (merchants.find((m) => m.id === mid)?.merchant_name || "") : "";

  const company = safeCompanies.find((c) => c.id === companyId);
  const myTxnsAll = useMemo(
    // ملاحظة معمارية: لا نفلتر cancelled_at ولا نُعيد الترتيب هنا —
    // buildCompanyLedgerRows يفعل ذلك داخلياً كمصدر واحد للحقيقة
    // (ترتيب حتمي: date ASC → created_at ASC → id ASC، بحيث يعتمد
    // العرض والرصيد الجاري على تاريخ الحركة الذي أدخله المستخدم).
    () => safeTxns.filter((t) => !companyId || t.company_id === companyId),
    [safeTxns, companyId],
  );

  const splitCurrencyByTxnId = useMemo(
    () => resolveSplitCurrencyByRef(liveSplits, "company_transactions"),
    [liveSplits],
  );

  const allEntries = useMemo<CompanyLedgerEntry[]>(
    () => buildCompanyLedgerRows(myTxnsAll, splitCurrencyByTxnId),
    [myTxnsAll, splitCurrencyByTxnId],
  );

  const currencyOptions = useMemo(
    () => Array.from(new Set(allEntries.map((e) => e.currency || "EGP"))).sort(),
    [allEntries],
  );
  const [currencyFilter, setCurrencyFilter] = useState<string>("");
  const filteredEntries = useMemo(
    () => (currencyFilter ? allEntries.filter((e) => (e.currency || "EGP") === currencyFilter) : allEntries),
    [allEntries, currencyFilter],
  );

  // Per-currency running balance — via Financial Summary Engine.
  const allWithBalance = useMemo(
    () => attachLedgerRunningBalance(filteredEntries),
    [filteredEntries],
  );

  const byCurrency = useMemo(() => summarizeLedgerByCurrency(filteredEntries), [filteredEntries]);
  // ⚠️ Currency-Safe: كل عملة تُحسب حالتها مستقلة (لا خلط EGP/USD/LYD).
  const statusPerCurrency = byCurrency.map((b) => ({
    currency: b.currency,
    net: b.net,
    status: b.net > 0 ? "مستحق للشركة" : b.net < 0 ? "مستحق على الشركة" : "متوازن",
  }));
  const accountStatus = statusPerCurrency.length === 0
    ? "متوازن"
    : statusPerCurrency.map((s) => `${s.status} (${s.currency})`).join(" · ");


  const rowsWithMethodLabel = useMemo(() => allWithBalance.map((e) => ({
    ...e,
    methodLabel: e.paymentMethod,
  })), [allWithBalance]);

  const serviceOptions = useMemo(() => Array.from(new Set(rowsWithMethodLabel.map((e) => e.service).filter(Boolean))).sort(), [rowsWithMethodLabel]);
  const destOptions = useMemo(() => Array.from(new Set(rowsWithMethodLabel.map((e) => e.destination).filter(Boolean))).sort(), [rowsWithMethodLabel]);
  const methodOptions = useMemo(() => Array.from(new Set(rowsWithMethodLabel.map((e) => e.methodLabel).filter((v) => v && v !== "—"))).sort(), [rowsWithMethodLabel]);

  const initialFilters = (): Record<string, CF.ColumnFilterState> => ({
    date: CF.emptyDateRange(),
    description: CF.emptyText(),
    service: CF.emptyMultiSelect(),
    destination: CF.emptyMultiSelect(),
    count: CF.emptyNumeric(),
    price: CF.emptyNumeric(),
    serviceValue: CF.emptyNumeric(),
    payment: CF.emptyNumeric(),
    debit: CF.emptyNumeric(),
    credit: CF.emptyNumeric(),
    balance: CF.emptyNumeric(),
    method: CF.emptyMultiSelect(),
    note: CF.emptyText(),
  });
  const [filters, setFilters] = useState<Record<string, CF.ColumnFilterState>>(() => CF.sanitizeFilterMap(undefined, initialFilters()));
  const setF = (k: string, s: CF.ColumnFilterState) => setFilters((p) => CF.sanitizeFilterMap({ ...p, [k]: s }, initialFilters()));
  const resetAll = () => setFilters(initialFilters());
  const safeFilters = CF.sanitizeFilterMap(filters, initialFilters());
  const anyActive = Object.values(safeFilters).some(CF.isFilterActive);

  const [visible, setVisible] = usePersistentColumnVisibility("company-statement", COMPANY_STATEMENT_COLUMNS);
  const isVisible = (k: string) => visible[k] !== false;

  const displayRows = useMemo(() => rowsWithMethodLabel.filter((e) => {
    if (!CF.matchDateRange(e.date, safeFilters.date)) return false;
    if (!CF.matchText(e.description, safeFilters.description)) return false;
    if (!CF.matchMultiSelect(e.service, safeFilters.service)) return false;
    if (!CF.matchMultiSelect(e.destination, safeFilters.destination)) return false;
    if (!CF.matchNumeric(e.count, safeFilters.count)) return false;
    if (!CF.matchNumeric(e.price, safeFilters.price)) return false;
    if (!CF.matchNumeric(e.serviceValue, safeFilters.serviceValue)) return false;
    if (!CF.matchNumeric(e.payment, safeFilters.payment)) return false;
    if (!CF.matchNumeric(e.debit, safeFilters.debit)) return false;
    if (!CF.matchNumeric(e.credit, safeFilters.credit)) return false;
    if (!CF.matchNumeric(e.balance, safeFilters.balance)) return false;
    if (!CF.matchMultiSelect(e.methodLabel, safeFilters.method)) return false;
    if (!CF.matchText(e.note, safeFilters.note)) return false;
    return true;
  }), [rowsWithMethodLabel, safeFilters]);

  const buildData = () => ({
    title: `كشف حساب الشركة${company?.company_name ? ` — ${company.company_name}` : ""}${currencyFilter ? ` (${currencyFilter})` : ""}`,
    subtitle: company ? company.company_name : "كل الشركات",
    fileName: buildArabicFileName("كشف حساب الشركة", company?.company_name, currencyFilter),
    summary: [
      ...byCurrency.flatMap((b) => [
        { label: `إجمالي مدين (${b.currency})`, value: fmtCurrency(b.debit, b.currency) },
        { label: `إجمالي دائن (${b.currency})`, value: fmtCurrency(b.credit, b.currency) },
        { label: `الصافي (${b.currency})`, value: fmtCurrency(Math.abs(b.net), b.currency) },
      ]),
      { label: "حالة الحساب", value: accountStatus },
    ],
    columns: ([
      { header: "#", key: "n" }, { header: "التاريخ", key: "date" }, { header: "البيان", key: "description" },
      { header: "نوع الخدمة", key: "service" }, { header: "وجهة السفر", key: "destination" },
      { header: "العدد", key: "count" }, { header: "السعر", key: "price" },
      { header: "قيمة الرحلة", key: "serviceValue", exportKey: "sv" },
      { header: "مدين", key: "debit" }, { header: "دائن", key: "credit" },
      { header: "الرصيد الحالي", key: "balance" }, { header: "وسيلة الدفع", key: "method" }, { header: "ملاحظات", key: "note" },
    ] as Array<{ header: string; key: string; exportKey?: string }>)
      .filter((c) => isVisible(c.key))
      .map((c) => ({ header: c.header, key: c.exportKey || c.key })),
    rows: displayRows.map((e, i) => ({
      n: i + 1, date: e.date, description: e.description, service: e.service, destination: e.destination,
      count: e.count, count__excel: e.count, price: fmtNum(e.price), price__excel: e.price,
      sv: fmtCurrency(e.serviceValue, e.currency), sv__excel: e.serviceValue,
      debit: e.debit > 0 ? fmtCurrency(e.debit, e.currency) : "—", debit__excel: e.debit,
      credit: e.credit > 0 ? fmtCurrency(e.credit, e.currency) : "—", credit__excel: e.credit,
      balance: fmtCurrency(e.balance, e.currency), balance__excel: e.balance,
      method: e.methodLabel, note: e.note,
    })),
  });

  useRegisterStatementCapture(
    () => ({ data: buildData(), whatsapp: (company as any)?.whatsapp || null, contextId: company?.id || null }),
    [company, displayRows, byCurrency, accountStatus, filters],
  );

  const Th = ({ children, filterKey, options }: { children: React.ReactNode; filterKey?: string; options?: string[] }) => (
    <th>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
        <span>{children}</span>
        {filterKey && <CF.ColumnFilter label={String(children)} state={safeFilters[filterKey]} onChange={(s) => setF(filterKey, s)} options={options} />}
      </span>
    </th>
  );

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="card-title">كشف حساب الشركة الصادرة</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <CurrencyFilter value={currencyFilter} onChange={setCurrencyFilter} options={currencyOptions} />
          {anyActive && <button type="button" className="action-btn" onClick={resetAll}>مسح جميع الفلاتر</button>}
          <ColumnVisibility columns={COMPANY_STATEMENT_COLUMNS} visible={visible} onChange={setVisible} />
          {canExport && <ExportButton disabled={displayRows.length === 0} getData={buildData} whatsapp={{ phone: (company as any)?.whatsapp || (company as any)?.phone || null, recipientName: (company as any)?.company_name || null }} />}
        </div>
      </div>
      <div className="card-body">
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div className="form-group"><label>الشركة الصادرة</label>
            <SearchableSelect value={companyId} onChange={setCompanyId} options={safeCompanies.map((c) => ({ value: c.id, label: c.company_name }))} placeholder="اختر..." />
          </div>
        </div>

        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead>
              <tr>
                {isVisible("n") && <th>#</th>}
                {isVisible("date") && <Th filterKey="date">التاريخ</Th>}
                {isVisible("description") && <Th filterKey="description">البيان</Th>}
                {isVisible("service") && <Th filterKey="service" options={serviceOptions}>نوع الخدمة</Th>}
                {isVisible("destination") && <Th filterKey="destination" options={destOptions}>وجهة السفر</Th>}
                {isVisible("count") && <Th filterKey="count">العدد</Th>}
                {isVisible("price") && <Th filterKey="price">السعر</Th>}
                {isVisible("serviceValue") && <Th filterKey="serviceValue">قيمة الرحلة</Th>}
                {isVisible("debit") && <Th filterKey="debit">مدين</Th>}
                {isVisible("credit") && <Th filterKey="credit">دائن</Th>}
                {isVisible("balance") && <Th filterKey="balance">الرصيد الحالي</Th>}
                {isVisible("method") && <Th filterKey="method" options={methodOptions}>وسيلة الدفع</Th>}
                {isVisible("note") && <Th filterKey="note">ملاحظات</Th>}
                {isVisible("actions") && <th>إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr><td colSpan={COMPANY_STATEMENT_COLUMNS.filter((c) => isVisible(c.key)).length}><div className="empty"><div className="empty-text">لا توجد حركات مطابقة</div></div></td></tr>
              ) : displayRows.map((e, i) => (
                <tr key={e.id} style={{ background: e.kind === "payment" ? "rgba(22,163,74,0.04)" : undefined }}>
                  {isVisible("n") && <td data-label="#">{i + 1}</td>}
                  {isVisible("date") && <td data-label="التاريخ">{e.date}</td>}
                  {isVisible("description") && <td data-label="البيان" className="bold">{e.description}</td>}
                  {isVisible("service") && <td data-label="نوع الخدمة">{e.service}</td>}
                  {isVisible("destination") && <td data-label="وجهة السفر">{e.destination}</td>}
                  {isVisible("count") && <td data-label="العدد">{e.count || "—"}</td>}
                  {isVisible("price") && <td data-label="السعر">{e.price ? fmtNum(e.price) : "—"}</td>}
                  {isVisible("serviceValue") && <td data-label="قيمة الرحلة">{e.serviceValue ? fmtCurrency(e.serviceValue, e.currency) : "—"}</td>}
                  {isVisible("debit") && <td data-label="مدين" style={{ color: "var(--red)", fontWeight: 700 }}>{e.debit ? fmtCurrency(e.debit, e.currency) : "—"}</td>}
                  {isVisible("credit") && <td data-label="دائن" style={{ color: "var(--green)", fontWeight: 700 }}>{e.credit ? fmtCurrency(e.credit, e.currency) : "—"}</td>}
                  {isVisible("balance") && <td data-label="الرصيد الحالي" style={{ fontWeight: 800, color: e.balance > 0 ? "var(--red)" : e.balance < 0 ? "var(--green)" : undefined }}>{fmtCurrency(e.balance, e.currency)}</td>}
                  {isVisible("method") && <td data-label="وسيلة الدفع">{e.methodLabel}</td>}
                  {isVisible("note") && <td data-label="ملاحظات">{e.note}</td>}
                  {isVisible("actions") && (
                    <td data-label="إجراءات">
                      <EditTransactionButton table="company_transactions" id={e.id} cancelled={false} />
                      <CancelTransactionButton table="company_transactions" id={e.id} cancelled={false} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CurrencyTotalsCards totals={byCurrency} entityKind="company" />
      </div>
    </div>
  );
}


function EditCompanyModal({ company, onClose }: { company: IssuingCompany; onClose: () => void }) {
  const c = company as any;
  const { permissions, isAdmin } = useAuth();
  const canManagePricing = checkPerm(permissions, isAdmin, "service_pricing_manage", "view");
  const canSearchPricing = checkPerm(permissions, isAdmin, "service_price_search", "view");
  const canSeePricing = canManagePricing || canSearchPricing;
  const [activeTab, setActiveTab] = useState<"info" | "pricing">("info");
  const [form, setForm] = useState({
    company_name: company.company_name || "",
    phone: company.phone || "",
    whatsapp: company.whatsapp || "",
    status: company.status || "نشط",
  });
  const [openings, setOpenings] = useState<OpeningEntry[]>([]);
  useEffect(() => {
    let alive = true;
    readEntityOpeningEntries("company", company.id).then((rows) => { if (alive) setOpenings(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [company.id]);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.company_name.trim()) return toast.error("اسم الشركة مطلوب");
    setSaving(true);
    const { error } = await supabase.from("issuing_companies").update({
      company_name: form.company_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      status: form.status || "نشط",
    } as any).eq("id", company.id);
    if (error) { setSaving(false); return toast.error(error.message); }
    try {
      await syncEntityOpeningEntries("company", company.id, openings);
    } catch (e: any) {
      setSaving(false);
      return toast.error(e?.message || "فشل حفظ الأرصدة الافتتاحية");
    }
    setSaving(false);
    toast.success("تم تحديث بيانات الشركة بنجاح");
    onClose();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 920, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">✏️ تعديل بيانات الشركة</div></div>
        <div style={{ padding: "12px 16px 0" }}>
          <div
            role="tablist"
            aria-label="أقسام بيانات الشركة"
            style={{
              display: "grid",
              gridTemplateColumns: canSeePricing ? "1fr 1fr" : "1fr",
              gap: 4,
              padding: 4,
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              height: 44,
            }}
          >
            {([
              { key: "info", label: "البيانات", Icon: Building2 },
              ...(canSeePricing ? [{ key: "pricing" as const, label: "ملف التسعير", Icon: BadgeDollarSign }] : []),
            ] as const).map(({ key, label, Icon }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(key)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    height: "100%",
                    border: 0,
                    background: active ? "var(--primary)" : "transparent",
                    color: active ? "#fff" : "var(--muted, #64748b)",
                    fontWeight: active ? 700 : 600,
                    fontSize: 14,
                    borderRadius: 10,
                    cursor: "pointer",
                    boxShadow: active ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
                    transition: "background-color 150ms ease-out, color 150ms ease-out",
                  }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(15,23,42,0.04)"; }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  <Icon size={16} strokeWidth={2} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>



        {activeTab === "info" && (<div key="tab-info">
        <div className="form-grid">
          <div className="form-group"><label>اسم الشركة</label><input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div className="form-group"><label>الحالة</label>
            <SearchableSelect value={form.status} onChange={(v) => set("status", v)} options={["نشط", "غير نشط"]} allowClear={false} />
          </div>
        </div>

        <OpeningEntriesEditor value={openings} onChange={setOpenings} />

        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ التعديلات" type="button" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التعديلات</button>
        </div>
        </div>)}

        {canSeePricing && activeTab === "pricing" && <div key="tab-pricing"><CompanyPricingTab companyId={company.id} /></div>}
      </div>
    </div>,
    document.body,
  );
}

function CompanyForm({ onDone }: { onDone: () => void }) {
  const [form, setForm, clearForm] = usePersistentState(
    "form:company:add",
    { company_name: "", phone: "", whatsapp: "", status: "نشط" },
  );
  const [openings, setOpenings] = useState<OpeningEntry[]>([]);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const resetAll = () => { clearForm(); setOpenings([]); };
  const save = async () => {
    if (!form.company_name) return toast.error("برجاء إدخال اسم الشركة");
    const { data, error } = await supabase.from("issuing_companies").insert({
      company_name: form.company_name,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
      status: form.status || "نشط",
    } as any).select("id").single();
    if (error) return toast.error(error.message);
    if (data?.id) {
      try { await syncEntityOpeningEntries("company", data.id, openings); }
      catch (e: any) { toast.error(e?.message || "فشل حفظ الأرصدة الافتتاحية"); }
    }
    resetAll();
    onDone();
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">➕ إضافة شركة جديدة</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم الشركة</label>
          <input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="اسم الشركة الصادرة" />
        </div>
        <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        <div className="form-group"><label>الحالة</label>
          <SearchableSelect value={form.status} onChange={(v) => set("status", v)} options={["نشط", "غير نشط"]} allowClear={false} />
        </div>
      </div>

      <OpeningEntriesEditor value={openings} onChange={setOpenings} />

      <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button data-confirm-save="تأكيد حفظ الشركة" className="btn btn-gold" onClick={save}>💾 حفظ الشركة</button>
      </div>
    </div>
  );
}



type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

function CompanyTxnForm({ companies, merchants, onDone }: { companies: IssuingCompany[]; merchants: Merchant[]; txns: CompanyTransaction[]; flights: any[]; approvals: any[]; agents: Agent[]; onDone: () => void }) {
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");
  const SERVICE_TYPES = useDropdownOptions("service_type");
  const DESTINATIONS = useDropdownOptions("destination");
  const balances = useSourceBalances();


  const [form, setForm] = useState({
    company_id: "",
    date: new Date().toISOString().slice(0, 10),
    service_type: "",
    destination: "",
    count: "0",
    price: "",
    note: "",
    statement: "",
  });

  const [splits, setSplits] = useState<PaymentSplitRow[]>([newPaymentSplitRow()]);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const tripValueNum = (Number(form.count) || 0) * (Number(form.price) || 0);


  const totalAmount = useMemo(
    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [splits],
  );

  const save = async () => {
    if (!form.company_id) return toast.error("اختر الشركة الصادرة");
    if (!form.date) return toast.error("التاريخ مطلوب");

    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    const validSplits = filterValidSplits(splits);
    for (const r of validSplits) {
      if (!r.currency) return toast.error("يجب اختيار العملة");
      const allowed = methodsForSplitWidget(r, merchants).map((m) => m.key);
      if (!allowed.includes(r.method)) return toast.error("وسيلة الدفع غير مفعلة لهذا التاجر");
    }
    const selectedCurrency = validSplits[0]?.currency;
    if (!selectedCurrency) return toast.error("يجب اختيار العملة");
    if (validSplits.some((r) => r.currency !== selectedCurrency)) {
      return toast.error("لا يمكن حفظ حركة واحدة بأكثر من عملة؛ أضف حركة منفصلة لكل عملة");
    }
    const balanceErr = validateSplitOutflows(validSplits, balances, merchants);
    if (balanceErr) return toast.error(balanceErr);




    // Aggregate (NO commission on merchant wallet for company payments)
    let instapay = 0, cash = 0, merchantWallet = 0, merchantPhysical = 0;
    for (const r of validSplits) {
      const a = Number(r.amount) || 0;
      if (r.method === "company_instapay" || r.method === "merchant_instapay") instapay += a;
      else if (r.method === "company_cash") cash += a;
      else if (r.method === "merchant_wallet") merchantWallet += a;
      else if (r.method === "merchant_physical") merchantPhysical += a;
    }

    const firstMerchant = validSplits.find((r) => r.source === "merchant")?.merchant_id || null;

    const payload: any = {
      company_id: form.company_id,
      date: form.date,
      destination: form.destination || null,
      service_type: form.service_type || null,
      count: Number(form.count) || 0,
      price: Number(form.price) || 0,
      trip_value: tripValueNum,
      instapay_amount: instapay,
      cash_amount: cash,
      merchant_cash_amount: merchantWallet,
      merchant_cash_net_amount: merchantWallet, // No 1% commission for company payments
      merchant_cash_physical_amount: merchantPhysical,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      total_paid: totalAmount,
      usd_amount: 0,
      currency: selectedCurrency,
      payment_currency: selectedCurrency,
      merchant_id: firstMerchant,
      note: form.note.trim() ? form.note.trim() : null,
      statement: form.statement.trim() ? form.statement.trim() : null,
    };


    setSaving(true);
    const { data: txnRow, error: txnErr } = await supabase
      .from("company_transactions").insert(payload).select("id").single();
    if (txnErr || !txnRow) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الحركة"); }
    await logCreate("company_transactions", txnRow.id, { ...payload, id: txnRow.id }, "حركة شركة");

    const engineSplits: MovementSplit[] = validSplits.map((r) => {
      const a = Number(r.amount) || 0;
      let methodLabel = "نقدي";
      let cashBoxId: string | null = null;
      if (r.method === "company_instapay") {
        methodLabel = "إنستاباي";
        const box = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method);
        cashBoxId = box?.id || null;
      } else if (r.method === "company_cash") {
        methodLabel = "نقدي";
        const box = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method);
        cashBoxId = box?.id || null;
      } else if (r.method === "merchant_instapay") methodLabel = "انستا";
      else if (r.method === "merchant_wallet") methodLabel = "فودافون كاش";
      else if (r.method === "merchant_physical") methodLabel = "نقدي";
      return {
        method: methodLabel,
        currency: r.currency as any,
        cashBoxId,
        amount: a,
        direction: "out",
        grossAmount: a,
        commissionRate: 0,
        commissionAmount: 0,
        netAmount: a,
        exchangeRate: 1,
        egpEquivalent: r.currency === "EGP" ? a : 0,
      };
    });
    const engineRes = await postMovement({
      partyType: "company",
      partyId: form.company_id,
      kind: "payment",
      date: form.date,
      note: form.note.trim() ? form.note.trim() : undefined,
      statement: form.statement.trim() ? form.statement.trim() : undefined,
      splits: engineSplits,

      sourceTable: "company_transactions",
      sourceId: txnRow.id,
    });
    if (!engineRes.ok) {
      setSaving(false);
      return toast.error(engineRes.error || "تعذر حفظ سطور الدفع");
    }

    const merchantRes = await postMerchantCashOutToCompanyCounterparts({
      splits: validSplits,
      companyTransactionId: txnRow.id,
      date: form.date,
      statement: form.statement.trim() || "صادر لشركة",
      note: form.note.trim() || undefined,
    });
    if (!merchantRes.ok) {
      setSaving(false);
      return toast.error(merchantRes.error || "تعذر حفظ قيد تاجر الكاش");
    }


    setSaving(false);
    toast.success("تم تسجيل الحركة");
    onDone();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💳 صرف حركة مالية للشركة</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الشركة الصادرة *</label>
          <SearchableSelect value={form.company_id} onChange={(v) => set("company_id", v)} options={activeOptions(companies, form.company_id, (c: IssuingCompany) => c.company_name)} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday />
        </div>
        <div className="form-group"><label>نوع الخدمة (اختياري)</label>
          <SearchableSelect value={form.service_type} onChange={(v) => set("service_type", v)} options={SERVICE_TYPES as unknown as string[]} placeholder="— بدون خدمة —" />
        </div>
        <div className="form-group"><label>وجهة السفر (اختياري)</label>
          <SearchableSelect value={form.destination} onChange={(v) => set("destination", v)} options={DESTINATIONS as unknown as string[]} />
        </div>
        <div className="form-group"><label>العدد (اختياري)</label>
          <NumberInput value={Number(form.count) || 0} onChange={(n) => set("count", n === 0 ? "" : String(n))} min={0} />
        </div>
        <div className="form-group"><label>السعر (اختياري)</label>
          <NumberInput value={Number(form.price) || 0} onChange={(n) => set("price", n === 0 ? "" : String(n))} min={0} />
        </div>
        <div className="form-group"><label>قيمة الرحلة (محسوبة)</label>
          <input type="number" value={tripValueNum || ""} disabled readOnly />
        </div>
        <div className="form-group full"><label>البيان</label>
          <input value={form.statement} onChange={(e) => set("statement", e.target.value)} placeholder="" />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="" />
        </div>

      </div>

      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} />


      <div className="form-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>
          إجمالي المدفوع للشركة: {totalAmount.toLocaleString()}
        </div>
        <button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الحركة</button>
      </div>
    </div>
  );
}


type ConvertSource = "" | "insta_company" | "cash_company" | "merchant_wallet" | "merchant_physical";
const SOURCE_LABELS: Record<Exclude<ConvertSource, "">, string> = {
  insta_company: "انستا الشركة",
  cash_company: "نقدي الشركة",
  merchant_wallet: "تاجر الكاش",
  merchant_physical: "نقدي التاجر",
};

function UsdConvertModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    egp_amount: "",
    exchange_rate: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
    statement: "",
    source_type: "" as ConvertSource,
    merchant_id: "",
  });

  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const egp = Number(form.egp_amount || 0);
  const rate = Number(form.exchange_rate || 0);
  const usd = rate > 0 ? egp / rate : 0;

  const { rows: agentTxns } = useLive<import("@/lib/db").Transaction>("transactions");
  const { rows: companyTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: collections } = useLive<import("@/lib/db").MerchantCashCollection>("merchant_cash_collections");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");

  const needsMerchant = form.source_type === "merchant_wallet" || form.source_type === "merchant_physical";
  const activeMerchants = merchants.filter((m) => (m.status || "نشط") === "نشط");

  const sourceBalance = useMemo(
    () => computeUsdConversionSourceBalance({
      sourceType: (form.source_type || "") as any,
      merchantId: form.merchant_id,
      agentTxns, companyTxns, collections, usdRows,
    }),
    [form.source_type, form.merchant_id, agentTxns, companyTxns, collections, usdRows],
  );

  // Need merchantCashNet helper imported
  const save = async () => {
    if (egp <= 0) return toast.error("أدخل المبلغ بالجنيه");
    if (rate <= 0) return toast.error("أدخل سعر الصرف");
    if (!form.source_type) return toast.error("اختر مصدر التحويل");
    if (needsMerchant && !form.merchant_id) return toast.error("اختر التاجر");
    if (egp > sourceBalance) return toast.error("لا يوجد رصيد كافي في مصدر التحويل");
    setSaving(true);
    const treasuryPayload = {
      date: form.date,
      type: "conversion",
      egp_amount: egp,
      usd_amount: Math.round(usd * 100) / 100,
      exchange_rate: rate,
      source_type: form.source_type,
      merchant_id: needsMerchant ? form.merchant_id : null,
      note: form.note.trim() ? form.note.trim() : null,
      statement: form.statement.trim() ? form.statement.trim() : null,
    };
    const { data: treasuryRow, error } = await supabase
      .from("usd_treasury_transactions").insert(treasuryPayload as any).select("id").single();

    setSaving(false);
    if (error) return toast.error(error.message);
    if (treasuryRow?.id) await logCreate("usd_treasury_transactions", treasuryRow.id, { ...treasuryPayload, id: treasuryRow.id }, "تحويل خزينة");
    toast.success("تم تحويل المبلغ إلى الخزينة الدولارية");
    onClose();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, margin: 0 }}>
        <div className="card-header"><div className="card-title">💱 تحويل إلى الخزينة الدولارية</div></div>
        <div className="form-grid">
          <div className="form-group"><label>مصدر التحويل</label>
            <SearchableSelect
              value={form.source_type}
              onChange={(v) => set("source_type", v)}
              options={(Object.keys(SOURCE_LABELS) as Array<keyof typeof SOURCE_LABELS>).map((k) => ({ value: k, label: SOURCE_LABELS[k] }))}
              placeholder="اختر..."
            />
          </div>
          {needsMerchant && (
            <div className="form-group"><label>التاجر</label>
              <SearchableSelect value={form.merchant_id} onChange={(v) => set("merchant_id", v)} options={activeMerchants.map((m) => ({ value: m.id, label: m.merchant_name }))} placeholder="اختر..." />
            </div>
          )}
          {form.source_type && (!needsMerchant || form.merchant_id) && (
            <div className="form-group full" style={{ background: "var(--surface, #f8fafc)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
              <small style={{ color: "var(--text2)" }}>الرصيد المتاح في المصدر: </small>
              <strong>{fmtDL(sourceBalance)}</strong>
            </div>
          )}
          <div className="form-group"><label>المبلغ بالجنيه</label>
            <NumberInput value={Number(form.egp_amount) || 0} onChange={(n) => set("egp_amount", n === 0 ? "" : String(n))} min={0} />
          </div>
          <div className="form-group"><label>سعر الصرف</label>
            <NumberInput value={Number(form.exchange_rate) || 0} onChange={(n) => set("exchange_rate", n === 0 ? "" : String(n))} min={0} step="0.01" />
          </div>
          <div className="form-group"><label>المبلغ بالدولار (تلقائي)</label>
            <input value={fmtUSD(usd)} disabled />
          </div>
          <div className="form-group"><label>التاريخ</label>
            <DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday />
          </div>
          <div className="form-group full"><label>البيان</label>
            <input value={form.statement} onChange={(e) => set("statement", e.target.value)} />
          </div>
          <div className="form-group full"><label>ملاحظات</label>
            <input value={form.note} onChange={(e) => set("note", e.target.value)} />
          </div>

        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ التحويل" type="button" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التحويل</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
