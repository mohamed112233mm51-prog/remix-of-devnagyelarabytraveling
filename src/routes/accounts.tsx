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

type MethodKey =
  | "company_instapay"
  | "company_cash"
  | "merchant_instapay"
  | "merchant_wallet"
  | "merchant_physical";

type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

const COMPANY_CASH_BOX_NAME = "خزينة نقدي الشركة";
const COMPANY_INSTAPAY_BOX_NAME = "خزينة إنستا الشركة";

export function TxnForm({
  agents,
  merchants,
  lockedAgentId,
  onDone,
}: {
  agents: Agent[];
  merchants: Merchant[];
  txns: Transaction[];
  lockedAgentId?: string;
  onDone: () => void;
}) {
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");
  const SERVICE_TYPES = useDropdownOptions("service_type");
  const DESTINATIONS = useDropdownOptions("destination");

  const [form, setForm] = useState({
    agent_id: lockedAgentId || "",
    date: new Date().toISOString().slice(0, 10),
    service_type: "",
    destination: "",
    count: "1",
    price: "",
    trip_value: "",
    trip_value_manual: false,
    payment_method: "company_instapay" as MethodKey,
    merchant_id: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) =>
    setForm((p) => ({ ...p, [k]: v }) as typeof p);

  useEffect(() => {
    if (lockedAgentId) setForm((p) => ({ ...p, agent_id: lockedAgentId }));
  }, [lockedAgentId]);

  const autoTripValue = (Number(form.count) || 0) * (Number(form.price) || 0);
  const tripValueNum = form.trip_value_manual
    ? Number(form.trip_value) || 0
    : autoTripValue;
  useEffect(() => {
    if (!form.trip_value_manual) {
      setForm((p) => ({ ...p, trip_value: autoTripValue ? String(autoTripValue) : "" }));
    }
  }, [form.count, form.price, form.trip_value_manual, autoTripValue]);

  const merchant = useMemo(
    () => merchants.find((m) => m.id === form.merchant_id),
    [merchants, form.merchant_id],
  );

  const methodOptions = useMemo<{ key: MethodKey; label: string }[]>(() => {
    if (merchant) {
      const opts: { key: MethodKey; label: string }[] = [];
      if (merchant.supports_instapay) opts.push({ key: "merchant_instapay", label: `إنستا تاجر: ${merchant.merchant_name}` });
      if (merchant.supports_cash_wallet) opts.push({ key: "merchant_wallet", label: `كاش محفظة تاجر: ${merchant.merchant_name}` });
      if (merchant.supports_physical_cash) opts.push({ key: "merchant_physical", label: `كاش نقدي تاجر: ${merchant.merchant_name}` });
      return opts;
    }
    return [
      { key: "company_instapay", label: "إنستا الشركة" },
      { key: "company_cash", label: "نقدي الشركة" },
    ];
  }, [merchant]);

  useEffect(() => {
    if (!methodOptions.some((o) => o.key === form.payment_method)) {
      setForm((p) => ({ ...p, payment_method: (methodOptions[0]?.key || "company_instapay") as MethodKey }));
    }
  }, [methodOptions]);

  const save = async () => {
    if (!form.agent_id) return toast.error("اختر الوكيل");
    if (!form.service_type) return toast.error("اختر نوع الخدمة");
    if (!form.destination) return toast.error("اختر وجهة السفر");
    if (tripValueNum <= 0) return toast.error("قيمة الرحلة يجب أن تكون أكبر من صفر");
    if (methodOptions.length === 0) return toast.error("لا توجد وسيلة دفع مفعلة لهذا التاجر");

    const m = form.payment_method;
    const isMerchantMethod = m.startsWith("merchant_");
    const merchantIdToSave = isMerchantMethod ? form.merchant_id || null : null;
    const amount = tripValueNum;

    const payload: any = {
      agent_id: form.agent_id,
      date: form.date,
      destination: form.destination,
      service_type: form.service_type,
      count: Number(form.count) || 1,
      price: Number(form.price) || 0,
      payment_method:
        m === "company_instapay" || m === "merchant_instapay" ? "إنستاباي"
          : m === "company_cash" ? "نقدي"
          : m === "merchant_wallet" ? "كاش محفظة"
          : "كاش نقدي تاجر",
      instapay_amount: 0,
      cash_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      total_paid: amount,
      paid: amount,
      merchant_id: merchantIdToSave,
      note: form.note.trim() || null,
      source_service_type: "payment",
    };
    if (m === "company_instapay" || m === "merchant_instapay") payload.instapay_amount = amount;
    else if (m === "company_cash") payload.cash_amount = amount;
    else if (m === "merchant_wallet") { payload.merchant_cash_amount = amount; payload.merchant_cash_net_amount = amount; }
    else if (m === "merchant_physical") payload.merchant_cash_physical_amount = amount;

    setSaving(true);
    const { data: txnRow, error: txnErr } = await supabase
      .from("transactions").insert(payload).select("id").single();
    if (txnErr || !txnRow) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الدفعة"); }

    if (m === "company_instapay" || m === "company_cash") {
      const boxName = m === "company_instapay" ? COMPANY_INSTAPAY_BOX_NAME : COMPANY_CASH_BOX_NAME;
      const box = cashBoxes.find((b) => b.name === boxName && b.currency === "EGP");
      if (box) {
        await supabase.from("payment_splits").insert({
          transaction_id: txnRow.id,
          method: payload.payment_method,
          currency: "EGP",
          cash_box_id: box.id,
          amount,
          exchange_rate: 1,
          egp_equivalent: amount,
        });
      }
    }

    try {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("activity_logs").insert({
        user_id: u.user?.id ?? null,
        user_email: u.user?.email ?? null,
        action: "agent_payment_added",
        entity: "transactions",
        details: { agent_id: form.agent_id, amount, method: m, merchant_id: merchantIdToSave, date: form.date },
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
          <select value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)} disabled={!!lockedAgentId}>
            <option value="" disabled>اختر...</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>التاريخ</label>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div className="form-group"><label>نوع الخدمة</label>
          <select value={form.service_type} onChange={(e) => set("service_type", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={SERVICE_TYPES} />
          </select>
        </div>
        <div className="form-group"><label>وجهة السفر</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>العدد</label>
          <input type="number" min={1} value={form.count} onChange={(e) => set("count", e.target.value)} />
        </div>
        <div className="form-group"><label>السعر</label>
          <input type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} />
        </div>
        <div className="form-group"><label>
          قيمة الرحلة
          <span style={{ marginInlineStart: 8, fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>
            <input type="checkbox" checked={form.trip_value_manual} onChange={(e) => set("trip_value_manual", e.target.checked)} style={{ marginInlineEnd: 4 }} />
            تعديل يدوي
          </span>
        </label>
          <input
            type="number"
            min={0}
            value={form.trip_value_manual ? form.trip_value : String(autoTripValue || "")}
            onChange={(e) => set("trip_value", e.target.value)}
            disabled={!form.trip_value_manual}
          />
        </div>
        <div className="form-group"><label>التاجر (اختياري)</label>
          <select value={form.merchant_id} onChange={(e) => set("merchant_id", e.target.value)}>
            <option value="">— بدون تاجر (الشركة) —</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>وسيلة الدفع</label>
          <select value={form.payment_method} onChange={(e) => set("payment_method", e.target.value as MethodKey)}>
            {methodOptions.length === 0 && <option value="" disabled>لا توجد وسائل مفعلة لهذا التاجر</option>}
            {methodOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      <div className="form-footer">
        <button className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الدفعة</button>
      </div>
    </div>
  );
}


