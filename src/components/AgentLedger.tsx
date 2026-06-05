import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ExportButton } from "@/components/ExportButton";
import {
  badgeFor, fmtDL, fmtNum, tripValue, txnTotalPaid, merchantCashGross, merchantCashPhysical,
  useLive, GOVERNORATES,
  type Agent, type Transaction, type Merchant,
} from "@/lib/db";
import { AgentPaymentForm } from "@/components/AgentPaymentForm";


import { useRegisterStatementCapture } from "@/lib/statementCapture";

type LedgerKind = "service" | "payment";
type LedgerEntry = {
  id: string; date: string; kind: LedgerKind; description: string; destination: string; service: string;
  count: number; price: number; serviceValue: number; payment: number; debit: number; credit: number;
  paymentMethod: string; note: string; raw: Transaction;
};

type AgentLedgerProps = {
  lockedAgentId?: string;
  initialAgentId?: string;
  showAgentProfile?: boolean;
  canExport?: boolean;
};

function classifyTxn(t: Transaction): LedgerKind {
  if ((t as any).source_service_type === "payment") return "payment";
  return Number(t.count || 0) * Number(t.price || 0) > 0 ? "service" : "payment";
}


function paymentMethodLabel(t: Transaction): string {
  const parts: string[] = [];
  if (Number(t.instapay_amount || 0) > 0) parts.push("إنستاباي");
  if (Number(t.cash_amount || 0) > 0) parts.push("نقدي");
  if (merchantCashGross(t) > 0) parts.push("تاجر محفظة");
  if (merchantCashPhysical(t) > 0) parts.push("تاجر نقدي");
  return parts.length ? parts.join(" + ") : (t.payment_method || "—");
}

function buildLedger(txns: Transaction[]): LedgerEntry[] {
  return [...txns]
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.created_at || "").localeCompare(b.created_at || ""))
    .map((t) => {
      const kind = classifyTxn(t);
      const serviceValue = tripValue(t);
      const payment = txnTotalPaid(t);
      const isPayment = kind === "payment";
      const credit = isPayment ? (payment || serviceValue) : payment;
      const merchantGross = Number(t.merchant_cash_amount || 0);
      const merchantNet = merchantCashGross(t) > 0
        ? Math.round(Number(t.merchant_cash_net_amount || 0) || (merchantGross - merchantGross * 0.01))
        : 0;
      const merchantCommission = merchantGross - merchantNet;
      let description = isPayment ? "دفعة من الوكيل" : (t.service_type || t.travel_statement || "خدمة منفذة");
      if (isPayment && merchantGross > 0) {
        description += ` — فودافون كاش: المستلم ${fmtDL(merchantGross)} − عمولة ${fmtDL(merchantCommission)} = صافي ${fmtDL(merchantNet)}`;
      }
      return {
        id: t.id,
        date: t.date,
        kind,
        description,
        destination: t.destination || "—",
        service: t.service_type || "—",
        count: Number(t.count || 0),
        price: Number(t.price || 0),
        serviceValue,
        payment: credit,
        debit: isPayment ? 0 : serviceValue,
        credit,
        paymentMethod: credit > 0 ? paymentMethodLabel(t) : "—",
        note: t.note || "—",
        raw: t,
      };
    });
}


export function AgentLedger({ lockedAgentId, initialAgentId = "", showAgentProfile = false, canExport = true }: AgentLedgerProps) {
  const router = useRouter();
  const { rows: agents, loading: agentsLoading } = useLive<Agent>("agents");
  const flights: any[] = [];
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const [selectedAgentId, setSelectedAgentId] = useState(lockedAgentId || initialAgentId || "");
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);


  const [filters, setFilters] = useState({ from: "", to: "", kind: "" as "" | LedgerKind, service: "", method: "", query: "" });


  useEffect(() => { if (lockedAgentId) setSelectedAgentId(lockedAgentId); }, [lockedAgentId]);
  useEffect(() => { if (!lockedAgentId) setSelectedAgentId(initialAgentId || ""); }, [initialAgentId, lockedAgentId]);

  const agent = agents.find((a) => a.id === selectedAgentId);
  const merchantName = (mid: string | null) => mid ? (merchants.find((m) => m.id === mid)?.merchant_name || "") : "";
  const setF = (k: string, v: string) => setFilters((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("agent-statement-agent-change", {
      detail: agent ? { id: agent.id, whatsapp: agent.whatsapp || null } : null,
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("agent-statement-agent-change", { detail: null }));
    };
  }, [agent]);

  useEffect(() => {
    if (showAgentProfile && !agentsLoading && lockedAgentId && !agent) {
      toast.error("تعذر فتح ملف الوكيل");
      router.history.back();
    }
  }, [showAgentProfile, agentsLoading, lockedAgentId, agent, router]);

  const myFlights = useMemo(() => flights.filter((f) => f.agent_id === selectedAgentId), [flights, selectedAgentId]);

  const myTxnsAll = useMemo(() => txns.filter((t) => t.agent_id === selectedAgentId), [txns, selectedAgentId]);
  const myTxns = useMemo(() => myTxnsAll.filter((t) => {
    if (filters.from && (t.date || "") < filters.from) return false;
    if (filters.to && (t.date || "") > filters.to) return false;
    if (filters.service && (t.service_type || "") !== filters.service) return false;
    if (filters.kind && classifyTxn(t) !== filters.kind) return false;
    if (filters.method && !paymentMethodLabel(t).includes(filters.method)) return false;
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const hay = `${t.destination || ""} ${t.service_type || ""} ${t.travel_statement || ""} ${t.note || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [myTxnsAll, filters]);

  const ledger = useMemo(() => buildLedger(myTxns), [myTxns]);
  const ledgerWithBalance = useMemo(() => {
    let balance = 0;
    return ledger.map((e) => ({ ...e, balance: (balance += e.debit - e.credit) }));
  }, [ledger]);
  const displayRows = useMemo(() => [...ledgerWithBalance].reverse(), [ledgerWithBalance]);
  const totalServices = ledger.reduce((s, e) => s + e.debit, 0);
  const totalPayments = ledger.reduce((s, e) => s + e.credit, 0);
  const net = totalServices - totalPayments;
  const accountStatus = net > 0 ? "مدين عليه" : net < 0 ? "دائن له" : "متوازن";
  const statusClass = net > 0 ? "red" : net < 0 ? "green" : "gold";
  const serviceOptions = useMemo(() => Array.from(new Set(myTxnsAll.map((t) => t.service_type || "").filter(Boolean))).sort(), [myTxnsAll]);
  const methodOptions = ["نقدي", "إنستاباي", "تاجر محفظة", "تاجر نقدي"];

  const buildExportData = () => ({
    title: "كشف حساب الوكيل - Ledger",
    subtitle: `${agent?.name || ""}${filters.from || filters.to ? ` — من ${filters.from || "..."} إلى ${filters.to || "..."}` : ""}`,
    fileName: `كشف-حساب-Ledger-${agent?.name || "الوكيل"}`,
    summary: [
      { label: "إجمالي قيمة الخدمات", value: fmtDL(totalServices) },
      { label: "إجمالي المدفوعات", value: fmtDL(totalPayments) },
      { label: "الصافي", value: fmtDL(Math.abs(net)) },
      { label: "حالة الحساب", value: accountStatus },
    ],
    columns: [
      { header: "#", key: "n" }, { header: "التاريخ", key: "date" }, { header: "البيان", key: "description" },
      { header: "الخدمة/الوجهة", key: "dest" }, { header: "العدد", key: "count" }, { header: "السعر", key: "price" },
      { header: "قيمة الخدمة", key: "sv" }, { header: "مدين عليه", key: "debit" }, { header: "دائن له", key: "credit" },
      { header: "الرصيد الجاري", key: "balance" }, { header: "طريقة الدفع", key: "method" }, { header: "ملاحظات", key: "note" },
    ],
    rows: displayRows.map((e, i) => ({
      n: i + 1, date: e.date, description: e.description, dest: `${e.service} / ${e.destination}`,
      count: e.count, count__excel: e.count, price: fmtNum(e.price), price__excel: e.price,
      sv: fmtDL(e.serviceValue), sv__excel: e.serviceValue, debit: e.debit > 0 ? fmtDL(e.debit) : "—", debit__excel: e.debit,
      credit: e.credit > 0 ? fmtDL(e.credit) : "—", credit__excel: e.credit, balance: fmtDL(e.balance), balance__excel: e.balance,
      method: e.paymentMethod, note: e.note,
    })),
  });

  useRegisterStatementCapture(
    () => ({ data: buildExportData(), whatsapp: agent?.whatsapp || null, contextId: agent?.id || null }),
    [agent, displayRows, totalServices, totalPayments, net, accountStatus, filters],
  );

  if (agentsLoading && showAgentProfile) return null;
  const printStatement = () => { if (typeof window !== "undefined") window.print(); };

  return (
    <div className="section active">
      {showAgentProfile && agent && (
        <div className="card no-print-actions">
          <div className="card-header"><div className="card-title">ملف الوكيل: {agent.name}</div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="action-btn" onClick={() => setEditOpen(true)}>تعديل بيانات الوكيل</button><Link to="/accounts" className="action-btn">رجوع</Link></div></div>
          <div className="card-body" style={{ padding: 20 }}><div className="two-col"><div><div className="stat-row"><span className="stat-key">الاسم</span><span className="stat-val">{agent.name}</span></div><div className="stat-row"><span className="stat-key">الرقم القومي</span><span className="stat-val">{agent.national_id || "—"}</span></div><div className="stat-row"><span className="stat-key">الهاتف</span><span className="stat-val">{agent.phone || "—"}</span></div></div><div><div className="stat-row"><span className="stat-key">الواتساب</span><span className="stat-val">{agent.whatsapp || "—"}</span></div><div className="stat-row"><span className="stat-key">المحافظة</span><span className="stat-val">{agent.governorate || "—"}</span></div><div className="stat-row"><span className="stat-key">الحالة</span><span className="stat-val"><span className={`badge ${badgeFor(agent.status)}`}>{agent.status}</span></span></div><div className="stat-row"><span className="stat-key">عدد المسافرين</span><span className="stat-val">{fmtNum(myFlights.length)}</span></div></div></div></div>
        </div>
      )}

      {!lockedAgentId && (
        <div className="card no-print-actions" style={{ marginBottom: 12 }}>
          <div className="form-grid" style={{ padding: 12 }}><div className="form-group"><label>الوكيل</label><select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}><option value="">— اختر وكيلاً —</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div></div>
        </div>
      )}

      {!agent ? (
        <div className="card"><div className="card-body"><div className="empty"><div className="empty-text">اختر وكيلاً أولاً لعرض كشف الحساب</div></div></div></div>
      ) : (
        <>
          <div className="account-summary">
            <div className="sum-box gold"><div className="label">إجمالي قيمة الخدمات</div><div className="val">{fmtDL(totalServices)}</div></div>
            <div className="sum-box green"><div className="label">إجمالي المدفوعات</div><div className="val">{fmtDL(totalPayments)}</div></div>
            <div className={`sum-box ${statusClass}`}><div className="label">الصافي ({accountStatus})</div><div className="val">{fmtDL(Math.abs(net))}</div></div>
            <div className="sum-box"><div className="label">عدد الحركات</div><div className="val">{fmtNum(ledger.length)}</div></div>
          </div>

          <div className="card no-print-actions"><div className="card-header"><div className="card-title">فلاتر كشف الحساب</div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="btn btn-gold" onClick={() => setPayOpen(true)}>+ إضافة دفعة من الوكيل</button>{canExport && <ExportButton disabled={displayRows.length === 0} getData={buildExportData} />}</div></div><div className="form-grid" style={{ padding: 12 }}><div className="form-group"><label>من تاريخ</label><input type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} /></div><div className="form-group"><label>إلى تاريخ</label><input type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} /></div><div className="form-group"><label>نوع الحركة</label><select value={filters.kind} onChange={(e) => setF("kind", e.target.value)}><option value="">الكل</option><option value="service">خدمات</option><option value="payment">مدفوعات</option></select></div><div className="form-group"><label>الخدمة</label><select value={filters.service} onChange={(e) => setF("service", e.target.value)}><option value="">الكل</option>{serviceOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select></div><div className="form-group"><label>طريقة الدفع</label><select value={filters.method} onChange={(e) => setF("method", e.target.value)}><option value="">الكل</option>{methodOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select></div><div className="form-group"><label>بحث</label><input type="search" placeholder="وجهة / خدمة / ملاحظات" value={filters.query} onChange={(e) => setF("query", e.target.value)} /></div></div></div>
          <div className="card"><div className="card-header"><div className="card-title">كشف الحساب المالي</div></div><div className="card-body"><div className="table-wrap enterprise-table"><table className="mobile-cards"><thead><tr><th>#</th><th>التاريخ</th><th>البيان</th><th>الخدمة / الوجهة</th><th>العدد</th><th>السعر</th><th>قيمة الخدمة</th><th>مدين عليه</th><th>دائن له</th><th>الرصيد الجاري</th><th>طريقة الدفع</th><th>ملاحظات</th></tr></thead><tbody>{displayRows.length === 0 ? <tr><td colSpan={12}><div className="empty"><div className="empty-text">لا توجد حركات مطابقة</div></div></td></tr> : displayRows.map((e, i) => <tr key={e.id} style={{ background: e.kind === "payment" ? "rgba(22,163,74,0.04)" : undefined }}><td data-label="#">{i + 1}</td><td data-label="التاريخ">{e.date}</td><td data-label="البيان" className="bold">{e.description}</td><td data-label="الخدمة/الوجهة">{e.service} / {e.destination}</td><td data-label="العدد">{e.count || "—"}</td><td data-label="السعر">{e.price ? fmtNum(e.price) : "—"}</td><td data-label="قيمة الخدمة">{e.serviceValue ? fmtDL(e.serviceValue) : "—"}</td><td data-label="مدين عليه" style={{ color: "var(--red)", fontWeight: 700 }}>{e.debit ? fmtDL(e.debit) : "—"}</td><td data-label="دائن له" style={{ color: "var(--green)", fontWeight: 700 }}>{e.credit ? fmtDL(e.credit) : "—"}</td><td data-label="الرصيد الجاري" style={{ fontWeight: 800, color: e.balance > 0 ? "var(--red)" : e.balance < 0 ? "var(--green)" : undefined }}>{fmtDL(e.balance)}</td><td data-label="طريقة الدفع">{e.paymentMethod}{e.raw.merchant_id && merchantName(e.raw.merchant_id) ? ` — ${merchantName(e.raw.merchant_id)}` : ""}</td><td data-label="ملاحظات">{e.note}</td></tr>)}</tbody><tfoot><tr><td colSpan={7}>الإجمالي</td><td>{fmtDL(totalServices)}</td><td>{fmtDL(totalPayments)}</td><td colSpan={3} style={{ fontWeight: 800 }}>{fmtDL(Math.abs(net))} — {accountStatus}</td></tr></tfoot></table></div></div></div>
        </>
      )}

      {editOpen && agent && <EditAgentModal agent={agent} onClose={() => setEditOpen(false)} />}
      {payOpen && agent && createPortal(
        <div onClick={() => setPayOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16, overflow: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 880, maxHeight: "92vh", overflow: "auto" }}>
            <AgentPaymentForm agents={agents} merchants={merchants} lockedAgentId={agent.id} onDone={() => setPayOpen(false)} />
          </div>
        </div>,
        document.body,
      )}


    </div>
  );
}




function EditAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [form, setForm] = useState({ name: agent.name || "", national_id: agent.national_id || "", phone: agent.phone || "", whatsapp: agent.whatsapp || "", governorate: agent.governorate || "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم الوكيل مطلوب");
    if (!form.phone.trim()) return toast.error("الهاتف مطلوب");
    setSaving(true);
    const { error } = await supabase.from("agents").update({ name: form.name.trim(), national_id: form.national_id.trim() || null, phone: form.phone.trim(), whatsapp: form.whatsapp.trim() || null, governorate: form.governorate || null }).eq("id", agent.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث بيانات الوكيل بنجاح");
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}><div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}><div className="card-header"><div className="card-title">تعديل بيانات الوكيل</div></div><div className="form-grid"><div className="form-group"><label>اسم الوكيل</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div><div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div><div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div><div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div><div className="form-group"><label>المحافظة</label><select value={form.governorate} onChange={(e) => set("governorate", e.target.value)}><option value="">— غير محدد —</option>{GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}</select></div></div><div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button><button type="button" className="btn btn-gold" onClick={save} disabled={saving}>حفظ التعديلات</button></div></div></div>, document.body);
}