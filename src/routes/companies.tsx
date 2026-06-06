import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDL, fmtNum, fmtUSD, useLive, useDropdownOptions, withSelected, buildTravelStatement, useTreasuryBalances, merchantCashNet,
  type IssuingCompany, type CompanyTransaction, type Merchant, type Agent, type UsdTreasuryTransaction,
} from "@/lib/db";
import { ExportButton } from "@/components/ExportButton";
import { useRegisterStatementCapture } from "@/lib/statementCapture";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SafeSelectOptions } from "@/components/SafeSelectOptions";
import {
  PaymentSplits,
  newPaymentSplitRow,
  methodsForSplit as methodsForSplitWidget,
  validatePaymentSplits,
  filterValidSplits,
  type PaymentSplitRow,
} from "@/components/PaymentSplits";
import { Building2, Briefcase, Wallet, AlertCircle, Search, Plus, CreditCard, FileText, ChevronLeft } from "lucide-react";

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
  const [tab, setTab] = useState<"list" | "add" | "txn" | "statement">("list");
  const [statementCompanyId, setStatementCompanyId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [editCompany, setEditCompany] = useState<IssuingCompany | null>(null);

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
                      <th className="num-col">إجمالي الخدمات</th><th className="num-col">المدفوع</th><th className="num-col">المتبقي</th><th>إجراءات</th>
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
                        <tr key={c.id}>
                          <td data-label="#">{idx + 1}</td>
                          <td className="bold" data-label="الشركة الصادرة">{c.company_name}</td>
                          <td data-label="الهاتف">{c.phone || "—"}</td>
                          <td data-label="الواتساب">{c.whatsapp || "—"}</td>
                          <td className="num-col" data-label="إجمالي الخدمات">{fmtDL(s.trips)}</td>
                          <td className="num-col" data-label="المدفوع" style={{ color: "var(--green)", fontWeight: 700 }}>{fmtDL(s.paid)}</td>
                          <td className="num-col" data-label="المتبقي" style={{ color: due > 0 ? "var(--red)" : "var(--text2)", fontWeight: 700 }}>{fmtDL(due)}</td>
                          <td data-label="إجراءات" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {perm.edit && <button className="action-btn" onClick={() => setEditCompany(c)}>✏️ تعديل</button>}
                          </td>
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
      {tab === "statement" && <CompanyStatementTab companies={companies} txns={txns} initialCompanyId={statementCompanyId} canExport={perm.export} />}

      {editCompany && perm.edit && (
        <EditCompanyModal company={editCompany} onClose={() => setEditCompany(null)} />
      )}
    </div>
  );
}

function CompanyStatementTab({ companies, txns, initialCompanyId, canExport }: { companies: IssuingCompany[]; txns: CompanyTransaction[]; initialCompanyId: string; canExport: boolean }) {
  const [companyId, setCompanyId] = useState(initialCompanyId || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const company = companies.find((c) => c.id === companyId);
  const filtered = useMemo(() => txns.filter((t) =>
    (!companyId || t.company_id === companyId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  ).sort((a, b) =>
    (a.created_at || "").localeCompare(b.created_at || "") ||
    (a.date || "").localeCompare(b.date || "")
  ), [txns, companyId, from, to]);

  type LedgerRow = {
    id: string; date: string; description: string; debit: number; credit: number; balance: number; note: string;
  };
  const ledger = useMemo<LedgerRow[]>(() => {
    let bal = 0;
    return filtered.map((t) => {
      const debit = Math.round(Number(t.trip_value || 0));
      const credit = Math.round(Number(t.total_paid || 0));
      bal += debit - credit;
      const parts: string[] = [];
      if (debit > 0) parts.push(`${t.service_type || "خدمة"}${t.destination ? ` — ${t.destination}` : ""}`);
      if (credit > 0) parts.push(debit > 0 ? "+ دفعة للشركة" : "دفعة للشركة");
      return {
        id: t.id, date: t.date,
        description: parts.join(" ") || (t.note || "حركة"),
        debit, credit, balance: bal,
        note: t.note || "—",
      };
    });
  }, [filtered]);

  const totalServices = ledger.reduce((s, r) => s + r.debit, 0);
  const totalPaid = ledger.reduce((s, r) => s + r.credit, 0);
  const balance = totalServices - totalPaid;

  const buildData = () => ({
    title: "كشف حساب الشركة الصادرة",
    subtitle: `${company ? company.company_name : "كل الشركات"}${from || to ? ` — من ${from || "..."} إلى ${to || "..."}` : ""}`,
    fileName: `كشف-حساب-${company?.company_name || "الشركات"}`,
    summary: [
      { label: "إجمالي الخدمات (مدين للشركة)", value: fmtDL(totalServices) },
      { label: "إجمالي المدفوعات (دائن)", value: fmtDL(totalPaid) },
      { label: "الرصيد الحالي", value: fmtDL(balance) },
    ],
    columns: [
      { header: "#", key: "n" },
      { header: "التاريخ", key: "date" },
      { header: "البيان", key: "description" },
      { header: "مدين للشركة", key: "debit" },
      { header: "دائن (مدفوع)", key: "credit" },
      { header: "الرصيد الحالي", key: "balance" },
      { header: "ملاحظات", key: "note" },
    ],
    rows: ledger.map((r, i) => ({
      n: i + 1, date: r.date, description: r.description,
      debit: r.debit > 0 ? fmtDL(r.debit) : "—", debit__excel: r.debit,
      credit: r.credit > 0 ? fmtDL(r.credit) : "—", credit__excel: r.credit,
      balance: fmtDL(r.balance), balance__excel: r.balance,
      note: r.note,
    })),
  });

  useRegisterStatementCapture(
    () => ({ data: buildData(), whatsapp: (company as any)?.whatsapp || null, contextId: company?.id || null }),
    [company, from, to, ledger.length, totalServices, totalPaid],
  );

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="card-title">📂 كشف حساب الشركة الصادرة</div>
        {canExport && <ExportButton disabled={ledger.length === 0} getData={buildData} />}
      </div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
          <div className="form-group"><label>الشركة الصادرة</label>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">اختر...</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>التاريخ من</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="form-group"><label>التاريخ إلى</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>

        {company && (
          <div className="account-summary" style={{ marginBottom: 12 }}>
            <div className="sum-box"><div className="label">الشركة</div><div className="val">{company.company_name}</div></div>
            <div className="sum-box"><div className="label">الهاتف</div><div className="val">{company.phone || "—"}</div></div>
            <div className="sum-box"><div className="label">الواتساب</div><div className="val">{company.whatsapp || "—"}</div></div>
            <div className="sum-box gold"><div className="label">إجمالي الخدمات</div><div className="val">{fmtDL(totalServices)}</div></div>
            <div className="sum-box green"><div className="label">إجمالي المدفوعات</div><div className="val">{fmtDL(totalPaid)}</div></div>
            <div className="sum-box red"><div className="label">الرصيد الحالي</div><div className="val">{fmtDL(balance)}</div></div>
          </div>
        )}

        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>التاريخ</th><th>البيان</th><th className="num-col">مدين للشركة</th><th className="num-col">دائن (مدفوع)</th><th className="num-col">الرصيد الحالي</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan={7}><div className="empty"><div className="empty-text">لا توجد حركات في الفترة المحددة</div></div></td></tr>
              ) : ledger.map((r, i) => (
                <tr key={r.id}>
                  <td data-label="#">{i + 1}</td>
                  <td data-label="التاريخ">{r.date}</td>
                  <td data-label="البيان" className="bold">{r.description}</td>
                  <td data-label="مدين للشركة" className="num-col" style={{ color: "var(--red)", fontWeight: 700 }}>{r.debit > 0 ? fmtDL(r.debit) : "—"}</td>
                  <td data-label="دائن (مدفوع)" className="num-col" style={{ color: "var(--green)", fontWeight: 700 }}>{r.credit > 0 ? fmtDL(r.credit) : "—"}</td>
                  <td data-label="الرصيد الحالي" className="num-col" style={{ fontWeight: 800, color: r.balance > 0 ? "var(--red)" : r.balance < 0 ? "var(--green)" : undefined }}>{fmtDL(r.balance)}</td>
                  <td data-label="ملاحظات">{r.note}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="totals-foot">
              <tr>
                <td colSpan={3}>الإجمالي</td>
                <td className="num-col">{fmtDL(totalServices)}</td>
                <td className="num-col">{fmtDL(totalPaid)}</td>
                <td className="num-col" style={{ fontWeight: 800 }}>{fmtDL(balance)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}


function EditCompanyModal({ company, onClose }: { company: IssuingCompany; onClose: () => void }) {
  const [form, setForm] = useState({
    company_name: company.company_name || "",
    phone: company.phone || "",
    whatsapp: company.whatsapp || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.company_name.trim()) return toast.error("اسم الشركة مطلوب");
    setSaving(true);
    const { error } = await supabase.from("issuing_companies").update({
      company_name: form.company_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
    }).eq("id", company.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث بيانات الشركة بنجاح");
    onClose();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">✏️ تعديل بيانات الشركة</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم الشركة</label><input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التعديلات</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CompanyForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ company_name: "", phone: "", whatsapp: "" });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.company_name) return toast.error("برجاء إدخال اسم الشركة");
    const { error } = await supabase.from("issuing_companies").insert({
      company_name: form.company_name,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
    });
    if (error) return toast.error(error.message);
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
      </div>
      <div className="form-footer"><button className="btn btn-gold" onClick={save}>💾 حفظ الشركة</button></div>
    </div>
  );
}



type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

function CompanyTxnForm({ companies, merchants, onDone }: { companies: IssuingCompany[]; merchants: Merchant[]; txns: CompanyTransaction[]; flights: any[]; approvals: any[]; agents: Agent[]; onDone: () => void }) {
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");
  const SERVICE_TYPES = useDropdownOptions("service_type");
  const DESTINATIONS = useDropdownOptions("destination");

  const [form, setForm] = useState({
    company_id: "",
    date: new Date().toISOString().slice(0, 10),
    service_type: "",
    destination: "",
    count: "0",
    price: "",
    note: "",
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
      const allowed = methodsForSplitWidget(r, merchants).map((m) => m.key);
      if (!allowed.includes(r.method)) return toast.error("وسيلة الدفع غير مفعلة لهذا التاجر");
    }


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
      payment_currency: "EGP",
      merchant_id: firstMerchant,
      note: form.note.trim() || null,
    };

    setSaving(true);
    const { data: txnRow, error: txnErr } = await supabase
      .from("company_transactions").insert(payload).select("id").single();
    if (txnErr || !txnRow) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الحركة"); }

    const splitRecords = validSplits.map((r) => {
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
      else if (r.method === "merchant_wallet") methodLabel = "فودافون كاش تاجر";
      else if (r.method === "merchant_physical") methodLabel = "نقدي تاجر";

      // Company payment = outflow: negate amount so cash_boxes trigger subtracts.
      const signed = -a;
      return {
        transaction_id: txnRow.id,
        method: methodLabel,
        currency: r.currency,
        cash_box_id: cashBoxId,
        amount: signed,
        gross_amount: a,
        merchant_commission_rate: 0,
        merchant_commission_amount: 0,
        net_amount: a,
        exchange_rate: 1,
        egp_equivalent: r.currency === "EGP" ? signed : 0,
      };
    });
    if (splitRecords.length) {
      const { error: spErr } = await supabase.from("payment_splits").insert(splitRecords);
      if (spErr) console.warn("payment_splits insert error:", spErr.message);
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
          <select value={form.company_id} onChange={(e) => set("company_id", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div className="form-group"><label>نوع الخدمة (اختياري)</label>
          <select value={form.service_type} onChange={(e) => set("service_type", e.target.value)}>
            <option value="">— بدون خدمة —</option>
            <SafeSelectOptions options={SERVICE_TYPES} />
          </select>
        </div>
        <div className="form-group"><label>وجهة السفر (اختياري)</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)}>
            <option value="">—</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>العدد (اختياري)</label>
          <input type="number" min={0} value={form.count} onChange={(e) => set("count", e.target.value)} />
        </div>
        <div className="form-group"><label>السعر (اختياري)</label>
          <input type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} />
        </div>
        <div className="form-group"><label>قيمة الرحلة (محسوبة)</label>
          <input type="number" value={tripValueNum || ""} disabled readOnly />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} />


      <div className="form-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>
          إجمالي المدفوع للشركة: {totalAmount.toLocaleString()}
        </div>
        <button className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الحركة</button>
      </div>
    </div>
  );
}


type ConvertSource = "" | "insta_company" | "cash_company" | "merchant_wallet" | "merchant_physical";
const SOURCE_LABELS: Record<Exclude<ConvertSource, "">, string> = {
  insta_company: "انستا الشركة",
  cash_company: "نقدي الشركة",
  merchant_wallet: "فودافون كاش",
  merchant_physical: "نقدي التاجر",
};

function UsdConvertModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    egp_amount: "",
    exchange_rate: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
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
      note: form.note || null,
    });
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
            <select value={form.source_type} onChange={(e) => set("source_type", e.target.value)}>
              <option value="" disabled>اختر...</option>
              {(Object.keys(SOURCE_LABELS) as Array<keyof typeof SOURCE_LABELS>).map((k) => (
                <option key={k} value={k}>{SOURCE_LABELS[k]}</option>
              ))}
            </select>
          </div>
          {needsMerchant && (
            <div className="form-group"><label>التاجر</label>
              <select value={form.merchant_id} onChange={(e) => set("merchant_id", e.target.value)}>
                <option value="" disabled>اختر...</option>
                {activeMerchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
              </select>
            </div>
          )}
          {form.source_type && (!needsMerchant || form.merchant_id) && (
            <div className="form-group full" style={{ background: "var(--surface, #f8fafc)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
              <small style={{ color: "var(--text2)" }}>الرصيد المتاح في المصدر: </small>
              <strong>{fmtDL(sourceBalance)}</strong>
            </div>
          )}
          <div className="form-group"><label>المبلغ بالجنيه</label>
            <input type="number" placeholder="0" value={form.egp_amount} onChange={(e) => set("egp_amount", e.target.value)} />
          </div>
          <div className="form-group"><label>سعر الصرف</label>
            <input type="number" step="0.01" placeholder="0.00" value={form.exchange_rate} onChange={(e) => set("exchange_rate", e.target.value)} />
          </div>
          <div className="form-group"><label>المبلغ بالدولار (تلقائي)</label>
            <input value={fmtUSD(usd)} disabled />
          </div>
          <div className="form-group"><label>التاريخ</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </div>
          <div className="form-group full"><label>ملاحظات</label>
            <input value={form.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التحويل</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
