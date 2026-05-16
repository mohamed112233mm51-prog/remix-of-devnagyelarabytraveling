import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDL, fmtNum, fmtUSD, useLive, useDropdownOptions, withSelected, buildTravelStatement,
  type IssuingCompany, type CompanyTransaction, type Merchant, type Flight, type Approval, type Agent, type UsdTreasuryTransaction,
} from "@/lib/db";
import { ExportButton } from "@/components/ExportButton";
import { useRegisterStatementCapture } from "@/lib/statementCapture";
import { usePerm } from "@/hooks/usePerm";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SafeSelectOptions } from "@/components/SafeSelectOptions";
import { Building2, Briefcase, Wallet, AlertCircle, Search, Plus, CreditCard, FileText, ChevronLeft, DollarSign, ArrowRightLeft } from "lucide-react";

export const Route = createFileRoute("/companies")({
  component: () => <AppErrorBoundary><CompaniesPage /></AppErrorBoundary>,
});



function CompaniesPage() {
  const perm = usePerm("companies");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: txns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: flights } = useLive<Flight>("flights");
  const { rows: approvals } = useLive<Approval>("approvals");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const [tab, setTab] = useState<"list" | "add" | "txn" | "statement">("list");
  const [statementCompanyId, setStatementCompanyId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [editCompany, setEditCompany] = useState<IssuingCompany | null>(null);
  const [showConvert, setShowConvert] = useState(false);

  const usdBalance = useMemo(() => {
    return usdRows.reduce((s, r) => {
      const amt = Number(r.usd_amount || 0);
      if (r.type === "company_payment") return s - amt;
      return s + amt; // conversion or adjustment
    }, 0);
  }, [usdRows]);

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

  const filtered = companies.filter((c) =>
    !search || c.company_name.toLowerCase().includes(search.toLowerCase())
  );

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
                    ) : filtered.map((c, i) => {
                      const s = stats.get(c.id) || { trips: 0, paid: 0 };
                      const due = s.trips - s.paid;
                      return (
                        <tr key={c.id}>
                          <td data-label="#">{i + 1}</td>
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
  const filtered = txns.filter((t) =>
    (!companyId || t.company_id === companyId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  );
  const totalServices = filtered.reduce((s, t) => s + Number(t.trip_value || 0), 0);
  const totalPaid = filtered.reduce((s, t) => s + Number(t.total_paid || 0), 0);
  const balance = totalServices - totalPaid;

  const buildData = () => ({
    title: "كشف حساب الشركة الصادرة",
    subtitle: `${company ? company.company_name : "كل الشركات"}${from || to ? ` — من ${from || "..."} إلى ${to || "..."}` : ""}`,
    fileName: `كشف-حساب-${company?.company_name || "الشركات"}`,
    summary: [
      { label: "إجمالي الخدمات", value: fmtDL(totalServices) },
      { label: "إجمالي المدفوعات", value: fmtDL(totalPaid) },
      { label: "المتبقي للشركة", value: fmtDL(balance) },
    ],
    columns: [
      { header: "#", key: "n" },
      { header: "التاريخ", key: "date" },
      { header: "نوع الخدمة", key: "service" },
      { header: "الوجهة", key: "dest" },
      { header: "العدد", key: "count" },
      { header: "السعر", key: "price" },
      { header: "قيمة الخدمة", key: "tv" },
      { header: "المدفوع", key: "paid" },
      { header: "المتبقي", key: "rest" },
      { header: "بيان", key: "note" },
    ],
    rows: filtered.map((t, i) => {
      const tv = Number(t.trip_value || 0);
      const paidT = Number(t.total_paid || 0);
      const count = Number(t.count || 0);
      const displayedPrice = Number(t.price || 0);
      return {
        n: i + 1,
        date: t.date,
        service: t.service_type || "—",
        dest: t.destination || "—",
        count: t.count,
        count__excel: count,
        price: fmtNum(displayedPrice),
        price__ui: displayedPrice,
        price__excel: displayedPrice,
        raw_price: Number(t.price || 0),
        tv: fmtDL(tv),
        tv__excel: tv,
        paid: fmtDL(paidT),
        paid__excel: paidT,
        rest: fmtDL(tv - paidT),
        rest__excel: tv - paidT,
        note: t.note || "—",
      };
    }),
  });

  useRegisterStatementCapture(
    () => ({ data: buildData(), whatsapp: (company as any)?.whatsapp || null, contextId: company?.id || null }),
    [company, from, to, filtered.length, totalServices, totalPaid],
  );

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="card-title">📂 كشف حساب الشركة الصادرة</div>
        {canExport && <ExportButton disabled={filtered.length === 0} getData={buildData} />}
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
            <div className="sum-box red"><div className="label">المتبقي للشركة</div><div className="val">{fmtDL(balance)}</div></div>
          </div>
        )}

        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>التاريخ</th><th>نوع الخدمة</th><th>الوجهة</th><th>العدد</th><th>السعر</th><th>قيمة الخدمة</th><th>المدفوع</th><th>المتبقي</th><th>بيان</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10}><div className="empty"><div className="empty-text">لا توجد حركات في الفترة المحددة</div></div></td></tr>
              ) : filtered.map((t, i) => {
                const tv = Number(t.trip_value || 0);
                const paidT = Number(t.total_paid || 0);
                return (
                  <tr key={t.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="التاريخ">{t.date}</td>
                    <td data-label="نوع الخدمة">{t.service_type || "—"}</td>
                    <td data-label="الوجهة">{t.destination || "—"}</td>
                    <td data-label="العدد">{t.count}</td>
                    <td data-label="السعر">{fmtNum(Number(t.price))}</td>
                    <td data-label="قيمة الخدمة">{fmtDL(tv)}</td>
                    <td data-label="المدفوع">{fmtDL(paidT)}</td>
                    <td data-label="المتبقي" style={{ color: "var(--red)", fontWeight: 700 }}>{fmtDL(tv - paidT)}</td>
                    <td data-label="بيان">{t.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
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



function CompanyTxnForm({ companies, merchants, txns, flights, approvals, agents, onDone }: { companies: IssuingCompany[]; merchants: Merchant[]; txns: CompanyTransaction[]; flights: Flight[]; approvals: Approval[]; agents: Agent[]; onDone: () => void }) {
  const [form, setForm] = useState({
    company_name: "", date: new Date().toISOString().slice(0, 10),
    destination: "", count: "", price: "", service_type: "",
    instapay_amount: "", cash_amount: "", merchant_cash_amount: "", merchant_cash_physical_amount: "",
    note: "", merchant_id: "", service_id: "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const DESTINATIONS = withSelected(useDropdownOptions("destination"), form.destination);
  const SERVICE_TYPES = withSelected(useDropdownOptions("service_type"), form.service_type);
  const tv = Number(form.count || 0) * Number(form.price || 0);

  const selectedCompanyId = useMemo(
    () => companies.find((c) => c.company_name === form.company_name)?.id || "",
    [companies, form.company_name],
  );
  const dueServices = useMemo(() => {
    if (!selectedCompanyId) return [] as CompanyTransaction[];
    return txns.filter((t) =>
      t.company_id === selectedCompanyId &&
      !!t.source_service_id &&
      (!form.service_type || t.service_type === form.service_type) &&
      Number(t.trip_value || 0) - Number(t.total_paid || 0) > 0,
    );
  }, [txns, selectedCompanyId, form.service_type]);
  const selectedService = dueServices.find((s) => s.id === form.service_id) || null;

  const sourceLookup = useMemo(() => {
    const m = new Map<string, { passenger_name: string; agent_id: string | null; travel_statement: string | null; destination: string | null; airline: string | null; travel_date: string | null }>();
    for (const f of flights) m.set(f.id, { passenger_name: f.passenger_name, agent_id: f.agent_id, travel_statement: f.travel_statement, destination: f.destination, airline: f.airline, travel_date: f.travel_date });
    for (const a of approvals) m.set(a.id, { passenger_name: a.passenger_name, agent_id: a.agent_id, travel_statement: a.travel_statement, destination: a.destination, airline: a.airline, travel_date: a.travel_date });
    return m;
  }, [flights, approvals]);
  const sourceForSelected = selectedService ? sourceLookup.get(selectedService.source_service_id || "") : null;
  const selectedAgent = sourceForSelected?.agent_id ? agents.find((a) => a.id === sourceForSelected.agent_id) : null;

  useEffect(() => {
    if (form.service_id && !dueServices.find((s) => s.id === form.service_id)) {
      setForm((p) => ({ ...p, service_id: "" }));
    }
  }, [dueServices, form.service_id]);

  useEffect(() => {
    if (!selectedService) return;
    const src = sourceLookup.get(selectedService.source_service_id || "");
    const autoStatement = src?.travel_statement || buildTravelStatement(selectedService.destination, src?.travel_date, src?.airline);
    setForm((p) => ({
      ...p,
      destination: selectedService.destination || "",
      count: String(selectedService.count || ""),
      price: String(selectedService.price || ""),
      service_type: selectedService.service_type || p.service_type,
      note: src?.passenger_name ? `${src.passenger_name}${autoStatement ? ` — ${autoStatement}` : ""}` : p.note,
    }));
  }, [form.service_id]);

  const lockFields = !!selectedService;
  const activeMerchants = merchants.filter((m) => (m.status || "نشط") === "نشط");
  const eligibleMerchants = activeMerchants.filter(
    (m) => m.supports_instapay || m.supports_cash_wallet || m.supports_physical_cash,
  );
  const selectedMerchant = activeMerchants.find((m) => m.id === form.merchant_id) || null;
  const merchantHasMethods = !!selectedMerchant && (selectedMerchant.supports_cash_wallet || selectedMerchant.supports_physical_cash);
  const showSystemInsta = true;
  const showSystemCash = true;
  const showMerchantCash = !!selectedMerchant && selectedMerchant.supports_cash_wallet;
  const showMerchantPhysical = !!selectedMerchant && selectedMerchant.supports_physical_cash;

  useEffect(() => {
    if (form.merchant_id && !activeMerchants.find((m) => m.id === form.merchant_id)) {
      setForm((p) => ({ ...p, merchant_id: "" }));
    }
  }, [activeMerchants.map((m) => m.id).join(",")]);

  useEffect(() => {
    setForm((p) => {
      const next = { ...p };
      if (!showMerchantCash && next.merchant_cash_amount) next.merchant_cash_amount = "";
      if (!showMerchantPhysical && next.merchant_cash_physical_amount) next.merchant_cash_physical_amount = "";
      return next;
    });
  }, [showMerchantCash, showMerchantPhysical]);

  const insta = Math.round(Number(form.instapay_amount || 0));
  const cash = Math.round(Number(form.cash_amount || 0));
  const merchant = showMerchantCash ? Math.round(Number(form.merchant_cash_amount || 0)) : 0;
  const merchantNet = merchant;
  const merchantPhysical = showMerchantPhysical ? Math.round(Number(form.merchant_cash_physical_amount || 0)) : 0;
  const totalPaid = insta + cash + merchantNet + merchantPhysical;
  const usesMerchant = !!selectedMerchant;
  const save = async () => {
    if (!form.company_name) return toast.error("برجاء اختيار الشركة الصادرة");
    if (selectedMerchant && !merchantHasMethods) return toast.error("لا توجد وسائل دفع مفعلة لهذا التاجر");
    if (totalPaid <= 0) return toast.error("يجب إدخال قيمة في حقل دفع واحد على الأقل");
    let company_id = companies.find((c) => c.company_name === form.company_name)?.id;
    if (!company_id) {
      const { data, error: cErr } = await supabase.from("issuing_companies").insert({ company_name: form.company_name, status: "نشط" }).select("id").single();
      if (cErr) return toast.error(cErr.message);
      company_id = data.id;
    }
    if (selectedService) {
      const newTotal = Number(selectedService.total_paid || 0) + totalPaid;
      const { error } = await supabase.from("company_transactions").update({
        instapay_amount: Number(selectedService.instapay_amount || 0) + insta,
        cash_amount: Number(selectedService.cash_amount || 0) + cash,
        merchant_cash_amount: Number(selectedService.merchant_cash_amount || 0) + merchant,
        merchant_cash_net_amount: Number(selectedService.merchant_cash_net_amount || 0) + merchantNet,
        merchant_cash_physical_amount: Number(selectedService.merchant_cash_physical_amount || 0) + merchantPhysical,
        merchant_id: usesMerchant ? form.merchant_id : selectedService.merchant_id,
        total_paid: newTotal,
        note: form.note || selectedService.note,
      }).eq("id", selectedService.id);
      if (error) return toast.error(error.message);
      toast.success("تم تسجيل الدفعة على الخدمة المستحقة");
      onDone();
      return;
    }
    const { error } = await supabase.from("company_transactions").insert({
      company_id, date: form.date,
      destination: form.destination || null,
      service_type: form.service_type || null,
      count: Number(form.count || 0), price: Number(form.price || 0),
      trip_value: tv,
      instapay_amount: insta,
      cash_amount: cash,
      merchant_cash_amount: merchant,
      merchant_cash_net_amount: merchantNet,
      merchant_cash_physical_amount: merchantPhysical,
      merchant_id: usesMerchant ? form.merchant_id : null,
      total_paid: totalPaid,
      note: form.note || null,
    });
    if (error) return toast.error(error.message);
    onDone();
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💳 صرف حركة مالية للشركة</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الشركة الصادرة</label>
          <select value={form.company_name} onChange={(e) => set("company_name", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {companies.map((c) => <option key={c.id} value={c.company_name}>{c.company_name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>التاريخ</label><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
        <div className="form-group"><label>نوع الخدمة</label>
          <select value={form.service_type} onChange={(e) => set("service_type", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={SERVICE_TYPES} />
          </select>
        </div>
        <div className="form-group"><label>الخدمة المستحقة</label>
          <select
            value={form.service_id}
            onChange={(e) => set("service_id", e.target.value)}
            disabled={!selectedCompanyId}
          >
            <option value="">{selectedCompanyId ? (dueServices.length ? "اختر الخدمة..." : "لا توجد خدمات مستحقة") : "اختر الشركة أولاً"}</option>
            {dueServices.map((s) => {
              const remaining = Number(s.trip_value || 0) - Number(s.total_paid || 0);
              const src = sourceLookup.get(s.source_service_id || "");
              const passenger = src?.passenger_name || "—";
              return (
                <option key={s.id} value={s.id}>
                  {s.service_type || "—"} — {passenger} — متبقي {fmtNum(remaining)}
                </option>
              );
            })}
          </select>
          {selectedService && (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 2 }}>
              <span><strong>المسافر:</strong> {sourceForSelected?.passenger_name || "—"}</span>
              <span><strong>الوكيل:</strong> {selectedAgent?.name || "—"}</span>
              <span><strong>بيان السفر:</strong> {sourceForSelected?.travel_statement || buildTravelStatement(selectedService.destination, sourceForSelected?.travel_date, sourceForSelected?.airline) || "—"}</span>
              <span><strong>المتبقي:</strong> {fmtNum(Number(selectedService.trip_value || 0) - Number(selectedService.total_paid || 0))}</span>
            </div>
          )}
        </div>
        <div className="form-group"><label>الوجهة</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)} disabled={lockFields}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>العدد</label><input type="number" min={1} placeholder="0" value={form.count} onChange={(e) => set("count", e.target.value)} disabled={lockFields} /></div>
        <div className="form-group"><label>السعر</label><input type="number" placeholder="0" value={form.price} onChange={(e) => set("price", e.target.value)} disabled={lockFields} /></div>
        <div className="form-group"><label>قيمة الخدمة</label><input value={fmtNum(tv)} disabled /></div>
        <div className="form-group full">
          <label style={{ fontWeight: 700, marginBottom: 8 }}>طريقة الدفع</label>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>التاجر</label>
            {eligibleMerchants.length > 0 ? (
              <select value={form.merchant_id} onChange={(e) => set("merchant_id", e.target.value)}>
                <option value="">— اختر جهة التحصيل —</option>
                {eligibleMerchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 13, color: "var(--muted-foreground, #6b7280)" }}>لا يوجد تجار مفعّل لهم وسائل دفع</div>
            )}
            {selectedMerchant && !merchantHasMethods && (
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--red, #dc2626)" }}>لا توجد وسائل دفع مفعلة لهذا التاجر</div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            {showSystemInsta && (
              <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>انستا الشركة</div>
                <input type="number" placeholder="0" value={form.instapay_amount} onChange={(e) => set("instapay_amount", e.target.value)} />
              </div>
            )}
            {showSystemCash && (
              <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>نقدي الشركة</div>
                <input type="number" placeholder="0" value={form.cash_amount} onChange={(e) => set("cash_amount", e.target.value)} />
              </div>
            )}
            {showMerchantCash && (
              <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>كاش التاجر{selectedMerchant ? ` (${selectedMerchant.merchant_name})` : ""}</div>
                <input type="number" placeholder="0" value={form.merchant_cash_amount} onChange={(e) => set("merchant_cash_amount", e.target.value)} />
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted-foreground, #6b7280)" }}>
                  صافي المرسل: <strong>{fmtNum(merchantNet)}</strong>
                </div>
              </div>
            )}
            {showMerchantPhysical && (
              <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>نقدي التاجر</div>
                <input type="number" placeholder="0" value={form.merchant_cash_physical_amount} onChange={(e) => set("merchant_cash_physical_amount", e.target.value)} />
              </div>
            )}
          </div>
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, background: "var(--muted, #f3f4f6)", fontWeight: 700, textAlign: "left" }}>
            إجمالي المدفوع: {fmtNum(totalPaid)} ج.م
          </div>
        </div>
        <div className="form-group full"><label>بيان</label><input value={form.note} onChange={(e) => set("note", e.target.value)} /></div>
      </div>
      <div className="form-footer"><button className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button></div>
    </div>
  );
}
