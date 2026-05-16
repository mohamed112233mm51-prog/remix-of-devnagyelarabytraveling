import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { badgeFor, fmtDL, fmtNum, tripValue, txnTotalPaid, merchantCashNetAmount, useLive, useDropdownOptions, withSelected, GOVERNORATES, buildTravelStatement, type Agent, type Merchant, type Transaction } from "@/lib/db";
import { ExportButton } from "@/components/ExportButton";
import { useRegisterStatementCapture } from "@/lib/statementCapture";
import { toast } from "sonner";
import { usePerm } from "@/hooks/usePerm";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SafeSelectOptions } from "@/components/SafeSelectOptions";
import { Plane, Wallet, AlertCircle, Search, UserPlus, CreditCard, FileText, Users, ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/accounts")({
  component: () => <AppErrorBoundary><AccountsPage /></AppErrorBoundary>,
});

type Tab = "list" | "add" | "txn" | "statement";

function AccountsPage() {
  const perm = usePerm("accounts");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const [tab, setTab] = useState<Tab>("list");
  const [search, setSearch] = useState("");
  const [statementAgentId, setStatementAgentId] = useState<string>("");
  const [editAgent, setEditAgent] = useState<Agent | null>(null);

  const stats = useMemo(() => {
    const map = new Map<string, { trips: number; paid: number }>();
    for (const t of txns) {
      const v = map.get(t.agent_id) || { trips: 0, paid: 0 };
      v.trips += tripValue(t);
      v.paid += txnTotalPaid(t);
      map.set(t.agent_id, v);
    }
    return map;
  }, [txns]);

  const totalTrips = txns.reduce((s, t) => s + tripValue(t), 0);
  const totalPaid = txns.reduce((s, t) => s + txnTotalPaid(t), 0);
  const totalDue = totalTrips - totalPaid;

  const filtered = agents.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="section active accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الحسابات المالية</span>
            <ChevronLeft size={12} strokeWidth={2} />
            <span className="crumb-current">حسابات الوكلاء</span>
          </div>
          <h1 className="page-h1"><Users size={20} strokeWidth={2.2} /> حسابات الوكلاء</h1>
          <div className="page-sub">إدارة ومتابعة حسابات الوكلاء</div>
        </div>
        {perm.create && (
          <button className="btn btn-gold page-head-cta" onClick={() => setTab("add")} type="button">
            <UserPlus size={16} strokeWidth={2.2} /> إضافة وكيل
          </button>
        )}
      </div>

      <div className="account-summary kpi-rich">
        <div className="sum-box gold">
          <div className="kpi-icon"><Plane size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">قيمة الرحلات</div>
            <div className="val">{fmtDL(totalTrips)}</div>
          </div>
        </div>
        <div className="sum-box green">
          <div className="kpi-icon"><Wallet size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">إجمالي المدفوعات</div>
            <div className="val">{fmtDL(totalPaid)}</div>
          </div>
        </div>
        <div className="sum-box red">
          <div className="kpi-icon"><AlertCircle size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">الصافي المستحق</div>
            <div className="val">{fmtDL(totalDue)}</div>
          </div>
        </div>
      </div>

      <div className="action-toolbar">
        <div className={`tool-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          <Users size={15} strokeWidth={2} /> <span>قائمة الوكلاء</span>
        </div>
        {perm.create && (
          <div className={`tool-tab ${tab === "txn" ? "active" : ""}`} onClick={() => setTab("txn")}>
            <CreditCard size={15} strokeWidth={2} /> <span>إضافة حركة</span>
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
                placeholder="ابحث بالاسم أو الكود..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <div className="card-title">قائمة الوكلاء <span className="muted-count">({filtered.length})</span></div>
            </div>
            <div className="card-body">
              <div className="table-wrap enterprise-table">
                <table className="mobile-cards">
                  <thead>
                    <tr>
                      <th>#</th><th>اسم الوكيل</th><th>الرقم القومي</th><th>الهاتف</th><th>الواتساب</th><th>المحافظة</th>
                      <th className="num-col">قيمة الرحلات</th><th className="num-col">المدفوعات</th><th className="num-col">الصافي</th><th>الحالة</th><th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={11}><div className="empty"><div className="empty-icon">👥</div><div className="empty-text">أضف وكلاء من تبويب "وكيل جديد"</div></div></td></tr>
                    ) : filtered.map((a, i) => {
                      const s = stats.get(a.id) || { trips: 0, paid: 0 };
                      return (
                        <tr key={a.id}>
                          <td data-label="#">{i + 1}</td>
                          <td className="bold" data-label="الاسم">{a.name}</td>
                          <td data-label="الرقم القومي">{a.national_id || "—"}</td>
                          <td data-label="الهاتف">{a.phone || "—"}</td>
                          <td data-label="الواتساب">{a.whatsapp || "—"}</td>
                          <td data-label="المحافظة">{a.governorate || "—"}</td>
                          <td className="num-col" data-label="قيمة الرحلات">{fmtDL(s.trips)}</td>
                          <td className="num-col" data-label="المدفوعات">{fmtDL(s.paid)}</td>
                          <td className="num-col" data-label="الصافي" style={{ color: "var(--red)", fontWeight: 700 }}>{fmtDL(s.trips - s.paid)}</td>
                          <td data-label="الحالة"><span className={`badge pill-badge ${badgeFor(a.status)}`}>{a.status}</span></td>
                          <td data-label="إجراءات">{perm.edit ? <button className="action-btn" onClick={() => setEditAgent(a)}>✏️ تعديل</button> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="totals-foot">
                    <tr>
                      <td colSpan={6}>الإجمالي</td>
                      <td className="num-col">{fmtDL(totalTrips)}</td>
                      <td className="num-col">{fmtDL(totalPaid)}</td>
                      <td className="num-col">{fmtDL(totalDue)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "add" && perm.create && <AgentForm onDone={() => setTab("list")} />}
      {tab === "txn" && perm.create && <TxnForm agents={agents} merchants={merchants} txns={txns} onDone={() => setTab("list")} />}
      {tab === "statement" && <AgentStatementTab agents={agents} txns={txns} merchants={merchants} initialAgentId={statementAgentId} canExport={perm.export} />}

      {editAgent && perm.edit && <EditAgentModal agent={editAgent} onClose={() => setEditAgent(null)} />}
    </div>
  );
}

function EditAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [form, setForm] = useState({
    name: agent.name || "",
    national_id: agent.national_id || "",
    phone: agent.phone || "",
    whatsapp: agent.whatsapp || "",
    governorate: agent.governorate || "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return toast.error("برجاء إدخال اسم الوكيل");
    if (!form.phone.trim()) return toast.error("برجاء إدخال رقم الهاتف");
    const { error } = await supabase.from("agents").update({
      name: form.name.trim(),
      national_id: form.national_id.trim() || null,
      phone: form.phone.trim(),
      whatsapp: form.whatsapp.trim() || null,
      governorate: form.governorate || null,
    }).eq("id", agent.id);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث بيانات الوكيل بنجاح");
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 640, width: "100%", margin: 0 }}>
        <div className="card-header"><div className="card-title">✏️ تعديل بيانات الوكيل</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم الوكيل</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div className="form-group"><label>المحافظة</label>
            <select value={form.governorate} onChange={(e) => set("governorate", e.target.value)}>
              <option value="">اختر...</option>
              {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="action-btn" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" onClick={save}>💾 حفظ التعديلات</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AgentStatementTab({ agents, txns, merchants: _merchants, initialAgentId, canExport }: { agents: Agent[]; txns: Transaction[]; merchants: Merchant[]; initialAgentId: string; canExport: boolean }) {
  const [agentId, setAgentId] = useState(initialAgentId || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const agent = agents.find((a) => a.id === agentId);
  const filtered = txns.filter((t) =>
    (!agentId || t.agent_id === agentId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  );

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("agent-statement-agent-change", {
      detail: agent ? { id: agent.id, whatsapp: agent.whatsapp || null } : null,
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("agent-statement-agent-change", { detail: null }));
    };
  }, [agent]);

  const totalTrips = filtered.reduce((s, t) => s + tripValue(t), 0);
  const totalPaid = filtered.reduce((s, t) => s + txnTotalPaid(t), 0);
  const balance = totalTrips - totalPaid;

  const buildData = () => ({
    title: "كشف حساب الوكيل",
    subtitle: `${agent ? agent.name : "كل الوكلاء"}${from || to ? ` — من ${from || "..."} إلى ${to || "..."}` : ""}`,
    fileName: `كشف-حساب-${agent?.name || "الوكلاء"}`,
    summary: [
      { label: "إجمالي قيمة الرحلات", value: fmtDL(totalTrips) },
      { label: "إجمالي المدفوعات", value: fmtDL(totalPaid) },
      { label: "الصافي المستحق", value: fmtDL(balance) },
    ],
    columns: [
      { header: "#", key: "n" },
      { header: "التاريخ", key: "date" },
      { header: "نوع الخدمة", key: "service" },
      { header: "الوجهة", key: "dest" },
      { header: "العدد", key: "count" },
      { header: "السعر", key: "price" },
      { header: "قيمة الرحلة", key: "tv" },
      { header: "المدفوع", key: "paid" },
      { header: "الصافي", key: "rest" },
      { header: "بيان", key: "note" },
    ],
    rows: filtered.map((t, i) => {
      const tv = tripValue(t);
      const paidT = txnTotalPaid(t);
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
    () => ({ data: buildData(), whatsapp: agent?.whatsapp || null, contextId: agent?.id || null }),
    [agent, from, to, filtered.length, totalTrips, totalPaid],
  );

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="card-title">📂 كشف حساب الوكيل</div>
        {canExport && <ExportButton disabled={filtered.length === 0} getData={buildData} />}
      </div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
          <div className="form-group"><label>الوكيل</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">اختر...</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>التاريخ من</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="form-group"><label>التاريخ إلى</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>

        {agent && (
          <div className="account-summary" style={{ marginBottom: 12 }}>
            <div className="sum-box"><div className="label">الوكيل</div><div className="val">{agent.name}</div></div>
            <div className="sum-box"><div className="label">الهاتف</div><div className="val">{agent.phone || "—"}</div></div>
            <div className="sum-box"><div className="label">المحافظة</div><div className="val">{agent.governorate || "—"}</div></div>
            <div className="sum-box gold"><div className="label">إجمالي قيمة الرحلات</div><div className="val">{fmtDL(totalTrips)}</div></div>
            <div className="sum-box green"><div className="label">إجمالي المدفوعات</div><div className="val">{fmtDL(totalPaid)}</div></div>
            <div className="sum-box red"><div className="label">الصافي المستحق</div><div className="val">{fmtDL(balance)}</div></div>
          </div>
        )}

        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>التاريخ</th><th>نوع الخدمة</th><th>الوجهة</th><th>العدد</th><th>السعر</th><th>قيمة الرحلة</th><th>المدفوع</th><th>الصافي</th><th>بيان</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10}><div className="empty"><div className="empty-text">لا توجد حركات في الفترة المحددة</div></div></td></tr>
              ) : filtered.map((t, i) => {
                const tv = tripValue(t);
                const paidT = txnTotalPaid(t);
                return (
                  <tr key={t.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="التاريخ">{t.date}</td>
                    <td data-label="نوع الخدمة">{t.service_type || "—"}</td>
                    <td data-label="الوجهة">{t.destination || "—"}</td>
                    <td data-label="العدد">{t.count}</td>
                    <td data-label="السعر">{fmtNum(Number(t.price))}</td>
                    <td data-label="قيمة الرحلة">{fmtDL(tv)}</td>
                    <td data-label="المدفوع">{fmtDL(paidT)}</td>
                    <td data-label="الصافي" style={{ color: "var(--red)", fontWeight: 700 }}>{fmtDL(tv - paidT)}</td>
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

function AgentForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", national_id: "", phone: "", whatsapp: "", governorate: "" });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم الوكيل مطلوب");
    if (!form.phone.trim()) return toast.error("الهاتف مطلوب");
    const { error } = await supabase.from("agents").insert({
      name: form.name,
      national_id: form.national_id || null,
      phone: form.phone,
      whatsapp: form.whatsapp || null,
      governorate: form.governorate || null,
    });
    if (error) return toast.error(error.message);
    onDone();
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">➕ إضافة وكيل</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم الوكيل</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div>
        <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        <div className="form-group"><label>المحافظة</label>
          <select value={form.governorate} onChange={(e) => set("governorate", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>
      <div className="form-footer"><button className="btn btn-gold" onClick={save}>💾 حفظ الوكيل</button></div>
    </div>
  );
}

function TxnForm({ agents, merchants, txns, onDone }: { agents: Agent[]; merchants: Merchant[]; txns: Transaction[]; onDone: () => void }) {
  const [form, setForm] = useState({
    agent_id: "", date: new Date().toISOString().slice(0, 10),
    destination: "", count: "", price: "", service_type: "",
    instapay_amount: "", cash_amount: "", merchant_cash_amount: "", merchant_cash_physical_amount: "",
    merchant_id: "",
    service_id: "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const DESTINATIONS = withSelected(useDropdownOptions("destination"), form.destination);
  const SERVICE_TYPES = withSelected(useDropdownOptions("service_type"), form.service_type);

  // Outstanding services for selected agent + (optional) service type
  const dueServices = useMemo(() => {
    if (!form.agent_id) return [] as Transaction[];
    return txns.filter((t) => {
      if (t.agent_id !== form.agent_id) return false;
      if (!t.source_service_id) return false;
      if (form.service_type && (t.service_type || "") !== form.service_type) return false;
      const tv = Number(t.count || 0) * Number(t.price || 0);
      const paid = Number(t.total_paid || 0);
      return tv - paid > 0;
    });
  }, [txns, form.agent_id, form.service_type]);

  // Reset/auto-fill when service selection changes
  useEffect(() => {
    if (!form.service_id) return;
    const svc = dueServices.find((s) => s.id === form.service_id);
    if (!svc) {
      setForm((p) => ({ ...p, service_id: "" }));
      return;
    }
    setForm((p) => ({
      ...p,
      destination: svc.destination || "",
      count: String(svc.count || 0),
      price: String(svc.price || 0),
      service_type: svc.service_type || p.service_type,
    }));
  }, [form.service_id]);

  // If agent or service_type changes and selected service no longer eligible, clear it
  useEffect(() => {
    if (form.service_id && !dueServices.find((s) => s.id === form.service_id)) {
      setForm((p) => ({ ...p, service_id: "" }));
    }
  }, [dueServices, form.service_id]);

  const selectedService = form.service_id ? dueServices.find((s) => s.id === form.service_id) || null : null;
  const lockFields = !!selectedService;

  const tv = Number(form.count || 0) * Number(form.price || 0);
  const travelStatement = selectedService?.travel_statement || buildTravelStatement(form.destination, form.date, null);
  const activeMerchants = merchants.filter((m) => (m.status || "نشط") === "نشط");
  const eligibleMerchants = activeMerchants.filter(
    (m) => m.supports_instapay || m.supports_cash_wallet || m.supports_physical_cash,
  );
  const selectedMerchant = activeMerchants.find((m) => m.id === form.merchant_id) || null;
  const merchantHasMethods = !!selectedMerchant && (selectedMerchant.supports_instapay || selectedMerchant.supports_cash_wallet || selectedMerchant.supports_physical_cash);
  // System (company-owned) methods: only when no merchant is selected
  const showSystemInsta = !selectedMerchant;
  const showSystemCash = !selectedMerchant;
  // Merchant methods: only when merchant is selected and supports them
  const showMerchantInsta = !!selectedMerchant && selectedMerchant.supports_instapay;
  const showMerchantCash = !!selectedMerchant && selectedMerchant.supports_cash_wallet;
  const showMerchantPhysical = !!selectedMerchant && selectedMerchant.supports_physical_cash;

  // If merchant disappears or is no longer eligible, clear it
  useEffect(() => {
    if (form.merchant_id && !activeMerchants.find((m) => m.id === form.merchant_id)) {
      setForm((p) => ({ ...p, merchant_id: "" }));
    }
  }, [activeMerchants.map((m) => m.id).join(",")]);

  // Clear payment fields whose method is not currently visible
  useEffect(() => {
    setForm((p) => {
      const next = { ...p };
      if (!showSystemInsta && !showMerchantInsta && next.instapay_amount) next.instapay_amount = "";
      if (!showSystemCash && next.cash_amount) next.cash_amount = "";
      if (!showMerchantCash && next.merchant_cash_amount) next.merchant_cash_amount = "";
      if (!showMerchantPhysical && next.merchant_cash_physical_amount) next.merchant_cash_physical_amount = "";
      return next;
    });
  }, [showSystemInsta, showSystemCash, showMerchantInsta, showMerchantCash, showMerchantPhysical]);

  const insta = (showSystemInsta || showMerchantInsta) ? Math.round(Number(form.instapay_amount || 0)) : 0;
  const cash = showSystemCash ? Math.round(Number(form.cash_amount || 0)) : 0;
  const merchant = showMerchantCash ? Math.round(Number(form.merchant_cash_amount || 0)) : 0;
  const merchantNet = merchantCashNetAmount(merchant);
  const merchantPhysical = showMerchantPhysical ? Math.round(Number(form.merchant_cash_physical_amount || 0)) : 0;
  const newPayment = insta + cash + merchantNet + merchantPhysical;
  const usesMerchant = !!selectedMerchant;
  const save = async () => {
    if (!form.agent_id || !form.destination) return toast.error("برجاء اختيار قيمة من القائمة");
    if (selectedMerchant && !merchantHasMethods) return toast.error("لا توجد وسائل دفع مفعلة لهذا التاجر");
    if (newPayment <= 0) return toast.error("يجب إدخال قيمة في حقل دفع واحد على الأقل");

    if (selectedService) {
      // UPDATE existing service-linked transaction with the new payment values
      const prevInsta = Number(selectedService.instapay_amount || 0);
      const prevCash = Number(selectedService.cash_amount || 0);
      const prevMerchant = Number(selectedService.merchant_cash_amount || 0);
      const prevMerchantPhysical = Number(selectedService.merchant_cash_physical_amount || 0);
      const newInsta = prevInsta + insta;
      const newCash = prevCash + cash;
      const newMerchant = prevMerchant + merchant;
      const newMerchantNet = merchantCashNetAmount(newMerchant);
      const newMerchantPhysical = prevMerchantPhysical + merchantPhysical;
      const newTotalPaid = Number(selectedService.total_paid || 0) + newPayment;
      const { error } = await supabase
        .from("transactions")
        .update({
          instapay_amount: newInsta,
          cash_amount: newCash,
          merchant_cash_amount: newMerchant,
          merchant_cash_net_amount: newMerchantNet,
          merchant_cash_physical_amount: newMerchantPhysical,
          merchant_id: usesMerchant ? form.merchant_id : (selectedService.merchant_id || null),
          total_paid: newTotalPaid,
          paid: newTotalPaid,
        })
        .eq("id", selectedService.id);
      if (error) return toast.error(error.message);
      onDone();
      return;
    }

    const { error } = await supabase.from("transactions").insert({
      agent_id: form.agent_id, date: form.date,
      destination: form.destination || null,
      travel_statement: travelStatement || null,
      service_type: form.service_type || null,
      count: Number(form.count || 0), price: Number(form.price || 0),
      instapay_amount: insta,
      cash_amount: cash,
      merchant_cash_amount: merchant,
      merchant_cash_net_amount: merchantNet,
      merchant_cash_physical_amount: merchantPhysical,
      merchant_id: usesMerchant ? form.merchant_id : null,
      total_paid: newPayment,
      paid: newPayment,
    });
    if (error) return toast.error(error.message);
    onDone();
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💳 إضافة حركة مالية</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الوكيل</label>
          <select value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
          <select value={form.service_id} onChange={(e) => set("service_id", e.target.value)} disabled={!form.agent_id || dueServices.length === 0}>
            <option value="">— بدون / حركة جديدة —</option>
            {dueServices.map((s) => {
              const tvVal = Number(s.count || 0) * Number(s.price || 0);
              const remain = tvVal - Number(s.total_paid || 0);
              return (
                <option key={s.id} value={s.id}>
                  {(s.destination || "—")} • {s.date} • متبقي {fmtNum(remain)}
                </option>
              );
            })}
          </select>
        </div>
        <div className="form-group"><label>وجهة السفر</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)} disabled={lockFields}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>العدد</label><input type="number" min={1} placeholder="0" value={form.count} onChange={(e) => set("count", e.target.value)} disabled={lockFields} /></div>
        <div className="form-group"><label>السعر</label><input type="number" placeholder="0" value={form.price} onChange={(e) => set("price", e.target.value)} disabled={lockFields} /></div>
        <div className="form-group"><label>قيمة الرحلة</label><input value={fmtNum(tv)} disabled /></div>
        <div className="form-group full">
          <label style={{ fontWeight: 700, marginBottom: 8 }}>طريقة الدفع</label>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>التاجر <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted-foreground, #6b7280)" }}>(اتركه فارغاً للدفع من خزينة الشركة)</span></label>
            {eligibleMerchants.length > 0 ? (
              <select value={form.merchant_id} onChange={(e) => set("merchant_id", e.target.value)}>
                <option value="">— بدون تاجر (دفع من الشركة) —</option>
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
            {(showSystemInsta || showMerchantInsta) && (
              <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>انستا{selectedMerchant ? ` — ${selectedMerchant.merchant_name}` : ""}</div>
                <input type="number" placeholder="0" value={form.instapay_amount} onChange={(e) => set("instapay_amount", e.target.value)} />
              </div>
            )}
            {showSystemCash && (
              <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>نقدي</div>
                <input type="number" placeholder="0" value={form.cash_amount} onChange={(e) => set("cash_amount", e.target.value)} />
              </div>
            )}
            {showMerchantCash && (
              <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>كاش التاجر{selectedMerchant ? ` — ${selectedMerchant.merchant_name}` : ""}</div>
                <input type="number" placeholder="0" value={form.merchant_cash_amount} onChange={(e) => set("merchant_cash_amount", e.target.value)} />
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted-foreground, #6b7280)" }}>
                  صافي كاش التاجر بعد خصم 1%: <strong>{fmtNum(merchantNet)}</strong>
                </div>
              </div>
            )}
            {showMerchantPhysical && (
              <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>نقدي تاجر{selectedMerchant ? ` — ${selectedMerchant.merchant_name}` : ""}</div>
                <input type="number" placeholder="0" value={form.merchant_cash_physical_amount} onChange={(e) => set("merchant_cash_physical_amount", e.target.value)} />
              </div>
            )}
          </div>
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, background: "var(--muted, #f3f4f6)", fontWeight: 700, textAlign: "left" }}>
            إجمالي المدفوع: {fmtNum(newPayment)} ج.م
          </div>
        </div>
        <div className="form-group full"><label>بيان السفر (تلقائي)</label><input value={travelStatement} disabled readOnly /></div>
      </div>
      <div className="form-footer"><button className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button></div>
    </div>
  );
}
