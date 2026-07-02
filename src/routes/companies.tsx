import { createFileRoute } from "@tanstack/react-router";
import { CancelTransactionButton } from "@/components/CancelTransactionButton";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDL, fmtNum, fmtUSD, fmtCurrency, useLive, useDropdownOptions, withSelected, useTreasuryBalances, merchantCashNet,
  type IssuingCompany, type CompanyTransaction, type Merchant, type Agent, type UsdTreasuryTransaction,
} from "@/lib/db";
import { ExportButton } from "@/components/ExportButton";
import { useRegisterStatementCapture } from "@/lib/statementCapture";
import { usePerm, checkPerm } from "@/hooks/usePerm";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { syncCompanyOpeningBalance } from "@/lib/openingBalance";
import { usePersistentState } from "@/hooks/usePersistentState";
import { CompanyPricingTab } from "@/components/CompanyPricingTab";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { postMerchantCashOutToCompanyCounterparts } from "@/lib/merchantCounterparty";

import {
  PaymentSplits,
  newPaymentSplitRow,
  methodsForSplit as methodsForSplitWidget,
  validatePaymentSplits,
  filterValidSplits,
  type PaymentSplitRow,
} from "@/components/PaymentSplits";
import { useSourceBalances, validateSplitOutflows } from "@/lib/balanceGuard";

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

  const stats = useMemo(() => {
    const map = new Map<string, { trips: number; paid: number }>();
    for (const t of txns) {
      const v = map.get(t.company_id) || { trips: 0, paid: 0 };
      v.trips += Number(t.trip_value || 0);
      v.paid += Number(t.total_paid || 0);
      map.set(t.company_id, v);
    }
    return map;
  }, [txns]);

  const totalTrips = txns.reduce((s, t) => s + Number(t.trip_value || 0), 0);
  const totalPaid = txns.reduce((s, t) => s + Number(t.total_paid || 0), 0);
  const totalDue = totalTrips - totalPaid;

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
            <div className="val">{fmtDL(totalTrips)}</div>
          </div>
        </div>
        <div className="sum-box green">
          <div className="kpi-icon"><Wallet size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">إجمالي المدفوع</div>
            <div className="val">{fmtDL(totalPaid)}</div>
          </div>
        </div>
        <div className="sum-box red">
          <div className="kpi-icon"><AlertCircle size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">المتبقي للشركات</div>
            <div className="val">{fmtDL(totalDue)}</div>
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
                      const s = stats.get(c.id) || { trips: 0, paid: 0 };
                      const due = s.trips - s.paid;
                      return (
                        <tr key={c.id} onClick={() => setViewCompany(c)} style={{ cursor: "pointer" }}>
                          <td data-label="#">{idx + 1}</td>
                          <td className="bold" data-label="الشركة الصادرة">{c.company_name}</td>
                          <td data-label="الهاتف">{c.phone || "—"}</td>
                          <td data-label="الواتساب">{c.whatsapp || "—"}</td>
                          <td className="num-col" data-label="إجمالي الخدمات">{fmtDL(s.trips)}</td>
                          <td className="num-col" data-label="المدفوع" style={{ color: "var(--green)", fontWeight: 700 }}>{fmtDL(s.paid)}</td>
                          <td className="num-col" data-label="المتبقي" style={{ color: due > 0 ? "var(--red)" : "var(--text2)", fontWeight: 700 }}>{fmtDL(due)}</td>
                          <td data-label="الحالة"><span className={`badge pill-badge ${((c as any).status || "نشط") === "نشط" ? "badge-green" : "badge-red"}`}>{(c as any).status || "نشط"}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="totals-foot">
                    <tr>
                      <td colSpan={4}>الإجمالي</td>
                      <td className="num-col">{fmtDL(totalTrips)}</td>
                      <td className="num-col">{fmtDL(totalPaid)}</td>
                      <td className="num-col">{fmtDL(totalDue)}</td>
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
        const s = stats.get(viewCompany.id) || { trips: 0, paid: 0 };
        const due = s.trips - s.paid;
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
              { label: "إجمالي الخدمات", value: fmtDL(s.trips), tone: "gold" },
              { label: "إجمالي المدفوعات", value: fmtDL(s.paid), tone: "green" },
              { label: "المتبقي", value: fmtDL(due), tone: due > 0 ? "red" : "default" },
            ]}
            fields={[
              { label: "اسم الشركة", value: viewCompany.company_name },
              { label: "الهاتف", value: viewCompany.phone },
              { label: "الواتساب", value: (viewCompany as any).whatsapp },
              { label: "رصيد سابق مدين", value: c.opening_debit ? fmtDL(Number(c.opening_debit)) : "—" },
              { label: "رصيد سابق دائن", value: c.opening_credit ? fmtDL(Number(c.opening_credit)) : "—" },
              { label: "تاريخ الرصيد السابق", value: c.opening_date || "—" },
              { label: "ملاحظات الرصيد السابق", value: c.opening_note || "—" },
            ]}
          />
        );
      })()}
    </div>
  );
}

type CompanyLedgerKind = "service" | "payment";
type CompanyLedgerEntry = {
  id: string; date: string; kind: CompanyLedgerKind; description: string; destination: string; service: string;
  count: number; price: number; serviceValue: number; payment: number; debit: number; credit: number;
  paymentMethod: string; note: string; currency: string; raw: CompanyTransaction;
};

function companyPaymentMethodLabel(t: CompanyTransaction): string {
  const parts: string[] = [];
  if (Number(t.instapay_amount || 0) > 0) parts.push("إنستاباي");
  if (Number(t.cash_amount || 0) > 0) parts.push("نقدي");
  if (Number(t.merchant_cash_amount || 0) > 0) parts.push("تاجر محفظة");
  if (Number(t.merchant_cash_physical_amount || 0) > 0) parts.push("تاجر نقدي");
  return parts.length ? parts.join(" + ") : "—";
}

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
    () => safeTxns
      .filter((t) => !(t as any).cancelled_at)
      .filter((t) => !companyId || t.company_id === companyId)
      .slice()
      .sort((a, b) =>
        (a.created_at || "").localeCompare(b.created_at || "") ||
        (a.date || "").localeCompare(b.date || ""),
      ),
    [safeTxns, companyId],
  );

  const splitCurrencyByTxnId = useMemo(() => {
    const buckets = new Map<string, Set<string>>();
    for (const s of liveSplits || []) {
      if (s.source_table !== "company_transactions") continue;
      const id = s.source_id || s.transaction_id;
      if (!id || !s.currency) continue;
      const set = buckets.get(id) || new Set<string>();
      set.add(s.currency);
      buckets.set(id, set);
    }
    const result = new Map<string, string>();
    buckets.forEach((set, id) => {
      if (set.size === 1) result.set(id, Array.from(set)[0]);
    });
    return result;
  }, [liveSplits]);

  const allEntries = useMemo<CompanyLedgerEntry[]>(() => myTxnsAll.map((t) => {
    const serviceValue = Math.round(Number(t.trip_value || 0));
    const payment = Math.round(Number(t.total_paid || 0));
    const kind: CompanyLedgerKind = serviceValue > 0 ? "service" : "payment";
    const description = String((t as any).statement || "").trim();
    return {
      id: t.id || `${t.created_at || "row"}-${t.company_id || "company"}`,
      date: t.date || "",
      kind,
      description,
      destination: t.destination || "—",
      service: t.service_type || "—",
      count: Number(t.count || 0),
      price: Number(t.price || 0),
      serviceValue,
      payment,
      debit: serviceValue,
      credit: payment,
      paymentMethod: payment > 0 ? companyPaymentMethodLabel(t) : "—",
      note: t.note || "—",
      currency: String(splitCurrencyByTxnId.get(t.id) || (t as any).currency || "EGP"),
      raw: t,
    };
  }), [myTxnsAll, splitCurrencyByTxnId]);

  // Per-currency running balance: EGP, USD, LYD, ... never mix.
  const allWithBalance = useMemo(() => {
    const bals = new Map<string, number>();
    return allEntries.map((e) => {
      const cur = e.currency || "EGP";
      const next = (bals.get(cur) || 0) + (e.debit - e.credit);
      bals.set(cur, next);
      return { ...e, balance: next };
    });
  }, [allEntries]);

  const totalServices = allEntries.reduce((s, e) => s + e.debit, 0);
  const totalPaid = allEntries.reduce((s, e) => s + e.credit, 0);
  const balance = totalServices - totalPaid;
  const accountStatus = balance > 0 ? "مدين عليه" : balance < 0 ? "دائن له" : "متوازن";

  const byCurrency = useMemo(() => {
    const debits = new Map<string, number>();
    const credits = new Map<string, number>();
    for (const e of allEntries) {
      const c = e.currency || "EGP";
      debits.set(c, (debits.get(c) || 0) + e.debit);
      credits.set(c, (credits.get(c) || 0) + e.credit);
    }
    const currencies = Array.from(new Set([...debits.keys(), ...credits.keys()]));
    return currencies.map((c) => {
      const d = debits.get(c) || 0;
      const cr = credits.get(c) || 0;
      return { currency: c, debit: d, credit: cr, net: d - cr };
    });
  }, [allEntries]);

  const rowsWithMethodLabel = useMemo(() => allWithBalance.map((e) => ({
    ...e,
    methodLabel: e.paymentMethod + (e.raw.merchant_id && merchantName(e.raw.merchant_id) ? ` — ${merchantName(e.raw.merchant_id)}` : ""),
  })), [allWithBalance, merchants]);

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
    title: "كشف حساب الشركة الصادرة",
    subtitle: company ? company.company_name : "كل الشركات",
    fileName: `كشف-حساب-${company?.company_name || "الشركات"}`,
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
    [company, displayRows, totalServices, totalPaid, balance, filters],
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {anyActive && <button type="button" className="action-btn" onClick={resetAll}>مسح جميع الفلاتر</button>}
          <ColumnVisibility columns={COMPANY_STATEMENT_COLUMNS} visible={visible} onChange={setVisible} />
          {canExport && <ExportButton disabled={displayRows.length === 0} getData={buildData} />}
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
                      <CancelTransactionButton table="company_transactions" id={e.id} cancelled={false} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="totals-foot">
              {byCurrency.map((b) => (
                <tr key={`totals-${b.currency}`}>
                  <td colSpan={COMPANY_STATEMENT_COLUMNS.filter((c) => isVisible(c.key)).length} style={{ fontWeight: 800 }}>
                    الإجمالي ({b.currency}) — مدين: {fmtCurrency(b.debit, b.currency)} · دائن: {fmtCurrency(b.credit, b.currency)} · الصافي: {fmtCurrency(Math.abs(b.net), b.currency)} ({b.net > 0 ? "مدين عليه" : b.net < 0 ? "دائن له" : "متوازن"})
                  </td>
                </tr>
              ))}
              {byCurrency.length === 0 && (
                <tr>
                  <td colSpan={COMPANY_STATEMENT_COLUMNS.filter((c) => isVisible(c.key)).length} style={{ fontWeight: 800 }}>
                    الإجمالي — مدين: {fmtDL(0)} · دائن: {fmtDL(0)} · الصافي: {fmtDL(0)} ({accountStatus})
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
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
    opening_debit: c.opening_debit ? String(c.opening_debit) : "",
    opening_credit: c.opening_credit ? String(c.opening_credit) : "",
    opening_currency: c.opening_currency || "EGP",
    opening_date: c.opening_date || "",
    opening_note: c.opening_note || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.company_name.trim()) return toast.error("اسم الشركة مطلوب");
    setSaving(true);
    const debit = Number(form.opening_debit) || 0;
    const credit = Number(form.opening_credit) || 0;
    const { error } = await supabase.from("issuing_companies").update({
      company_name: form.company_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      status: form.status || "نشط",
      opening_debit: debit,
      opening_credit: credit,
      opening_currency: form.opening_currency || "EGP",
      opening_date: form.opening_date || null,
      opening_note: form.opening_note.trim() || null,
    } as any).eq("id", company.id);
    if (error) { setSaving(false); return toast.error(error.message); }
    await syncCompanyOpeningBalance(company.id, {
      debit, credit,
      currency: form.opening_currency || "EGP",
      date: form.opening_date || null,
      note: form.opening_note.trim() || null,
    });
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

        <div className="card" style={{ marginTop: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
          <div className="card-header"><div className="card-title">📒 الرصيد السابق</div></div>
          <div className="card-body">
            <div className="form-grid">
              <div className="form-group"><label>رصيد سابق مدين</label>
                <NumberInput value={Number(form.opening_debit) || 0} onChange={(n) => set("opening_debit", n === 0 ? "" : String(n))} min={0} />
              </div>
              <div className="form-group"><label>رصيد سابق دائن</label>
                <NumberInput value={Number(form.opening_credit) || 0} onChange={(n) => set("opening_credit", n === 0 ? "" : String(n))} min={0} />
              </div>
              <div className="form-group"><label>تاريخ الرصيد السابق</label>
                <DateInput value={form.opening_date} onChange={(iso) => set("opening_date", iso)} />
              </div>
              <div className="form-group"><label>العملة</label>
                <select value={form.opening_currency} onChange={(e) => set("opening_currency", e.target.value)}>
                  <option value="EGP">جنيه مصري</option>
                  <option value="USD">دولار أمريكي</option>
                  <option value="LYD">دينار ليبي</option>
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>ملاحظات</label>
                <input value={form.opening_note} onChange={(e) => set("opening_note", e.target.value)} placeholder="ملاحظات اختيارية" />
              </div>
            </div>
          </div>
        </div>

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
  const [opening, setOpening, clearOpening] = usePersistentState(
    "form:company:add:opening",
    { debit: "", credit: "", currency: "EGP", date: "", note: "" },
  );
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const setOp = (k: string, v: string) => setOpening((p) => ({ ...p, [k]: v }));
  const resetAll = () => { clearForm(); clearOpening(); };
  const save = async () => {
    if (!form.company_name) return toast.error("برجاء إدخال اسم الشركة");
    const debit = Number(opening.debit) || 0;
    const credit = Number(opening.credit) || 0;
    const { data, error } = await supabase.from("issuing_companies").insert({
      company_name: form.company_name,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
      status: form.status || "نشط",
      opening_debit: debit,
      opening_credit: credit,
      opening_currency: opening.currency || "EGP",
      opening_date: opening.date || null,
      opening_note: opening.note.trim() || null,
    } as any).select("id").single();
    if (error) return toast.error(error.message);
    if (data?.id && (debit > 0 || credit > 0)) {
      await syncCompanyOpeningBalance(data.id, {
        debit, credit,
        currency: opening.currency || "EGP",
        date: opening.date || null,
        note: opening.note.trim() || null,
      });
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

      <div className="card" style={{ marginTop: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
        <div className="card-header"><div className="card-title">📒 الرصيد السابق</div></div>
        <div className="card-body">
          <div className="form-grid">
            <div className="form-group"><label>رصيد سابق مدين</label>
              <NumberInput value={Number(opening.debit) || 0} onChange={(n) => setOp("debit", n === 0 ? "" : String(n))} min={0} />
            </div>
            <div className="form-group"><label>رصيد سابق دائن</label>
              <NumberInput value={Number(opening.credit) || 0} onChange={(n) => setOp("credit", n === 0 ? "" : String(n))} min={0} />
            </div>
            <div className="form-group"><label>تاريخ الرصيد السابق</label>
              <DateInput value={opening.date} onChange={(iso) => setOp("date", iso)} />
            </div>
            <div className="form-group"><label>العملة</label>
              <select value={opening.currency || "EGP"} onChange={(e) => setOp("currency", e.target.value)}>
                <option value="EGP">جنيه مصري</option>
                <option value="USD">دولار أمريكي</option>
                <option value="LYD">دينار ليبي</option>
              </select>
            </div>
            <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>ملاحظات</label>
              <input value={opening.note} onChange={(e) => setOp("note", e.target.value)} placeholder="ملاحظات اختيارية" />
            </div>
          </div>
        </div>
      </div>

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

    const engineSplits: MovementSplit[] = validSplits.map((r) => {
      const a = Number(r.amount) || 0;
      let methodLabel = "نقدي";
      let cashBoxId: string | null = null;
      if (r.method === "company_instapay") {
        methodLabel = "إنستاباي";
        const box = cashBoxes.find((b) => b.currency === r.currency && b.name.includes("إنستا") && b.name.includes("الشركة"));
        cashBoxId = box?.id || null;
      } else if (r.method === "company_cash") {
        methodLabel = "نقدي";
        const box = cashBoxes.find((b) => b.currency === r.currency && b.name.includes("نقدي") && b.name.includes("الشركة"));
        cashBoxId = box?.id || null;
      } else if (r.method === "merchant_instapay") methodLabel = "إنستاباي تاجر";
      else if (r.method === "merchant_wallet") methodLabel = "تاجر الكاش تاجر";
      else if (r.method === "merchant_physical") methodLabel = "نقدي تاجر";
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

  const sourceBalance = useMemo(() => {
    const src = form.source_type;
    if (!src) return 0;
    const conversionsFor = (type: ConvertSource, mid?: string) =>
      usdRows
        .filter((r) => r.type === "conversion" && r.source_type === type && (mid ? r.merchant_id === mid : true))
        .reduce((s, r) => s + Number(r.egp_amount || 0), 0);
    if (src === "insta_company") {
      const inn = agentTxns.reduce((s, t) => s + Number(t.instapay_amount || 0), 0);
      const out = companyTxns.reduce((s, t) => s + Number(t.instapay_amount || 0), 0);
      return Math.round(inn - out - conversionsFor("insta_company"));
    }
    if (src === "cash_company") {
      const inn = agentTxns.reduce((s, t) => s + Number(t.cash_amount || 0), 0);
      const out = companyTxns.reduce((s, t) => s + Number(t.cash_amount || 0), 0);
      return Math.round(inn - out - conversionsFor("cash_company"));
    }
    const mid = form.merchant_id;
    if (!mid) return 0;
    if (src === "merchant_wallet") {
      const inn = agentTxns
        .filter((t) => t.merchant_id === mid)
        .reduce((s, t) => s + merchantCashNet(t), 0);
      const out = companyTxns
        .filter((t) => t.merchant_id === mid)
        .reduce((s, t) => s + merchantCashNet(t), 0);
      const collected = collections
        .filter((c) => c.merchant_id === mid)
        .reduce((s, c) => s + Number(c.amount || 0), 0);
      return Math.round(inn - out - collected - conversionsFor("merchant_wallet", mid));
    }
    // merchant_physical
    const inn = agentTxns
      .filter((t) => t.merchant_id === mid)
      .reduce((s, t) => s + Number(t.merchant_cash_physical_amount || 0), 0);
    const out = companyTxns
      .filter((t) => t.merchant_id === mid)
      .reduce((s, t) => s + Number(t.merchant_cash_physical_amount || 0), 0);
    return Math.round(inn - out - conversionsFor("merchant_physical", mid));
  }, [form.source_type, form.merchant_id, agentTxns, companyTxns, collections, usdRows]);

  // Need merchantCashNet helper imported
  const save = async () => {
    if (egp <= 0) return toast.error("أدخل المبلغ بالجنيه");
    if (rate <= 0) return toast.error("أدخل سعر الصرف");
    if (!form.source_type) return toast.error("اختر مصدر التحويل");
    if (needsMerchant && !form.merchant_id) return toast.error("اختر التاجر");
    if (egp > sourceBalance) return toast.error("لا يوجد رصيد كافي في مصدر التحويل");
    setSaving(true);
    const { error } = await supabase.from("usd_treasury_transactions").insert({
      date: form.date,
      type: "conversion",
      egp_amount: egp,
      usd_amount: Math.round(usd * 100) / 100,
      exchange_rate: rate,
      source_type: form.source_type,
      merchant_id: needsMerchant ? form.merchant_id : null,
      note: form.note.trim() ? form.note.trim() : null,
      statement: form.statement.trim() ? form.statement.trim() : null,
    } as any);

    setSaving(false);
    if (error) return toast.error(error.message);
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
