import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  badgeFor, fmtDL, fmtNum, tripValue, txnTotalPaid, merchantCashGross, merchantCashNet, merchantCashPhysical, useLive, GOVERNORATES,
  type Agent, type Approval, type Flight, type Transaction, type Merchant,
} from "@/lib/db";
import { useRegisterStatementCapture } from "@/lib/statementCapture";
import { AgentPricingSection } from "@/components/AgentPricingSection";

export const Route = createFileRoute("/agent-statement/$agentId")({
  component: AgentDetail,
  validateSearch: (s: Record<string, unknown>) => ({
    from: typeof s.from === "string" ? s.from : "",
    to: typeof s.to === "string" ? s.to : "",
  }),
});

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

  const myFlights = useMemo(() => flights.filter((f) => f.agent_id === id && inRange(f.travel_date)), [flights, id, from, to]);
  const myApprovals = useMemo(() => approvals.filter((a) => a.agent_id === id && inRange(a.submit_date)), [approvals, id, from, to]);
  const myTxns = useMemo(() => txns.filter((t) => t.agent_id === id && inRange(t.date)), [txns, id, from, to]);

  const totalTrips = myTxns.reduce((s, t) => s + tripValue(t), 0);
  const totalPaid = myTxns.reduce((s, t) => s + txnTotalPaid(t), 0);
  const due = totalTrips - totalPaid;

  useRegisterStatementCapture(
    () => ({
      data: {
        title: "كشف حساب الوكيل",
        subtitle: `${agent?.name || ""}${from || to ? ` — من ${from || "..."} إلى ${to || "..."}` : ""}`,
        fileName: `كشف-حساب-${agent?.name || "الوكيل"}`,
        summary: [
          { label: "قيمة الرحلات", value: fmtDL(totalTrips) },
          { label: "إجمالي المدفوعات", value: fmtDL(totalPaid) },
          { label: "الصافي المستحق", value: fmtDL(due) },
        ],
        columns: [
          { header: "#", key: "n" },
          { header: "التاريخ", key: "date" },
          { header: "نوع الخدمة", key: "service" },
          { header: "الوجهة", key: "dest" },
          { header: "بيان السفر", key: "ts" },
          { header: "العدد", key: "count" },
          { header: "السعر", key: "price" },
          { header: "قيمة الرحلة", key: "tv" },
          { header: "إجمالي المدفوع", key: "paid" },
          { header: "الصافي", key: "rest" },
          { header: "بيان", key: "note" },
        ],
          rows: myTxns.map((t, i) => {
            const tv = tripValue(t);
            const paidT = txnTotalPaid(t);
            const count = Number(t.count || 0);
            const displayedPrice = Number(t.price || 0);
            return {
              n: i + 1,
              date: t.date,
              service: t.service_type || "—",
              dest: t.destination || "—",
              ts: t.travel_statement || "—",
              count,
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
      },
      whatsapp: agent?.whatsapp || null,
      contextId: agent?.id || null,
    }),
    [agent, myTxns, totalTrips, totalPaid, due, from, to],
  );

  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!agentsLoading && !agent) {
      toast.error("تعذر فتح ملف الوكيل");
      router.history.back();
    }
  }, [agentsLoading, agent, router]);

  if (agentsLoading || !agent) {
    return null;
  }

  return (
    <div className="section active">
      <div className="card">
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
        <div className="sum-box gold"><div className="label">قيمة الرحلات</div><div className="val">{fmtDL(totalTrips)}</div></div>
        <div className="sum-box green"><div className="label">إجمالي المدفوعات</div><div className="val">{fmtDL(totalPaid)}</div></div>
        <div className="sum-box red"><div className="label">الصافي المستحق</div><div className="val">{fmtDL(due)}</div></div>
      </div>

      <AgentPricingSection agentId={agent.id} />

      <div className="card">
        <div className="card-header"><div className="card-title">💳 كشف الحساب (الحركات المالية)</div></div>
        <div className="card-body">
          <div className="table-wrap">
            <table className="mobile-cards">
              <thead><tr><th>#</th><th>التاريخ</th><th>نوع الخدمة</th><th>الوجهة</th><th>بيان السفر</th><th>العدد</th><th>السعر</th><th>قيمة الرحلة</th><th>انستا</th><th>نقدي</th><th>كاش التاجر</th><th>صافي كاش التاجر بعد الخصم</th><th>نقدي تاجر</th><th>إجمالي المدفوع</th><th>الصافي</th><th>بيان</th></tr></thead>
              <tbody>
                {myTxns.length === 0 ? (
                  <tr><td colSpan={16}><div className="empty"><div className="empty-icon">💳</div><div className="empty-text">لا توجد حركات</div></div></td></tr>
                ) : myTxns.map((t, i) => {
                  const tv = tripValue(t);
                  const paidT = txnTotalPaid(t);
                  return (
                    <tr key={t.id}>
                      <td data-label="#">{i + 1}</td>
                      <td data-label="التاريخ">{t.date}</td>
                      <td data-label="نوع الخدمة">{t.service_type || "—"}</td>
                      <td data-label="الوجهة">{t.destination || "—"}</td>
                      <td data-label="بيان السفر">{t.travel_statement || "—"}</td>
                      <td data-label="العدد">{t.count}</td>
                      <td data-label="السعر">{fmtNum(Number(t.price))}</td>
                      <td data-label="قيمة الرحلة">{fmtDL(tv)}</td>
                      <td data-label="انستا">{fmtDL(Number(t.instapay_amount || 0))}</td>
                      <td data-label="نقدي">{fmtDL(Number(t.cash_amount || 0))}</td>
                      <td data-label="كاش التاجر">{fmtDL(merchantCashGross(t))}{t.merchant_id && merchantCashGross(t) > 0 ? ` — ${merchantName(t.merchant_id)}` : ""}</td>
                      <td data-label="صافي كاش التاجر بعد الخصم">{fmtDL(merchantCashNet(t))}</td>
                      <td data-label="نقدي تاجر">{fmtDL(merchantCashPhysical(t))}{t.merchant_id && merchantCashPhysical(t) > 0 ? ` — ${merchantName(t.merchant_id)}` : ""}</td>
                      <td data-label="إجمالي المدفوع">{fmtDL(paidT)}</td>
                      <td data-label="الصافي" style={{ color: "var(--red)", fontWeight: 700 }}>{fmtDL(tv - paidT)}</td>
                      <td data-label="بيان">{t.note || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={7}>الإجمالي</td><td>{fmtDL(totalTrips)}</td><td colSpan={5}></td><td>{fmtDL(totalPaid)}</td><td>{fmtDL(due)}</td><td></td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

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

      {editOpen && <EditAgentModal agent={agent} onClose={() => setEditOpen(false)} />}
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
