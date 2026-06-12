import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { badgeFor, fmtDL, tripValue, txnTotalPaid, useLive, useDropdownOptions, GOVERNORATES, applyOptimistic, type Agent, type Merchant, type Transaction } from "@/lib/db";
import { AgentPricingSection } from "@/components/AgentPricingSection";
import { syncAgentOpeningBalance } from "@/lib/openingBalance";
import { toast } from "sonner";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

import { AgentLedger } from "@/components/AgentLedger";
import { AgentPaymentForm } from "@/components/AgentPaymentForm";
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

  const debouncedSearch = useDebouncedValue(search, 250);
  const filtered = useMemo(() => agents.filter((a) =>
    !debouncedSearch || a.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
  ), [agents, debouncedSearch]);

  const { pageRows, Controls, page, pageSize } = usePagination(filtered, 50);

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
            <CreditCard size={15} strokeWidth={2} /> <span>إضافة دفعة من الوكيل</span>
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
                    ) : pageRows.map((a, i) => {
                      const idx = page * pageSize + i;
                      const s = stats.get(a.id) || { trips: 0, paid: 0 };
                      return (
                        <tr key={a.id}>
                          <td data-label="#">{idx + 1}</td>
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
              <Controls />
            </div>
          </div>
        </>
      )}

      {tab === "add" && perm.create && <AgentForm onDone={() => setTab("list")} />}
      {tab === "txn" && perm.create && <TxnForm agents={agents} merchants={merchants} txns={txns} onDone={() => setTab("list")} />}
      {tab === "statement" && <AppErrorBoundary name="AgentLedger"><AgentLedger initialAgentId={statementAgentId} canExport={perm.export} /></AppErrorBoundary>}

      {editAgent && perm.edit && <EditAgentModal agent={editAgent} onClose={() => setEditAgent(null)} />}
    </div>
  );
}

function EditAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const a = agent as any;
  const [form, setForm] = useState({
    name: agent.name || "",
    national_id: agent.national_id || "",
    phone: agent.phone || "",
    whatsapp: agent.whatsapp || "",
    governorate: agent.governorate || "",
    opening_debit: a.opening_debit ? String(a.opening_debit) : "",
    opening_credit: a.opening_credit ? String(a.opening_credit) : "",
    opening_date: a.opening_date || "",
    opening_note: a.opening_note || "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return toast.error("برجاء إدخال اسم الوكيل");
    if (!form.phone.trim()) return toast.error("برجاء إدخال رقم الهاتف");
    const debit = Number(form.opening_debit) || 0;
    const credit = Number(form.opening_credit) || 0;
    const patch = {
      name: form.name.trim(),
      national_id: form.national_id.trim() || null,
      phone: form.phone.trim(),
      whatsapp: form.whatsapp.trim() || null,
      governorate: form.governorate || null,
      opening_debit: debit,
      opening_credit: credit,
      opening_date: form.opening_date || null,
      opening_note: form.opening_note.trim() || null,
    } as any;
    const { ok } = await applyOptimistic({
      table: "agents", type: "update", id: agent.id, patch,
      run: async () => await supabase.from("agents").update(patch).eq("id", agent.id),
    });
    if (!ok) return;
    await syncAgentOpeningBalance(agent.id, {
      debit, credit,
      date: form.opening_date || null,
      note: form.opening_note.trim() || null,
    });
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

        <div className="card" style={{ marginTop: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
          <div className="card-header"><div className="card-title">📒 الرصيد السابق</div></div>
          <div className="card-body">
            <div className="form-grid">
              <div className="form-group"><label>رصيد سابق مدين</label>
                <input type="number" min="0" value={form.opening_debit} onChange={(e) => set("opening_debit", e.target.value)} placeholder="0" />
              </div>
              <div className="form-group"><label>رصيد سابق دائن</label>
                <input type="number" min="0" value={form.opening_credit} onChange={(e) => set("opening_credit", e.target.value)} placeholder="0" />
              </div>
              <div className="form-group"><label>تاريخ الرصيد السابق</label>
                <input type="date" value={form.opening_date} onChange={(e) => set("opening_date", e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>ملاحظات</label>
                <input value={form.opening_note} onChange={(e) => set("opening_note", e.target.value)} placeholder="ملاحظات اختيارية" />
              </div>
            </div>
          </div>
        </div>

        <AgentPricingSection agentId={agent.id} />
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="action-btn" onClick={onClose}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ التعديلات" className="btn btn-gold" onClick={save}>💾 حفظ التعديلات</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}



type PricingRow = { company_price: string; agent_price: string; company_percentage: string; company_profit_value: string };
const EMPTY_PRICING_ROW: PricingRow = { company_price: "", agent_price: "", company_percentage: "", company_profit_value: "" };
function r2(n: number) { return Math.round(n * 100) / 100; }

function AgentForm({ onDone }: { onDone: () => void }) {
  const serviceTypes = useDropdownOptions("service_type");
  const [form, setForm] = useState({ name: "", national_id: "", phone: "", whatsapp: "", governorate: "" });
  const [opening, setOpening] = useState({ debit: "", credit: "", date: "", note: "" });
  const [rows, setRows] = useState<Record<string, PricingRow>>({});
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const setOp = (k: string, v: string) => setOpening((p) => ({ ...p, [k]: v }));

  const updateRow = (st: string, patch: Partial<PricingRow>) => {
    setRows((prev) => {
      const cur = { ...(prev[st] || EMPTY_PRICING_ROW), ...patch };
      const cp = Number(cur.company_price) || 0;
      const ap = Number(cur.agent_price) || 0;
      if (ap >= cp && ap > 0) {
        const profit = r2(ap - cp);
        const percentage = r2((profit / ap) * 100);
        cur.company_profit_value = String(profit);
        cur.company_percentage = String(percentage);
      } else {
        cur.company_profit_value = "";
        cur.company_percentage = "";
      }
      return { ...prev, [st]: cur };
    });
  };

  const confirmRow = (st: string) => {
    const r = rows[st];
    if (!r || (!Number(r.company_price) && !Number(r.agent_price))) return toast.error("أدخل السعر أولاً");
    if (Number(r.agent_price) < Number(r.company_price)) return toast.error("سعر الوكيل يجب أن يكون أكبر من أو يساوي سعر الشركة");
    toast.success(`تم تجهيز تسعير: ${st}`);
  };
  const clearRow = (st: string) => {
    setRows((p) => ({ ...p, [st]: { ...EMPTY_PRICING_ROW } }));
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم الوكيل مطلوب");
    if (!form.phone.trim()) return toast.error("الهاتف مطلوب");
    const opDebit = Number(opening.debit) || 0;
    const opCredit = Number(opening.credit) || 0;
    const { data, error } = await supabase.from("agents").insert({
      name: form.name,
      national_id: form.national_id || null,
      phone: form.phone,
      whatsapp: form.whatsapp || null,
      governorate: form.governorate || null,
      opening_debit: opDebit,
      opening_credit: opCredit,
      opening_date: opening.date || null,
      opening_note: opening.note.trim() || null,
    } as any).select("id").single();
    if (error) return toast.error(error.message);
    const agentId = data?.id;
    if (agentId) {
      const candidates = serviceTypes
        .filter((st: string) => Number(rows[st]?.company_price) > 0 || Number(rows[st]?.agent_price) > 0);
      const invalid = candidates.find((st) => Number(rows[st].agent_price) < Number(rows[st].company_price));
      if (invalid) {
        toast.error(`(${invalid}) سعر الوكيل يجب أن يكون أكبر من أو يساوي سعر الشركة`);
        onDone();
        return;
      }
      const pricingRows = candidates.map((st) => ({
        agent_id: agentId,
        service_type: st,
        company_price: Number(rows[st].company_price) || 0,
        agent_price: Number(rows[st].agent_price) || 0,
        company_percentage: Number(rows[st].company_percentage) || 0,
        company_profit_value: Number(rows[st].company_profit_value) || 0,
      }));
      if (pricingRows.length) {
        const { error: pErr } = await supabase.from("agent_service_pricing").insert(pricingRows);
        if (pErr) toast.error("تم حفظ الوكيل لكن فشل حفظ التسعير: " + pErr.message);
      }
      if (opDebit > 0 || opCredit > 0) {
        await syncAgentOpeningBalance(agentId, {
          debit: opDebit, credit: opCredit,
          date: opening.date || null,
          note: opening.note.trim() || null,
        });
      }
    }
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

      <div className="card" style={{ marginTop: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
        <div className="card-header"><div className="card-title">💰 تسعير الخدمات</div></div>
        <div className="card-body">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--card)" }}>
                  <th style={{ padding: 8, textAlign: "right" }}>نوع الخدمة</th>
                  <th style={{ padding: 8 }}>سعر الشركة</th>
                  <th style={{ padding: 8 }}>سعر الوكيل</th>
                  <th style={{ padding: 8 }}>نسبة الشركة %</th>
                  <th style={{ padding: 8 }}>ربح الشركة</th>
                  <th style={{ padding: 8 }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {serviceTypes.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 12, textAlign: "center", color: "var(--muted)" }}>أضف أنواع الخدمة من الإعدادات → القوائم المنسدلة</td></tr>
                ) : serviceTypes.map((st: string) => {
                  const r = rows[st] || EMPTY_PRICING_ROW;
                  return (
                    <tr key={st} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: 6, fontWeight: 700 }}>{st}</td>
                      <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_price} onChange={(e) => updateRow(st, { company_price: e.target.value })} /></td>
                      <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.agent_price} onChange={(e) => updateRow(st, { agent_price: e.target.value })} /></td>
                      <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_percentage} disabled readOnly /></td>
                      <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_profit_value} disabled readOnly /></td>
                      <td style={{ padding: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button data-confirm-save="تأكيد حفظ الصلاحية" type="button" className="btn btn-gold" onClick={() => confirmRow(st)} style={{ padding: "4px 8px", fontSize: 11 }}>حفظ</button>
                        <button type="button" className="action-btn" onClick={() => clearRow(st)} style={{ padding: "4px 8px", fontSize: 11 }}>حذف</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="form-footer"><button data-confirm-save="تأكيد حفظ الوكيل" className="btn btn-gold" onClick={save}>💾 حفظ الوكيل</button></div>
    </div>
  );
}

function TxnForm(props: { agents: Agent[]; merchants: Merchant[]; txns: Transaction[]; onDone: () => void }) {
  return <AgentPaymentForm agents={props.agents} merchants={props.merchants} onDone={props.onDone} />;
}



