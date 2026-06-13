import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDL, merchantCashGross, merchantCashNet, useLive,
  type Agent, type IssuingCompany, type Merchant, type MerchantCashCollection,
  type Transaction, type CompanyTransaction,
} from "@/lib/db";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { Handshake, ArrowDownCircle, ArrowUpCircle, Banknote, Wallet, UserPlus, Users, Receipt, ArrowDownLeft, ArrowUpRight, ListChecks, FileText, Search, Calendar, Percent, Phone } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";
import {
  PaymentSplits,
  newPaymentSplitRow,
  validatePaymentSplits,
  filterValidSplits,
  methodsForSplit,
  type PaymentSplitRow,
} from "@/components/PaymentSplits";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { DateInput } from "@/components/inputs/DateInput";

export const Route = createFileRoute("/merchants")({
  component: MerchantsPage,
});



function MerchantsPage() {
  const perm = usePerm("merchants");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const [tab, setTab] = useState<"list" | "add" | "collect" | "history" | "incoming" | "outgoing" | "statement">("history");
  const [editMerchant, setEditMerchant] = useState<Merchant | null>(null);

  const merchantTotals = useMemo(() => {
    const map = new Map<string, { incoming: number; outgoing: number }>();
    for (const c of collections) {
      const v = map.get(c.merchant_id) || { incoming: 0, outgoing: 0 };
      v.incoming += Number(c.amount || 0);
      map.set(c.merchant_id, v);
    }
    return map;
  }, [collections]);

  const collectedByMerchant = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of collections) {
      m.set(c.merchant_id, (m.get(c.merchant_id) || 0) + Number(c.amount || 0));
    }
    return m;
  }, [collections]);

  const incomingTxns = useMemo(() => txns.filter((t) => Number(t.merchant_cash_amount || 0) > 0), [txns]);
  const outgoingTxns = useMemo(() => cTxns.filter((t) => Number(t.merchant_cash_amount || 0) > 0), [cTxns]);

  const totalIncoming = incomingTxns.reduce((s, t) => s + merchantCashNet(t), 0);
  const totalOutgoing = outgoingTxns.reduce((s, t) => s + merchantCashNet(t), 0);
  const totalCollected = collections.reduce((s, c) => s + Number(c.amount || 0), 0);
  const balance = totalIncoming - totalOutgoing - totalCollected;

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || "—";
  const companyName = (id: string) => companies.find((c) => c.id === id)?.company_name || "—";

  return (
    <div className="section active fin-page accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الحسابات المالية</span>
            <span>›</span>
            <span className="crumb-current">حسابات تاجر الكاش</span>
          </div>
          <h1 className="page-h1"><Handshake size={22} strokeWidth={2.2} /> حسابات تاجر الكاش</h1>
          <div className="page-sub">متابعة الوارد، الصادر، والنقدية المحصلة من التجار</div>
        </div>
        {perm.create && (
          <button className="page-head-cta" onClick={() => setTab("add")}>
            <UserPlus size={16} strokeWidth={2.4} /> إضافة تاجر
          </button>
        )}
      </div>
      <div className="account-summary kpi-rich kpi-merchants">
        <div className="sum-box green">
          <span className="kpi-icon"><ArrowDownCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">تاجر الكاش الوارد من الوكلاء</div><div className="val">{fmtDL(totalIncoming)}</div></div>
        </div>
        <div className="sum-box red">
          <span className="kpi-icon"><ArrowUpCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">تاجر الكاش الصادر للشركات</div><div className="val">{fmtDL(totalOutgoing)}</div></div>
        </div>
        <div className="sum-box gold">
          <span className="kpi-icon"><Banknote size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">النقدية المحصلة من التجار</div><div className="val">{fmtDL(totalCollected)}</div></div>
        </div>
        <div className="sum-box hero">
          <span className="kpi-icon"><Wallet size={22} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">رصيد تاجر الكاش</div>
            <div className="val">{fmtDL(balance)}</div>
            <div className="kpi-sub">الرصيد الحالي بعد التحصيلات</div>
          </div>
        </div>
      </div>

      <div className="action-toolbar">
        <div className={`tool-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
          <Receipt size={15} strokeWidth={2} /> <span>سجل التحصيلات</span>
        </div>
        <div className={`tool-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          <Users size={15} strokeWidth={2} /> <span>قائمة التجار</span>
        </div>
        {perm.create && (
          <div className={`tool-tab ${tab === "collect" ? "active" : ""}`} onClick={() => setTab("collect")}>
            <ListChecks size={15} strokeWidth={2} /> <span>تحصيل نقدية</span>
          </div>
        )}
        <div className={`tool-tab ${tab === "incoming" ? "active" : ""}`} onClick={() => setTab("incoming")}>
          <ArrowDownLeft size={15} strokeWidth={2} /> <span>وارد من وكلاء</span>
        </div>
        <div className={`tool-tab ${tab === "outgoing" ? "active" : ""}`} onClick={() => setTab("outgoing")}>
          <ArrowUpRight size={15} strokeWidth={2} /> <span>صادر لشركات</span>
        </div>
        <div className={`tool-tab ${tab === "statement" ? "active" : ""}`} onClick={() => setTab("statement")}>
          <FileText size={15} strokeWidth={2} /> <span>كشف حساب التاجر</span>
        </div>
      </div>

      {tab === "list" && (
        <div className="card">
          <div className="card-header"><div className="card-title">🤝 قائمة التجار</div></div>
          <div className="card-body">
            <div className="table-wrap enterprise-table">
              <table className="mobile-cards">
                <thead><tr><th>#</th><th>اسم التاجر</th><th>الهاتف</th><th>الواتساب</th><th className="num-col">إجمالي الوارد</th><th className="num-col">إجمالي الصادر</th><th className="num-col">إجمالي النقدية المحصلة</th><th className="num-col">الرصيد</th><th>إجراءات</th></tr></thead>
                <tbody>
                  {merchants.length === 0 ? (
                    <tr><td colSpan={9}><div className="empty"><div className="empty-icon">🤝</div><div className="empty-text">لا يوجد تجار</div></div></td></tr>
                  ) : merchants.map((m, i) => {
                    const t = merchantTotals.get(m.id) || { incoming: 0, outgoing: 0 };
                    const bal = t.incoming - t.outgoing;
                    const collected = collectedByMerchant.get(m.id) || 0;
                    return (
                      <tr key={m.id}>
                        <td data-label="#">{i + 1}</td>
                        <td className="bold" data-label="اسم التاجر">{m.merchant_name}</td>
                        <td data-label="الهاتف">{m.phone || "—"}</td>
                        <td data-label="الواتساب">{m.whatsapp || "—"}</td>
                        <td className="num-col" data-label="إجمالي الوارد" style={{ color: "#15803D", fontWeight: 700 }}>{fmtDL(t.incoming)}</td>
                        <td className="num-col" data-label="إجمالي الصادر" style={{ color: "#B91C1C", fontWeight: 700 }}>{fmtDL(t.outgoing)}</td>
                        <td className="num-col" data-label="إجمالي النقدية المحصلة" style={{ color: "#B45309", fontWeight: 700 }}>{fmtDL(collected)}</td>
                        <td className="num-col" data-label="الرصيد" style={{ fontWeight: 800, color: bal >= 0 ? "#15803D" : "#B91C1C" }}>{fmtDL(bal)}</td>
                        <td data-label="إجراءات">{perm.edit ? <button className="action-btn" onClick={() => setEditMerchant(m)}>✏️ تعديل</button> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {editMerchant && perm.edit && <EditMerchantModal merchant={editMerchant} onClose={() => setEditMerchant(null)} />}

      {tab === "add" && perm.create && (
        <>
          <MerchantForm />
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><div className="card-title">🤝 قائمة التجار</div></div>
            <div className="card-body">
              <div className="table-wrap">
                <table className="mobile-cards">
                  <thead><tr><th>#</th><th>اسم التاجر</th><th>الهاتف</th><th>الواتساب</th></tr></thead>
                  <tbody>
                    {merchants.length === 0 ? (
                      <tr><td colSpan={4}><div className="empty"><div className="empty-icon">🤝</div><div className="empty-text">أضف تاجر من تبويب "إضافة تاجر"</div></div></td></tr>
                    ) : merchants.map((m, i) => (
                      <tr key={m.id}>
                        <td data-label="#">{i + 1}</td>
                        <td className="bold" data-label="اسم التاجر">{m.merchant_name}</td>
                        <td data-label="الهاتف">{m.phone || "—"}</td>
                        <td data-label="الواتساب">{m.whatsapp || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "collect" && perm.create && (
        <CollectForm merchants={merchants} />
      )}

      {tab === "history" && (
        <HistoryTab collections={collections} merchants={merchants} />
      )}

      {tab === "incoming" && (
        <IncomingTab txns={incomingTxns} agentName={agentName} agents={agents} />
      )}
      {tab === "outgoing" && (
        <OutgoingTab txns={outgoingTxns} companyName={companyName} companies={companies} />
      )}
      {tab === "statement" && (
        <MerchantStatementTab
          merchants={merchants}
          incomingTxns={incomingTxns}
          outgoingTxns={outgoingTxns}
          collections={collections}
          agents={agents}
          companies={companies}
        />
      )}
    </div>
  );
}

function MerchantForm() {
  const [form, setForm] = useState({
    merchant_name: "", phone: "", whatsapp: "",
    supports_instapay: true, supports_cash_wallet: true, supports_physical_cash: true,
  });
  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.merchant_name.trim()) return toast.error("اسم التاجر مطلوب");
    const { error } = await supabase.from("merchants").insert({
      merchant_name: form.merchant_name,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
      supports_instapay: form.supports_instapay,
      supports_cash_wallet: form.supports_cash_wallet,
      supports_physical_cash: form.supports_physical_cash,
    });
    if (error) return toast.error(error.message);
    setForm({ merchant_name: "", phone: "", whatsapp: "", supports_instapay: true, supports_cash_wallet: true, supports_physical_cash: true });
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">➕ إضافة تاجر</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم التاجر</label><input value={form.merchant_name} onChange={(e) => set("merchant_name", e.target.value)} /></div>
        <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        <div className="form-group full">
          <label style={{ fontWeight: 700, marginBottom: 8 }}>طرق الدفع المتاحة</label>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.supports_instapay} onChange={(e) => set("supports_instapay", e.target.checked)} /> انستا</label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.supports_cash_wallet} onChange={(e) => set("supports_cash_wallet", e.target.checked)} /> كاش</label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.supports_physical_cash} onChange={(e) => set("supports_physical_cash", e.target.checked)} /> نقدي</label>
          </div>
        </div>
      </div>
      <div className="form-footer"><button data-confirm-save="تأكيد حفظ التاجر" className="btn btn-gold" onClick={save}>💾 حفظ التاجر</button></div>
    </div>
  );
}

function CollectForm({ merchants }: { merchants: Merchant[] }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [splits, setSplits] = useState<PaymentSplitRow[]>(() => {
    const r = newPaymentSplitRow();
    r.source = "merchant";
    r.method = "";
    return [r];
  });

  const total = useMemo(
    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [splits],
  );

  const save = async () => {
    const valid = filterValidSplits(splits);
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    for (const r of valid) {
      if (r.source !== "merchant" || !r.merchant_id) {
        return toast.error("كل سطر يجب أن يكون لتاجر محدد");
      }
    }
    const rows = valid.map((r) => {
      const m = merchants.find((x) => x.id === r.merchant_id);
      const methodLabel = methodsForSplit(r, merchants).find((x) => x.key === r.method)?.label || r.method;
      const parts = [methodLabel, note].filter(Boolean);
      return {
        merchant_id: r.merchant_id,
        date,
        amount: Number(r.amount || 0),
        note: parts.join(" - ") || (m ? `تحصيل من ${m.merchant_name}` : null),
      };
    });
    const { error } = await supabase.from("merchant_cash_collections").insert(rows);
    if (error) return toast.error(error.message);
    toast.success("تم حفظ التحصيل");
    const r = newPaymentSplitRow();
    r.source = "merchant";
    r.method = "";
    setSplits([r]);
    setNote("");
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💵 تحصيل نقدية من تاجر</div></div>
      <div className="form-grid">
        <div className="form-group"><label>التاريخ</label><DateInput value={date} onChange={setDate} defaultToday /></div>
        <div className="form-group full"><label>ملاحظات</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} title="وسائل التحصيل" hideSource />
      <div style={{ padding: "0 8px", textAlign: "end", fontWeight: 600 }}>
        الإجمالي: {fmtDL(total)}
      </div>
      <div className="form-footer"><button data-confirm-save="تأكيد حفظ التحصيل" className="btn btn-gold" onClick={save}>💾 حفظ التحصيل</button></div>
    </div>
  );
}

function HistoryTab({ collections, merchants }: { collections: MerchantCashCollection[]; merchants: Merchant[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = collections.filter((c) => (!from || c.date >= from) && (!to || c.date <= to));
  const total = filtered.reduce((s, c) => s + Number(c.amount || 0), 0);
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">📜 سجل التحصيلات النقدية</div></div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
          <div className="form-group"><label>التاريخ من</label><DateInput value={from} onChange={setFrom} /></div>
          <div className="form-group"><label>التاريخ إلى</label><DateInput value={to} onChange={setTo} /></div>
          <div className="form-group" style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn" onClick={() => { setFrom(""); setTo(""); }}>إعادة تعيين</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>التاريخ</th><th>التاجر</th><th>المبلغ</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5}><div className="empty"><div className="empty-text">لا توجد تحصيلات بعد</div></div></td></tr>
              ) : filtered.map((c, i) => (
                <tr key={c.id}>
                  <td data-label="#">{i + 1}</td>
                  <td data-label="التاريخ">{c.date}</td>
                  <td className="bold" data-label="التاجر">{merchants.find((m) => m.id === c.merchant_id)?.merchant_name || "—"}</td>
                  <td data-label="المبلغ">{fmtDL(Number(c.amount || 0))}</td>
                  <td data-label="ملاحظات">{c.note || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>الإجمالي</td><td>{fmtDL(total)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function IncomingTab({ txns, agentName, agents }: { txns: Transaction[]; agentName: (id: string) => string; agents: Agent[] }) {
  const { rows: merchants } = useLive<Merchant>("merchants");
  const mName = (id: string | null) => id ? (merchants.find((m) => m.id === id)?.merchant_name || "—") : "—";
  const [agentId, setAgentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = txns.filter((t) =>
    (!agentId || t.agent_id === agentId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  );
  const total = filtered.reduce((s, t) => s + merchantCashNet(t), 0);
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">⬇️ مدفوعات واردة من وكلاء (تاجر الكاش)</div></div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <SearchableSelect value={agentId} onChange={setAgentId} options={agents.map((a) => ({ value: a.id, label: a.name }))} placeholder="كل الوكلاء" />
          <DateInput value={from} onChange={setFrom} placeholder="من" />
          <DateInput value={to} onChange={setTo} placeholder="إلى" />
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="mobile-cards">
            <thead><tr><th>التاريخ</th><th>اسم الوكيل</th><th>التاجر</th><th>بيان السفر / الوجهة</th><th>قيمة تاجر الكاش</th><th>صافي تاجر الكاش بعد الخصم</th><th>إجمالي المدفوع</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7}><div className="empty"><div className="empty-text">لا توجد حركات</div></div></td></tr>
              ) : filtered.map((t) => (
                <tr key={t.id}>
                  <td data-label="التاريخ">{t.date}</td>
                  <td className="bold" data-label="الوكيل">{agentName(t.agent_id)}</td>
                  <td data-label="التاجر">{mName(t.merchant_id)}</td>
                  <td data-label="بيان">{t.travel_statement || t.destination || "—"}</td>
                  <td data-label="تاجر الكاش">{fmtDL(merchantCashGross(t))}</td>
                  <td data-label="صافي تاجر الكاش بعد الخصم">{fmtDL(merchantCashNet(t))}</td>
                  <td data-label="إجمالي المدفوع">{fmtDL(Number(t.total_paid || 0))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}>الإجمالي (صافي)</td><td>{fmtDL(total)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function OutgoingTab({ txns, companyName, companies }: { txns: CompanyTransaction[]; companyName: (id: string) => string; companies: IssuingCompany[] }) {
  const [companyId, setCompanyId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const mName = (id: string | null) => id ? (merchants.find((m) => m.id === id)?.merchant_name || "—") : "—";
  const filtered = txns.filter((t) =>
    (!companyId || t.company_id === companyId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  );
  const total = filtered.reduce((s, t) => s + merchantCashNet(t), 0);
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">⬆️ مدفوعات صادرة لشركات (تاجر الكاش)</div></div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <SearchableSelect value={companyId} onChange={setCompanyId} options={companies.map((c) => ({ value: c.id, label: c.company_name }))} placeholder="كل الشركات" />
          <DateInput value={from} onChange={setFrom} placeholder="من" />
          <DateInput value={to} onChange={setTo} placeholder="إلى" />
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="mobile-cards">
            <thead><tr><th>التاريخ</th><th>الشركة الصادرة</th><th>التاجر</th><th>بيان السفر / الوجهة</th><th>قيمة تاجر الكاش</th><th>صافي تاجر الكاش بعد الخصم</th><th>إجمالي المدفوع</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7}><div className="empty"><div className="empty-text">لا توجد حركات</div></div></td></tr>
              ) : filtered.map((t) => (
                <tr key={t.id}>
                  <td data-label="التاريخ">{t.date}</td>
                  <td className="bold" data-label="الشركة">{companyName(t.company_id)}</td>
                  <td data-label="التاجر">{mName(t.merchant_id)}</td>
                  <td data-label="بيان">{t.destination || "—"}</td>
                  <td data-label="تاجر الكاش">{fmtDL(merchantCashGross(t))}</td>
                  <td data-label="صافي تاجر الكاش بعد الخصم">{fmtDL(merchantCashNet(t))}</td>
                  <td data-label="إجمالي المدفوع">{fmtDL(Number(t.total_paid || 0))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}>الإجمالي (صافي)</td><td>{fmtDL(total)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function EditMerchantModal({ merchant, onClose }: { merchant: Merchant; onClose: () => void }) {
  const [form, setForm] = useState({
    merchant_name: merchant.merchant_name || "",
    phone: merchant.phone || "",
    whatsapp: merchant.whatsapp || "",
    supports_instapay: merchant.supports_instapay ?? true,
    supports_cash_wallet: merchant.supports_cash_wallet ?? true,
    supports_physical_cash: merchant.supports_physical_cash ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.merchant_name.trim()) return toast.error("اسم التاجر مطلوب");
    setSaving(true);
    const { error } = await supabase.from("merchants").update({
      merchant_name: form.merchant_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      supports_instapay: form.supports_instapay,
      supports_cash_wallet: form.supports_cash_wallet,
      supports_physical_cash: form.supports_physical_cash,
    }).eq("id", merchant.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">✏️ تعديل بيانات التاجر</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم التاجر</label><input value={form.merchant_name} onChange={(e) => set("merchant_name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div className="form-group full">
            <label style={{ fontWeight: 700, marginBottom: 8 }}>طرق الدفع المتاحة</label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.supports_instapay} onChange={(e) => set("supports_instapay", e.target.checked)} /> انستا</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.supports_cash_wallet} onChange={(e) => set("supports_cash_wallet", e.target.checked)} /> كاش</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.supports_physical_cash} onChange={(e) => set("supports_physical_cash", e.target.checked)} /> نقدي</label>
            </div>
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ التعديلات" type="button" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التعديلات</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type StatementMovement = {
  id: string;
  date: string;
  createdAt: string;
  type: "وارد من وكيل" | "صادر لشركة" | "تحصيل نقدي";
  statement: string;
  gross: number;
  commission: number;
  net: number;
  delta: number; // signed effect on merchant balance
};

function MerchantStatementTab({
  merchants, incomingTxns, outgoingTxns, collections, agents, companies,
}: {
  merchants: Merchant[];
  incomingTxns: Transaction[];
  outgoingTxns: CompanyTransaction[];
  collections: MerchantCashCollection[];
  agents: Agent[];
  companies: IssuingCompany[];
}) {
  const [merchantId, setMerchantId] = useState<string>(merchants[0]?.id || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "incoming" | "outgoing" | "collection">("all");
  const [search, setSearch] = useState("");

  const merchant = merchants.find((m) => m.id === merchantId);
  const aName = (id: string) => agents.find((a) => a.id === id)?.name || "—";
  const cName = (id: string) => companies.find((c) => c.id === id)?.company_name || "—";

  const movements: StatementMovement[] = useMemo(() => {
    if (!merchantId) return [];
    const list: StatementMovement[] = [];
    for (const t of incomingTxns) {
      if (t.merchant_id !== merchantId) continue;
      const gross = merchantCashGross(t);
      const net = merchantCashNet(t);
      list.push({
        id: `in-${t.id}`, date: t.date, createdAt: (t as any).created_at || "", type: "وارد من وكيل",
        statement: `${aName(t.agent_id)} — ${t.travel_statement || t.destination || "—"}`,
        gross, commission: gross - net, net, delta: net,
      });
    }
    for (const t of outgoingTxns) {
      if (t.merchant_id !== merchantId) continue;
      const gross = merchantCashGross(t);
      const net = merchantCashNet(t);
      list.push({
        id: `out-${t.id}`, date: t.date, createdAt: (t as any).created_at || "", type: "صادر لشركة",
        statement: `${cName(t.company_id)} — ${t.destination || "—"}`,
        gross, commission: gross - net, net, delta: -net,
      });
    }
    for (const c of collections) {
      if (c.merchant_id !== merchantId) continue;
      const amt = Number(c.amount || 0);
      list.push({
        id: `col-${c.id}`, date: c.date, createdAt: (c as any).created_at || "", type: "تحصيل نقدي",
        statement: c.note || "تحصيل نقدية من التاجر",
        gross: amt, commission: 0, net: amt, delta: -amt,
      });
    }
    return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.createdAt.localeCompare(b.createdAt));
  }, [merchantId, incomingTxns, outgoingTxns, collections, agents, companies]);

  const debouncedSearch = useDebouncedValue(search, 250);
  const filtered = useMemo(() => movements.filter((m) => {
    if (from && m.date < from) return false;
    if (to && m.date > to) return false;
    if (typeFilter === "incoming" && m.type !== "وارد من وكيل") return false;
    if (typeFilter === "outgoing" && m.type !== "صادر لشركة") return false;
    if (typeFilter === "collection" && m.type !== "تحصيل نقدي") return false;
    if (debouncedSearch && !`${m.type} ${m.statement}`.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  }), [movements, from, to, typeFilter, debouncedSearch]);

  // Running balance starts from 0 then accumulates over filtered movements (chronological).
  const withRunning = useMemo(() => {
    let bal = 0;
    return filtered.map((m) => { bal += m.delta; return { ...m, balance: bal }; });
  }, [filtered]);

  const { pageRows: pageMovements, Controls, page, pageSize } = usePagination(withRunning, 50);

  const totalIncoming = filtered.filter((m) => m.type === "وارد من وكيل").reduce((s, m) => s + m.net, 0);
  const totalOutgoing = filtered.filter((m) => m.type === "صادر لشركة").reduce((s, m) => s + m.net, 0);
  const totalCollected = filtered.filter((m) => m.type === "تحصيل نقدي").reduce((s, m) => s + m.net, 0);
  const totalCommission = filtered.reduce((s, m) => s + m.commission, 0);
  const finalBalance = withRunning.length ? withRunning[withRunning.length - 1].balance : 0;

  const buildExport = () => ({
    title: "كشف حساب التاجر",
    subtitle: `${merchant?.merchant_name || ""}${from || to ? ` — من ${from || "..."} إلى ${to || "..."}` : ""}`,
    fileName: `كشف-حساب-${merchant?.merchant_name || "التاجر"}`,
    summary: [
      { label: "إجمالي الوارد", value: fmtDL(totalIncoming) },
      { label: "إجمالي التحصيل", value: fmtDL(totalCollected) },
      { label: "إجمالي الصادر", value: fmtDL(totalOutgoing) },
      { label: "نسبة التاجر (1%)", value: fmtDL(totalCommission) },
      { label: "صافي الرصيد", value: fmtDL(finalBalance) },
    ],
    columns: [
      { header: "#", key: "n" },
      { header: "التاريخ", key: "date" },
      { header: "نوع الحركة", key: "type" },
      { header: "البيان", key: "statement" },
      { header: "المبلغ", key: "gross" },
      { header: "النسبة", key: "commission" },
      { header: "الصافي", key: "net" },
      { header: "الرصيد الحالي", key: "balance" },
    ],
    rows: withRunning.map((m, i) => ({
      n: i + 1, date: m.date, type: m.type, statement: m.statement,
      gross: fmtDL(m.gross), gross__excel: m.gross,
      commission: fmtDL(m.commission), commission__excel: m.commission,
      net: fmtDL(m.net), net__excel: m.net,
      balance: fmtDL(m.balance), balance__excel: m.balance,
    })),
  });

  if (merchants.length === 0) {
    return (
      <div className="card"><div className="card-body"><div className="empty"><div className="empty-icon">🤝</div><div className="empty-text">أضف تاجرًا أولاً لعرض كشف الحساب</div></div></div></div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><FileText size={18} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} /> كشف حساب التاجر</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ExportButton disabled={withRunning.length === 0} getData={buildExport} />
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>التاجر</label>
              <select value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
                {merchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label><Calendar size={12} /> من تاريخ</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="form-group"><label><Calendar size={12} /> إلى تاريخ</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="form-group">
              <label>نوع الحركة</label>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
                <option value="all">كل الحركات</option>
                <option value="incoming">وارد من وكيل</option>
                <option value="outgoing">صادر لشركة</option>
                <option value="collection">تحصيل نقدي</option>
              </select>
            </div>
            <div className="form-group full"><label><Search size={12} /> بحث سريع</label><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث في البيان أو نوع الحركة..." /></div>
          </div>

          {merchant && (
            <div className="two-col" style={{ marginBottom: 16 }}>
              <div>
                <div className="stat-row"><span className="stat-key">اسم التاجر</span><span className="stat-val bold">{merchant.merchant_name}</span></div>
                <div className="stat-row"><span className="stat-key"><Phone size={12} /> الهاتف</span><span className="stat-val">{merchant.phone || "—"}</span></div>
                <div className="stat-row"><span className="stat-key">الواتساب</span><span className="stat-val">{merchant.whatsapp || "—"}</span></div>
              </div>
              <div>
                <div className="stat-row"><span className="stat-key"><Percent size={12} /> نسبة التاجر</span><span className="stat-val">1%</span></div>
                <div className="stat-row"><span className="stat-key">تاريخ إنشاء الحساب</span><span className="stat-val">{merchant.created_at ? String(merchant.created_at).slice(0, 10) : "—"}</span></div>
                <div className="stat-row"><span className="stat-key">الرصيد الحالي</span><span className="stat-val bold" style={{ color: finalBalance >= 0 ? "#15803D" : "#B91C1C" }}>{fmtDL(finalBalance)}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="account-summary kpi-rich">
        <div className="sum-box green">
          <span className="kpi-icon"><ArrowDownCircle size={20} /></span>
          <div className="kpi-text"><div className="label">إجمالي الوارد</div><div className="val">{fmtDL(totalIncoming)}</div></div>
        </div>
        <div className="sum-box gold">
          <span className="kpi-icon"><Banknote size={20} /></span>
          <div className="kpi-text"><div className="label">إجمالي التحصيل</div><div className="val">{fmtDL(totalCollected)}</div></div>
        </div>
        <div className="sum-box red">
          <span className="kpi-icon"><Percent size={20} /></span>
          <div className="kpi-text"><div className="label">نسبة التاجر (1%)</div><div className="val">{fmtDL(totalCommission)}</div></div>
        </div>
        <div className="sum-box hero">
          <span className="kpi-icon"><Wallet size={22} /></span>
          <div className="kpi-text">
            <div className="label">صافي الرصيد</div>
            <div className="val">{fmtDL(finalBalance)}</div>
            <div className="kpi-sub">الرصيد بعد كل الحركات المعروضة</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">💳 الحركات المالية</div></div>
        <div className="card-body">
          <div className="table-wrap enterprise-table">
            <table className="mobile-cards">
              <thead><tr><th>#</th><th>التاريخ</th><th>نوع الحركة</th><th>البيان</th><th className="num-col">المبلغ</th><th className="num-col">النسبة</th><th className="num-col">الصافي</th><th className="num-col">الرصيد الحالي</th></tr></thead>
              <tbody>
                {withRunning.length === 0 ? (
                  <tr><td colSpan={8}><div className="empty"><div className="empty-icon">💳</div><div className="empty-text">لا توجد حركات مطابقة</div></div></td></tr>
                ) : pageMovements.map((m, i) => {
                  const idx = page * pageSize + i;
                  const color = m.type === "وارد من وكيل" ? "#15803D" : "#B91C1C";
                  return (
                    <tr key={m.id}>
                      <td data-label="#">{idx + 1}</td>
                      <td data-label="التاريخ">{m.date}</td>
                      <td data-label="نوع الحركة"><span className="badge">{m.type}</span></td>
                      <td data-label="البيان">{m.statement}</td>
                      <td className="num-col" data-label="المبلغ">{fmtDL(m.gross)}</td>
                      <td className="num-col" data-label="النسبة">{fmtDL(m.commission)}</td>
                      <td className="num-col" data-label="الصافي" style={{ color, fontWeight: 700 }}>{m.delta >= 0 ? "+" : "-"}{fmtDL(Math.abs(m.delta))}</td>
                      <td className="num-col" data-label="الرصيد" style={{ fontWeight: 800, color: m.balance >= 0 ? "#15803D" : "#B91C1C" }}>{fmtDL(m.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>الإجمالي</td><td className="num-col">{fmtDL(filtered.reduce((s, m) => s + m.gross, 0))}</td><td className="num-col">{fmtDL(totalCommission)}</td><td className="num-col">{fmtDL(totalIncoming - totalOutgoing - totalCollected)}</td><td className="num-col">{fmtDL(finalBalance)}</td></tr>
              </tfoot>
            </table>
          </div>
          <Controls />
        </div>
      </div>
    </>
  );
}
