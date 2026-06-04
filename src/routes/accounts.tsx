import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { badgeFor, fmtDL, fmtNum, tripValue, txnTotalPaid, useLive, useDropdownOptions, GOVERNORATES, PRICING_SERVICE_TYPES, applyOptimistic, type Agent, type Merchant, type Transaction } from "@/lib/db";
import { AgentPricingSection } from "@/components/AgentPricingSection";
import { toast } from "sonner";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SafeSelectOptions } from "@/components/SafeSelectOptions";
import { AgentLedger } from "@/components/AgentLedger";
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
      {tab === "statement" && <AgentLedger initialAgentId={statementAgentId} canExport={perm.export} />}

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
    const patch = {
      name: form.name.trim(),
      national_id: form.national_id.trim() || null,
      phone: form.phone.trim(),
      whatsapp: form.whatsapp.trim() || null,
      governorate: form.governorate || null,
    };
    const { ok } = await applyOptimistic({
      table: "agents", type: "update", id: agent.id, patch,
      run: async () => await supabase.from("agents").update(patch).eq("id", agent.id),
    });
    if (!ok) return;
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
        <AgentPricingSection agentId={agent.id} />
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="action-btn" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" onClick={save}>💾 حفظ التعديلات</button>
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
  const [form, setForm] = useState({ name: "", national_id: "", phone: "", whatsapp: "", governorate: "" });
  const [rows, setRows] = useState<Record<string, PricingRow>>(() => {
    const m: Record<string, PricingRow> = {};
    for (const st of PRICING_SERVICE_TYPES) m[st] = { ...EMPTY_PRICING_ROW };
    return m;
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

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
    const { data, error } = await supabase.from("agents").insert({
      name: form.name,
      national_id: form.national_id || null,
      phone: form.phone,
      whatsapp: form.whatsapp || null,
      governorate: form.governorate || null,
    }).select("id").single();
    if (error) return toast.error(error.message);
    const agentId = data?.id;
    if (agentId) {
      const candidates = PRICING_SERVICE_TYPES
        .filter((st) => Number(rows[st]?.company_price) > 0 || Number(rows[st]?.agent_price) > 0);
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
                {PRICING_SERVICE_TYPES.map((st) => {
                  const r = rows[st] || EMPTY_PRICING_ROW;
                  return (
                    <tr key={st} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: 6, fontWeight: 700 }}>{st}</td>
                      <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_price} onChange={(e) => updateRow(st, { company_price: e.target.value })} /></td>
                      <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.agent_price} onChange={(e) => updateRow(st, { agent_price: e.target.value })} /></td>
                      <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_percentage} disabled readOnly /></td>
                      <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_profit_value} disabled readOnly /></td>
                      <td style={{ padding: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-gold" onClick={() => confirmRow(st)} style={{ padding: "4px 8px", fontSize: 11 }}>حفظ</button>
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

      <div className="form-footer"><button className="btn btn-gold" onClick={save}>💾 حفظ الوكيل</button></div>
    </div>
  );
}

type PaymentMethod = "نقدي" | "تحويل بنكي" | "إنستاباي" | "كاش محفظة" | "كاش نقدي تاجر";
type Currency = "EGP" | "USD" | "LYD";
const PAYMENT_METHODS: PaymentMethod[] = ["نقدي", "تحويل بنكي", "إنستاباي", "كاش محفظة", "كاش نقدي تاجر"];
const CURRENCY_LABEL: Record<Currency, string> = { EGP: "جنيه مصري", USD: "دولار", LYD: "دينار ليبي" };

type SplitRow = {
  id: string;
  method: PaymentMethod;
  currency: Currency;
  cash_box_id: string;
  amount: string;
  exchange_rate: string;
};

type CashBox = { id: string; name: string; currency: Currency; balance: number; is_active: boolean };

function newSplit(): SplitRow {
  return {
    id: (crypto as any)?.randomUUID?.() || `s-${Date.now()}-${Math.random()}`,
    method: "نقدي",
    currency: "EGP",
    cash_box_id: "",
    amount: "",
    exchange_rate: "1",
  };
}

function TxnForm({ agents, onDone }: { agents: Agent[]; merchants: Merchant[]; txns: Transaction[]; onDone: () => void }) {
  const { rows: cashBoxesRaw } = useLive<CashBox>("cash_boxes");
  const cashBoxes = useMemo(() => cashBoxesRaw.filter((b) => b.is_active !== false), [cashBoxesRaw]);
  const SERVICE_TYPES = useDropdownOptions("service_type");

  const [form, setForm] = useState({
    agent_id: "",
    date: new Date().toISOString().slice(0, 10),
    service_type: "",
    total_amount: "",
    note: "",
  });
  const [splits, setSplits] = useState<SplitRow[]>([newSplit()]);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const updateSplit = (id: string, patch: Partial<SplitRow>) => {
    setSplits((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      // reset cash_box when currency changes
      if (patch.currency && patch.currency !== s.currency) {
        next.cash_box_id = "";
        if (patch.currency === "EGP") next.exchange_rate = "1";
      }
      return next;
    }));
  };
  const addSplit = () => setSplits((p) => [...p, newSplit()]);
  const removeSplit = (id: string) => setSplits((p) => p.length > 1 ? p.filter((s) => s.id !== id) : p);

  const egpEquivalent = (s: SplitRow) => {
    const amt = Number(s.amount || 0);
    const rate = s.currency === "EGP" ? 1 : Number(s.exchange_rate || 0);
    return Math.round(amt * rate);
  };
  const splitsTotalEGP = splits.reduce((acc, s) => acc + egpEquivalent(s), 0);
  const headerTotal = Math.round(Number(form.total_amount || 0));
  const totalsMatch = headerTotal > 0 && splitsTotalEGP === headerTotal;

  const save = async () => {
    if (!form.agent_id) return toast.error("اختر الوكيل");
    if (!form.service_type) return toast.error("اختر نوع الخدمة");
    if (headerTotal <= 0) return toast.error("أدخل إجمالي مبلغ الدفعة");
    for (const s of splits) {
      if (!s.method) return toast.error("اختر طريقة الدفع لكل سطر");
      if (!s.currency) return toast.error("اختر العملة لكل سطر");
      if (!s.cash_box_id) return toast.error("اختر الخزينة لكل سطر");
      if (Number(s.amount || 0) <= 0) return toast.error("أدخل مبلغ موجب لكل سطر");
      if (s.currency !== "EGP" && Number(s.exchange_rate || 0) <= 0) return toast.error("أدخل سعر صرف صحيح للعملة غير الجنيه");
    }
    if (!totalsMatch) return toast.error(`إجمالي سطور الدفع (${fmtNum(splitsTotalEGP)}) لا يطابق إجمالي مبلغ الدفعة (${fmtNum(headerTotal)})`);

    setSaving(true);
    const { data: txnRow, error: txnErr } = await supabase.from("transactions").insert({
      agent_id: form.agent_id,
      date: form.date,
      destination: null,
      travel_statement: null,
      service_type: form.service_type,
      count: 0,
      price: 0,
      payment_method: splits.length === 1 ? splits[0].method : "متعدد",
      instapay_amount: 0,
      cash_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
      total_paid: headerTotal,
      paid: headerTotal,
      note: form.note.trim() || null,
      source_service_type: "payment",
    }).select("id").single();
    if (txnErr || !txnRow) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الدفعة"); }

    const splitRows = splits.map((s) => ({
      transaction_id: txnRow.id,
      method: s.method,
      currency: s.currency,
      cash_box_id: s.cash_box_id,
      amount: Number(s.amount || 0),
      exchange_rate: s.currency === "EGP" ? 1 : Number(s.exchange_rate || 0),
      egp_equivalent: egpEquivalent(s),
    }));
    const { error: splitErr } = await supabase.from("payment_splits").insert(splitRows);
    if (splitErr) {
      // rollback transaction insert
      await supabase.from("transactions").delete().eq("id", txnRow.id);
      setSaving(false);
      return toast.error(splitErr.message);
    }
    try {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("activity_logs").insert({
        user_id: u.user?.id ?? null,
        user_email: u.user?.email ?? null,
        action: "agent_payment_added",
        entity: "transactions",
        details: { agent_id: form.agent_id, amount: headerTotal, splits: splitRows.length, date: form.date },
      });
    } catch { /* ignore */ }
    setSaving(false);
    toast.success("تم تسجيل الدفعة");
    onDone();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💳 إضافة دفعة من الوكيل</div></div>
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
        <div className="form-group"><label>إجمالي مبلغ الدفعة (ج.م)</label>
          <input type="number" min={0} placeholder="0" value={form.total_amount} onChange={(e) => set("total_amount", e.target.value)} />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      <div className="card" style={{ margin: "12px 0" }}>
        <div className="card-header">
          <div className="card-title">توزيع الدفعة</div>
          <button type="button" className="action-btn" onClick={addSplit}>+ إضافة سطر دفع</button>
        </div>
        <div className="card-body">
          <div className="table-wrap enterprise-table">
            <table className="mobile-cards">
              <thead>
                <tr>
                  <th>#</th><th>طريقة الدفع</th><th>العملة</th><th>الخزينة</th><th>المبلغ</th><th>سعر الصرف</th><th>المعادل بالجنيه</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((s, i) => {
                  const boxOptions = cashBoxes.filter((b) => b.currency === s.currency);
                  return (
                    <tr key={s.id}>
                      <td data-label="#">{i + 1}</td>
                      <td data-label="طريقة الدفع">
                        <select value={s.method} onChange={(e) => updateSplit(s.id, { method: e.target.value as PaymentMethod })}>
                          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </td>
                      <td data-label="العملة">
                        <select value={s.currency} onChange={(e) => updateSplit(s.id, { currency: e.target.value as Currency })}>
                          {(Object.keys(CURRENCY_LABEL) as Currency[]).map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
                        </select>
                      </td>
                      <td data-label="الخزينة">
                        <select value={s.cash_box_id} onChange={(e) => updateSplit(s.id, { cash_box_id: e.target.value })}>
                          <option value="">— اختر —</option>
                          {boxOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </td>
                      <td data-label="المبلغ">
                        <input type="number" min={0} value={s.amount} onChange={(e) => updateSplit(s.id, { amount: e.target.value })} />
                      </td>
                      <td data-label="سعر الصرف">
                        <input type="number" min={0} step="0.0001" value={s.exchange_rate} disabled={s.currency === "EGP"} onChange={(e) => updateSplit(s.id, { exchange_rate: e.target.value })} />
                      </td>
                      <td data-label="المعادل" className="num-col"><strong>{fmtNum(egpEquivalent(s))}</strong></td>
                      <td data-label="إجراءات">
                        <button type="button" className="action-btn" onClick={() => removeSplit(s.id)} disabled={splits.length === 1}>حذف</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>إجمالي سطور الدفع بالجنيه</td>
                  <td className="num-col" style={{ color: totalsMatch ? "var(--green)" : "var(--red)", fontWeight: 800 }}>{fmtNum(splitsTotalEGP)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!totalsMatch && headerTotal > 0 && (
            <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(220,38,38,0.08)", color: "var(--red)", fontWeight: 700 }}>
              الفرق: {fmtNum(headerTotal - splitsTotalEGP)} ج.م — لا يمكن الحفظ حتى يتطابق الإجمالي.
            </div>
          )}
        </div>
      </div>

      <div className="form-footer">
        <button className="btn btn-gold" onClick={save} disabled={saving || !totalsMatch}>💾 حفظ الدفعة</button>
      </div>
    </div>
  );
}

