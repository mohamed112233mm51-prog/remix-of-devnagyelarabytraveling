import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  badgeFor, fmtDL, fmtNum, tripValue, txnTotalPaid, merchantCashGross, merchantCashNet, merchantCashPhysical, merchantCashNetAmount, useLive, GOVERNORATES,
  type Agent, type Approval, type Flight, type Transaction, type Merchant,
} from "@/lib/db";
import { useRegisterStatementCapture } from "@/lib/statementCapture";


export const Route = createFileRoute("/agent-statement/$agentId")({
  component: AgentDetail,
  validateSearch: (s: Record<string, unknown>) => ({
    from: typeof s.from === "string" ? s.from : "",
    to: typeof s.to === "string" ? s.to : "",
  }),
});

// ---------- Ledger types ----------
type LedgerKind = "service" | "payment";
type LedgerEntry = {
  id: string;
  date: string;
  kind: LedgerKind;
  description: string;
  destination: string;
  service: string;
  count: number;
  price: number;
  serviceValue: number;
  payment: number;
  debit: number;
  credit: number;
  paymentMethod: string;
  note: string;
  raw: Transaction;
};

function classifyTxn(t: Transaction): LedgerKind {
  const sv = Number(t.count || 0) * Number(t.price || 0);
  if (sv > 0) return "service";
  return "payment";
}

function paymentMethodLabel(t: Transaction): string {
  const insta = Number(t.instapay_amount || 0);
  const cash = Number(t.cash_amount || 0);
  const mGross = merchantCashGross(t);
  const mPhys = merchantCashPhysical(t);
  const parts: string[] = [];
  if (insta > 0) parts.push("إنستاباي");
  if (cash > 0) parts.push("نقدي");
  if (mGross > 0) parts.push("تاجر محفظة");
  if (mPhys > 0) parts.push("تاجر نقدي");
  if (parts.length) return parts.join(" + ");
  return t.payment_method || "—";
}

function buildLedger(txns: Transaction[]): LedgerEntry[] {
  const sorted = [...txns].sort((a, b) => {
    const d = (a.date || "").localeCompare(b.date || "");
    if (d !== 0) return d;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });
  return sorted.map((t) => {
    const kind = classifyTxn(t);
    const sv = tripValue(t);
    const paid = txnTotalPaid(t);
    const isPayment = kind === "payment";
    return {
      id: t.id,
      date: t.date,
      kind,
      description: isPayment ? "دفعة من الوكيل" : (t.service_type || t.travel_statement || "خدمة منفذة"),
      destination: t.destination || "—",
      service: t.service_type || "—",
      count: Number(t.count || 0),
      price: Number(t.price || 0),
      serviceValue: sv,
      payment: paid,
      debit: sv,
      credit: paid,
      paymentMethod: paid > 0 ? paymentMethodLabel(t) : "—",
      note: t.note || "—",
      raw: t,
    };
  });
}

function AgentDetail() {
  const { agentId: id } = Route.useParams();
  const { rows: agents, loading: agentsLoading } = useLive<Agent>("agents");
  const { rows: flights } = useLive<Flight>("flights");
  const { rows: approvals } = useLive<Approval>("approvals");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const merchantName = (mid: string | null) => mid ? (merchants.find((m) => m.id === mid)?.merchant_name || "") : "";
  const { from, to } = Route.useSearch();

  const inRange = (d?: string | null) => {
    if (!d) return !from && !to;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  const agent = agents.find((a) => a.id === id);

  // ---------- Local filters ----------
  const [filters, setFilters] = useState({
    from: from || "",
    to: to || "",
    kind: "" as "" | LedgerKind,
    service: "",
    method: "",
    query: "",
  });
  const setF = (k: string, v: string) => setFilters((p) => ({ ...p, [k]: v }));

  const myFlights = useMemo(() => flights.filter((f) => f.agent_id === id && inRange(f.travel_date)), [flights, id, from, to]);
  const myApprovals = useMemo(() => approvals.filter((a) => a.agent_id === id && inRange(a.submit_date)), [approvals, id, from, to]);

  const myTxnsAll = useMemo(() => txns.filter((t) => t.agent_id === id), [txns, id]);

  const myTxns = useMemo(() => {
    return myTxnsAll.filter((t) => {
      if (filters.from && (t.date || "") < filters.from) return false;
      if (filters.to && (t.date || "") > filters.to) return false;
      if (filters.service && (t.service_type || "") !== filters.service) return false;
      if (filters.kind) {
        if (classifyTxn(t) !== filters.kind) return false;
      }
      if (filters.method) {
        const label = paymentMethodLabel(t);
        if (!label.includes(filters.method)) return false;
      }
      if (filters.query) {
        const q = filters.query.toLowerCase();
        const hay = `${t.destination || ""} ${t.service_type || ""} ${t.travel_statement || ""} ${t.note || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [myTxnsAll, filters]);

  const ledger = useMemo(() => buildLedger(myTxns), [myTxns]);

  // Running balance — cumulative oldest → newest
  const ledgerWithBalance = useMemo(() => {
    let bal = 0;
    return ledger.map((e) => {
      bal += e.debit - e.credit;
      return { ...e, balance: bal };
    });
  }, [ledger]);

  // Show newest first in display, but keep balance correct
  const displayRows = useMemo(() => [...ledgerWithBalance].reverse(), [ledgerWithBalance]);

  const totalServices = ledger.reduce((s, e) => s + e.debit, 0);
  const totalPayments = ledger.reduce((s, e) => s + e.credit, 0);
  const net = totalServices - totalPayments;
  const accountStatus = net > 0 ? "مدين عليه" : net < 0 ? "دائن له" : "متوازن";
  const statusClass = net > 0 ? "red" : net < 0 ? "green" : "gold";

  const serviceOptions = useMemo(() => Array.from(new Set(myTxnsAll.map((t) => t.service_type || "").filter(Boolean))).sort(), [myTxnsAll]);
  const methodOptions = ["نقدي", "إنستاباي", "تاجر محفظة", "تاجر نقدي"];

  useRegisterStatementCapture(
    () => ({
      data: {
        title: "كشف حساب الوكيل",
        subtitle: `${agent?.name || ""}${filters.from || filters.to ? ` — من ${filters.from || "..."} إلى ${filters.to || "..."}` : ""}`,
        fileName: `كشف-حساب-${agent?.name || "الوكيل"}`,
        summary: [
          { label: "إجمالي قيمة الخدمات", value: fmtDL(totalServices) },
          { label: "إجمالي المدفوعات", value: fmtDL(totalPayments) },
          { label: "الصافي", value: fmtDL(Math.abs(net)) },
          { label: "حالة الحساب", value: accountStatus },
        ],
        columns: [
          { header: "#", key: "n" },
          { header: "التاريخ", key: "date" },
          { header: "البيان", key: "description" },
          { header: "الخدمة/الوجهة", key: "dest" },
          { header: "العدد", key: "count" },
          { header: "السعر", key: "price" },
          { header: "قيمة الخدمة", key: "sv" },
          { header: "مدين", key: "debit" },
          { header: "دائن", key: "credit" },
          { header: "الرصيد", key: "balance" },
          { header: "طريقة الدفع", key: "method" },
          { header: "ملاحظات", key: "note" },
        ],
        rows: displayRows.map((e, i) => ({
          n: i + 1,
          date: e.date,
          description: e.description,
          dest: `${e.service} / ${e.destination}`,
          count: e.count,
          count__excel: e.count,
          price: fmtNum(e.price),
          price__excel: e.price,
          sv: fmtDL(e.serviceValue),
          sv__excel: e.serviceValue,
          debit: e.debit > 0 ? fmtDL(e.debit) : "—",
          debit__excel: e.debit,
          credit: e.credit > 0 ? fmtDL(e.credit) : "—",
          credit__excel: e.credit,
          balance: fmtDL(e.balance),
          balance__excel: e.balance,
          method: e.paymentMethod,
          note: e.note,
        })),
      },
      whatsapp: agent?.whatsapp || null,
      contextId: agent?.id || null,
    }),
    [agent, displayRows, totalServices, totalPayments, net, accountStatus, filters],
  );

  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"statement" | "services">("statement");

  useEffect(() => {
    if (!agentsLoading && !agent) {
      toast.error("تعذر فتح ملف الوكيل");
      router.history.back();
    }
  }, [agentsLoading, agent, router]);

  if (agentsLoading || !agent) {
    return null;
  }

  const printStatement = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div className="section active">
      <div className="card no-print-actions">
        <div className="card-header">
          <div className="card-title">📂 ملف الوكيل: {agent.name}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="action-btn" onClick={() => setEditOpen(true)}>✏️ تعديل بيانات الوكيل</button>
            <Link to="/accounts" className="action-btn">⬅ رجوع</Link>
          </div>
        </div>
        <div className="card-body" style={{ padding: 20 }}>
          <div className="two-col">
            <div>
              <div className="stat-row"><span className="stat-key">الاسم</span><span className="stat-val">{agent.name}</span></div>
              <div className="stat-row"><span className="stat-key">الرقم القومي</span><span className="stat-val">{agent.national_id || "—"}</span></div>
              <div className="stat-row"><span className="stat-key">الهاتف</span><span className="stat-val">{agent.phone || "—"}</span></div>
            </div>
            <div>
              <div className="stat-row"><span className="stat-key">الواتساب</span><span className="stat-val">{agent.whatsapp || "—"}</span></div>
              <div className="stat-row"><span className="stat-key">المحافظة</span><span className="stat-val">{agent.governorate || "—"}</span></div>
              <div className="stat-row"><span className="stat-key">الحالة</span><span className="stat-val"><span className={`badge ${badgeFor(agent.status)}`}>{agent.status}</span></span></div>
              <div className="stat-row"><span className="stat-key">عدد المسافرين</span><span className="stat-val">{fmtNum(myFlights.length)}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="account-summary">
        <div className="sum-box gold"><div className="label">إجمالي قيمة الخدمات</div><div className="val">{fmtDL(totalServices)}</div></div>
        <div className="sum-box green"><div className="label">إجمالي المدفوعات</div><div className="val">{fmtDL(totalPayments)}</div></div>
        <div className={`sum-box ${statusClass}`}><div className="label">الصافي ({accountStatus})</div><div className="val">{fmtDL(Math.abs(net))}</div></div>
        <div className="sum-box"><div className="label">عدد الحركات</div><div className="val">{fmtNum(ledger.length)}</div></div>
      </div>

      <div className="card no-print-actions">
        <div className="card-body" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 12, justifyContent: "flex-start" }}>
          {([
            { k: "statement", label: "💳 كشف الحساب" },
            { k: "services", label: "✈️ الرحلات والتقديمات" },
          ] as const).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setActiveTab(t.k)}
              style={{
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 700,
                borderRadius: 10,
                border: "1px solid var(--border)",
                cursor: "pointer",
                background: activeTab === t.k ? "var(--primary)" : "var(--card)",
                color: activeTab === t.k ? "#fff" : "var(--text)",
                minWidth: 140,
                flex: "1 1 auto",
                transition: "all .15s ease",
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {activeTab === "statement" && (
      <>
      <div className="card no-print-actions">
        <div className="card-header">
          <div className="card-title">🔎 فلاتر كشف الحساب</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-gold" onClick={() => setPayOpen(true)}>➕ إضافة دفعة من الوكيل</button>
            <button type="button" className="action-btn" onClick={printStatement}>🖨️ طباعة كشف الحساب</button>
          </div>
        </div>
        <div className="form-grid" style={{ padding: 12 }}>
          <div className="form-group"><label>من تاريخ</label><input type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} /></div>
          <div className="form-group"><label>إلى تاريخ</label><input type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} /></div>
          <div className="form-group"><label>نوع الحركة</label>
            <select value={filters.kind} onChange={(e) => setF("kind", e.target.value)}>
              <option value="">الكل</option>
              <option value="service">خدمات</option>
              <option value="payment">مدفوعات</option>
            </select>
          </div>
          <div className="form-group"><label>الخدمة</label>
            <select value={filters.service} onChange={(e) => setF("service", e.target.value)}>
              <option value="">الكل</option>
              {serviceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group"><label>طريقة الدفع</label>
            <select value={filters.method} onChange={(e) => setF("method", e.target.value)}>
              <option value="">الكل</option>
              {methodOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-group"><label>بحث</label><input type="search" placeholder="وجهة / خدمة / ملاحظات" value={filters.query} onChange={(e) => setF("query", e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">💳 كشف الحساب (Ledger)</div></div>
        <div className="card-body">
          <div className="table-wrap">
            <table className="mobile-cards">
              <thead><tr>
                <th>#</th><th>التاريخ</th><th>البيان</th><th>الخدمة / الوجهة</th>
                <th>العدد</th><th>السعر</th><th>قيمة الخدمة</th>
                <th>مدين عليه</th><th>دائن له</th><th>الرصيد الجاري</th>
                <th>طريقة الدفع</th><th>ملاحظات</th>
              </tr></thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr><td colSpan={12}><div className="empty"><div className="empty-icon">💳</div><div className="empty-text">لا توجد حركات مطابقة</div></div></td></tr>
                ) : displayRows.map((e, i) => (
                  <tr key={e.id} style={{ background: e.kind === "payment" ? "rgba(22,163,74,0.04)" : undefined }}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="التاريخ">{e.date}</td>
                    <td data-label="البيان" className="bold">{e.description}</td>
                    <td data-label="الخدمة/الوجهة">{e.service} / {e.destination}</td>
                    <td data-label="العدد">{e.count || "—"}</td>
                    <td data-label="السعر">{e.price ? fmtNum(e.price) : "—"}</td>
                    <td data-label="قيمة الخدمة">{e.serviceValue ? fmtDL(e.serviceValue) : "—"}</td>
                    <td data-label="مدين عليه" style={{ color: "var(--red)", fontWeight: 700 }}>{e.debit ? fmtDL(e.debit) : "—"}</td>
                    <td data-label="دائن له" style={{ color: "var(--green)", fontWeight: 700 }}>{e.credit ? fmtDL(e.credit) : "—"}</td>
                    <td data-label="الرصيد الجاري" style={{ fontWeight: 800, color: e.balance > 0 ? "var(--red)" : e.balance < 0 ? "var(--green)" : undefined }}>{fmtDL(e.balance)}</td>
                    <td data-label="طريقة الدفع">{e.paymentMethod}{e.raw.merchant_id && merchantName(e.raw.merchant_id) ? ` — ${merchantName(e.raw.merchant_id)}` : ""}</td>
                    <td data-label="ملاحظات">{e.note}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>الإجمالي</td>
                  <td>{fmtDL(totalServices)}</td>
                  <td>{fmtDL(totalPayments)}</td>
                  <td colSpan={3} style={{ fontWeight: 800 }}>{fmtDL(Math.abs(net))} — {accountStatus}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
      </>
      )}

      {activeTab === "services" && (
      <div className="two-col">
        <div className="card">
          <div className="card-header"><div className="card-title">✈️ رحلات الوكيل ({myFlights.length})</div></div>
          <div className="card-body">
            <div className="table-wrap">
              <table className="mobile-cards">
                <thead><tr><th>#</th><th>المسافر</th><th>الوجهة</th><th>التاريخ</th><th>الحالة</th></tr></thead>
                <tbody>
                  {myFlights.length === 0 ? (
                    <tr><td colSpan={5}><div className="empty"><div className="empty-text">لا توجد رحلات</div></div></td></tr>
                  ) : myFlights.map((f, i) => (
                    <tr key={f.id}>
                      <td data-label="#">{i + 1}</td>
                      <td className="bold" data-label="المسافر">{f.passenger_name}</td>
                      <td data-label="الوجهة">{f.destination || "—"}</td>
                      <td data-label="التاريخ">{f.travel_date || "—"}</td>
                      <td data-label="الحالة"><span className={`badge ${badgeFor(f.status)}`}>{f.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title">📋 تقديمات الوكيل ({myApprovals.length})</div></div>
          <div className="card-body">
            <div className="table-wrap">
              <table className="mobile-cards">
                <thead><tr><th>#</th><th>المسافر</th><th>الوجهة</th><th>الشركة الصادرة</th><th>الحالة</th></tr></thead>
                <tbody>
                  {myApprovals.length === 0 ? (
                    <tr><td colSpan={5}><div className="empty"><div className="empty-text">لا توجد تقديمات</div></div></td></tr>
                  ) : myApprovals.map((a, i) => (
                    <tr key={a.id}>
                      <td data-label="#">{i + 1}</td>
                      <td className="bold" data-label="المسافر">{a.passenger_name}</td>
                      <td data-label="الوجهة">{a.destination || "—"}</td>
                      <td data-label="الشركة الصادرة">{a.issuing_company || "—"}</td>
                      <td data-label="الحالة"><span className={`badge ${badgeFor(a.status)}`}>{a.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      )}

      {editOpen && <EditAgentModal agent={agent} onClose={() => setEditOpen(false)} />}
      {payOpen && <AddPaymentModal agent={agent} merchants={merchants} onClose={() => setPayOpen(false)} />}
    </div>
  );
}

// ---------- Add payment modal ----------
function AddPaymentModal({ agent, merchants, onClose }: { agent: Agent; merchants: Merchant[]; onClose: () => void }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    method: "نقدي" as "نقدي" | "إنستاباي" | "تاجر محفظة" | "تاجر نقدي",
    amount: "",
    merchant_id: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const needsMerchant = form.method === "تاجر محفظة" || form.method === "تاجر نقدي";
  const activeMerchants = merchants.filter((m) => (m.status || "نشط") === "نشط");

  const save = async () => {
    const amt = Math.round(Number(form.amount || 0));
    if (!amt || amt <= 0) return toast.error("أدخل قيمة الدفعة");
    if (needsMerchant && !form.merchant_id) return toast.error("اختر التاجر");
    setSaving(true);
    const buckets = {
      instapay_amount: 0, cash_amount: 0,
      merchant_cash_amount: 0, merchant_cash_net_amount: 0, merchant_cash_physical_amount: 0,
    };
    if (form.method === "إنستاباي") buckets.instapay_amount = amt;
    else if (form.method === "نقدي") buckets.cash_amount = amt;
    else if (form.method === "تاجر محفظة") { buckets.merchant_cash_amount = amt; buckets.merchant_cash_net_amount = merchantCashNetAmount(amt); }
    else if (form.method === "تاجر نقدي") buckets.merchant_cash_physical_amount = amt;
    const totalPaid = buckets.instapay_amount + buckets.cash_amount + buckets.merchant_cash_net_amount + buckets.merchant_cash_physical_amount;
    const payload = {
      agent_id: agent.id,
      date: form.date,
      destination: null,
      travel_statement: null,
      service_type: "دفعة من الوكيل",
      count: 0,
      price: 0,
      payment_method: form.method,
      ...buckets,
      merchant_id: needsMerchant ? form.merchant_id : null,
      total_paid: totalPaid,
      paid: totalPaid,
      note: form.note.trim() || null,
      source_service_type: "payment",
    };
    const { error } = await supabase.from("transactions").insert(payload);
    if (!error) {
      // Audit log (best-effort)
      try {
        const { data: u } = await supabase.auth.getUser();
        await supabase.from("activity_logs").insert({
          user_id: u.user?.id ?? null,
          user_email: u.user?.email ?? null,
          action: "agent_payment_added",
          entity: "transactions",
          details: { agent_id: agent.id, amount: amt, method: form.method, date: form.date },
        });
      } catch { /* ignore audit failures */ }
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل الدفعة");
    onClose();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 640, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">➕ إضافة دفعة من الوكيل: {agent.name}</div></div>
        <div className="form-grid">
          <div className="form-group"><label>التاريخ</label><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div className="form-group"><label>طريقة الدفع</label>
            <select value={form.method} onChange={(e) => set("method", e.target.value)}>
              <option value="نقدي">نقدي</option>
              <option value="إنستاباي">إنستاباي</option>
              <option value="تاجر محفظة">تاجر محفظة</option>
              <option value="تاجر نقدي">تاجر نقدي</option>
            </select>
          </div>
          <div className="form-group"><label>المبلغ</label><input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          {needsMerchant && (
            <div className="form-group"><label>التاجر</label>
              <select value={form.merchant_id} onChange={(e) => set("merchant_id", e.target.value)}>
                <option value="">— اختر —</option>
                {activeMerchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>ملاحظات</label><input value={form.note} onChange={(e) => set("note", e.target.value)} /></div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الدفعة</button>
        </div>
      </div>
    </div>,
    document.body,
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
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم الوكيل مطلوب");
    if (!form.phone.trim()) return toast.error("الهاتف مطلوب");
    setSaving(true);
    const { error } = await supabase.from("agents").update({
      name: form.name.trim(),
      national_id: form.national_id.trim() || null,
      phone: form.phone.trim(),
      whatsapp: form.whatsapp.trim() || null,
      governorate: form.governorate || null,
    }).eq("id", agent.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث بيانات الوكيل بنجاح");
    onClose();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">✏️ تعديل بيانات الوكيل</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم الوكيل</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div className="form-group"><label>المحافظة</label>
            <select value={form.governorate} onChange={(e) => set("governorate", e.target.value)}>
              <option value="">— غير محدد —</option>
              {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
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
