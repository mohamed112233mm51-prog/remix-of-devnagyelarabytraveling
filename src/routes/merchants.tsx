import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDL, fmtCurrency, merchantCashGross, merchantCashNet, merchantCompanyOutflowAmount, useLive, normalizeCurrency,
  type Agent, type IssuingCompany, type Merchant, type MerchantCashCollection,
  type Transaction, type CompanyTransaction, type UsdTreasuryTransaction,
} from "@/lib/db";
import { useMerchantAggregates, useMerchantTotals, summarizeMerchantCollectionsPeriod, summarizeMerchantIncomingPeriod, summarizeMerchantOutgoingPeriod, summarizeMerchantMovementTotals } from "@/lib/financialSummary";

import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { Handshake, ArrowDownCircle, ArrowUpCircle, Banknote, Wallet, UserPlus, Users, Receipt, ArrowDownLeft, ArrowUpRight, ListChecks, FileText, Search, Calendar, Percent, Phone, ArrowUpFromLine } from "lucide-react";
import { MerchantCashOutForm } from "@/components/CashMovementForms";
import { ExportButton } from "@/components/ExportButton";
import { buildArabicFileName } from "@/lib/exportStatement";
import CurrencyFilter from "@/components/CurrencyFilter";
import {
  PaymentSplits,
  newPaymentSplitRow,
  validatePaymentSplits,
  filterValidSplits,
  methodsForSplit,
  type PaymentSplitRow,
} from "@/components/PaymentSplits";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { ColumnVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { syncMerchantOpeningBalance } from "@/lib/openingBalance";
import { CancelTransactionButton } from "@/components/CancelTransactionButton";
import { EditTransactionButton } from "@/components/EditTransactionButton";
import type { CancellableTable } from "@/lib/financialEngine.cancel";
import { CurrencyTotalsCards, type CurrencyTotal } from "@/components/CurrencyTotalsCards";

const MERCHANT_STATEMENT_COLUMNS: ColumnDef[] = [
  { key: "n", label: "#" },
  { key: "date", label: "التاريخ" },
  { key: "type", label: "نوع الحركة" },
  { key: "statement", label: "البيان" },
  { key: "gross", label: "المبلغ" },
  { key: "commission", label: "النسبة" },
  { key: "net", label: "الصافي" },
  { key: "balance", label: "الرصيد الحالي" },
  { key: "actions", label: "إجراءات" },
];
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
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const [tab, setTab] = useState<"list" | "add" | "collect" | "cashout" | "history" | "incoming" | "outgoing" | "statement">("history");
  const [editMerchant, setEditMerchant] = useState<Merchant | null>(null);
  // Unified financial engine — نفس النتائج السابقة، مصدر واحد للحساب.
  const merchantTotals = useMerchantAggregates();
  const kpi = useMerchantTotals();
  const totalIncoming = kpi.incoming;
  const totalOutgoing = kpi.outgoing;
  const totalCollected = kpi.collected;
  const totalPaidOut = kpi.paidOut;
  const totalConverted = kpi.converted;
  const balance = kpi.balance;

  // Local helpers still needed by list/history sub-sections (filters only, not KPIs).
  const merchantCompanyOutSourceIds = useMemo(
    () => new Set(
      txns
        .filter((t) => t.merchant_id && t.source_service_type === "merchant_cash_out_to_company")
        .map((t) => (t as any).source_service_id)
        .filter(Boolean),
    ),
    [txns],
  );
  const incomingTxns = useMemo(() => txns.filter((t) => Number(t.merchant_cash_amount || 0) > 0 || Number(t.merchant_cash_physical_amount || 0) > 0), [txns]);
  const outgoingTxns = useMemo(
    () => cTxns.filter((t) => merchantCompanyOutflowAmount(t) > 0),
    [cTxns],
  );
  const statementOutgoingTxns = useMemo(
    () => outgoingTxns.filter((t) => !merchantCompanyOutSourceIds.has(t.id)),
    [outgoingTxns, merchantCompanyOutSourceIds],
  );
  const cashMoveTxns = useMemo(
    () => txns.filter((t) => t.merchant_id && (t.source_service_type === "merchant_cash_out" || t.source_service_type === "merchant_cash_out_to_company" || t.source_service_type === "merchant_cash_out_to_agent")),
    [txns],
  );


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
        <div className="sum-box red">
          <span className="kpi-icon"><ArrowUpFromLine size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">النقدية المصروفة للتجار</div><div className="val">{fmtDL(totalPaidOut)}</div></div>
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
        {perm.create && (
          <div className={`tool-tab ${tab === "cashout" ? "active" : ""}`} onClick={() => setTab("cashout")}>
            <ArrowUpFromLine size={15} strokeWidth={2} /> <span>صرف نقدية</span>
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
                <thead><tr><th>#</th><th>اسم التاجر</th><th>الهاتف</th><th>الواتساب</th><th className="num-col">إجمالي الوارد</th><th className="num-col">إجمالي الصادر</th><th className="num-col">إجمالي النقدية المحصلة</th><th className="num-col">الرصيد</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                <tbody>
                  {merchants.length === 0 ? (
                    <tr><td colSpan={10}><div className="empty"><div className="empty-icon">🤝</div><div className="empty-text">لا يوجد تجار</div></div></td></tr>
                  ) : merchants.map((m, i) => {
                    const t = merchantTotals.get(m.id) || { incoming: 0, outgoing: 0, collected: 0, paidOut: 0, converted: 0 };
                    const bal = t.incoming + t.paidOut - t.collected - t.outgoing - t.converted;
                    return (
                      <tr key={m.id}>
                        <td data-label="#">{i + 1}</td>
                        <td className="bold" data-label="اسم التاجر">{m.merchant_name}</td>
                        <td data-label="الهاتف">{m.phone || "—"}</td>
                        <td data-label="الواتساب">{m.whatsapp || "—"}</td>
                        <td className="num-col" data-label="إجمالي الوارد" style={{ color: "#15803D", fontWeight: 700 }}>{fmtDL(t.incoming)}</td>
                        <td className="num-col" data-label="إجمالي الصادر" style={{ color: "#B91C1C", fontWeight: 700 }}>{fmtDL(t.outgoing + t.converted)}</td>
                        <td className="num-col" data-label="إجمالي النقدية المحصلة" style={{ color: "#B45309", fontWeight: 700 }}>{fmtDL(t.collected)}</td>
                        <td className="num-col" data-label="الرصيد" style={{ fontWeight: 800, color: bal >= 0 ? "#15803D" : "#B91C1C" }}>{fmtDL(bal)}</td>
                        <td data-label="الحالة"><span className={`badge pill-badge ${((m as any).status || "نشط") === "نشط" ? "badge-green" : "badge-red"}`}>{(m as any).status || "نشط"}</span></td>
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

      {tab === "cashout" && perm.create && (
        <MerchantCashOutForm onDone={() => setTab("history")} />
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
          outgoingTxns={statementOutgoingTxns}
          cashMoveTxns={cashMoveTxns}
          collections={collections}
          conversions={usdRows}
        />
      )}
    </div>
  );
}

function MerchantForm() {
  const [form, setForm] = useState({
    merchant_name: "", phone: "", whatsapp: "",
    supports_instapay: true, supports_cash_wallet: true, supports_physical_cash: true,
    status: "نشط",
    opening_kind: "" as "" | "debit" | "credit",
    opening_amount: "",
    opening_currency: "EGP", opening_date: "", opening_note: "",
  });
  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.merchant_name.trim()) return toast.error("اسم التاجر مطلوب");
    const amount = Math.max(0, Number(form.opening_amount) || 0);
    const hasOpening = !!form.opening_kind || amount > 0;
    if (hasOpening) {
      if (!form.opening_kind) return toast.error("اختر نوع الرصيد (مدين / دائن)");
      if (!(amount > 0)) return toast.error("أدخل مبلغ الرصيد السابق");
      if (!form.opening_currency) return toast.error("اختر عملة الرصيد السابق");
      if (!form.opening_date) return toast.error("أدخل تاريخ الرصيد السابق");
    }
    const debit = form.opening_kind === "debit" ? amount : 0;
    const credit = form.opening_kind === "credit" ? amount : 0;
    const { data, error } = await supabase.from("merchants").insert({
      merchant_name: form.merchant_name,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
      supports_instapay: form.supports_instapay,
      supports_cash_wallet: form.supports_cash_wallet,
      supports_physical_cash: form.supports_physical_cash,
      status: form.status || "نشط",
      opening_debit: debit,
      opening_credit: credit,
      opening_currency: form.opening_currency || "EGP",
      opening_date: form.opening_date || null,
      opening_note: form.opening_note || null,
    } as any).select("id").maybeSingle();
    if (error) return toast.error(error.message);
    if (data?.id && (debit > 0 || credit > 0)) {
      try {
        await syncMerchantOpeningBalance((data as any).id, {
          debit, credit,
          currency: form.opening_currency || "EGP",
          date: form.opening_date || null,
          note: form.opening_note || null,
        });
      } catch (e: any) {
        toast.error(String(e?.message || "").includes("ux_merchant_opening_row")
          ? "يوجد رصيد سابق لهذه الجهة بهذه العملة"
          : (e?.message || "فشل حفظ الرصيد السابق"));
      }
    }
    setForm({
      merchant_name: "", phone: "", whatsapp: "",
      supports_instapay: true, supports_cash_wallet: true, supports_physical_cash: true,
      status: "نشط",
      opening_kind: "", opening_amount: "",
      opening_currency: "EGP", opening_date: "", opening_note: "",
    });
    toast.success("تم حفظ التاجر");
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">➕ إضافة تاجر</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم التاجر</label><input value={form.merchant_name} onChange={(e) => set("merchant_name", e.target.value)} /></div>
        <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        <div className="form-group"><label>الحالة</label>
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="نشط">نشط</option>
            <option value="غير نشط">غير نشط</option>
          </select>
        </div>
        <div className="form-group full">
          <label style={{ fontWeight: 700, marginBottom: 8 }}>طرق الدفع المتاحة</label>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", whiteSpace: "nowrap", height: 42, fontSize: 14 }}><input type="checkbox" checked={form.supports_physical_cash} onChange={(e) => set("supports_physical_cash", e.target.checked)} /> نقدي</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", whiteSpace: "nowrap", height: 42, fontSize: 14 }}><input type="checkbox" checked={form.supports_instapay} onChange={(e) => set("supports_instapay", e.target.checked)} /> انستا</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", whiteSpace: "nowrap", height: 42, fontSize: 14 }}><input type="checkbox" checked={form.supports_cash_wallet} onChange={(e) => set("supports_cash_wallet", e.target.checked)} /> فودافون كاش</label>
          </div>
        </div>
        <div className="form-group full" style={{ marginTop: 8, padding: 12, border: "1px dashed var(--border)", borderRadius: 8 }}>
          <label style={{ fontWeight: 700, marginBottom: 8 }}>رصيد سابق (اختياري)</label>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <div className="form-group full">
              <label>نوع الرصيد</label>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="radio" name="mrc-open-kind" checked={form.opening_kind === "debit"} onChange={() => set("opening_kind", "debit")} /> مدين</label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="radio" name="mrc-open-kind" checked={form.opening_kind === "credit"} onChange={() => set("opening_kind", "credit")} /> دائن</label>
                {form.opening_kind && (
                  <button type="button" className="action-btn" onClick={() => set("opening_kind", "")}>مسح</button>
                )}
              </div>
            </div>
            <div className="form-group"><label>المبلغ</label><input type="number" min={0} value={form.opening_amount} onChange={(e) => set("opening_amount", e.target.value)} /></div>
            <div className="form-group"><label>العملة</label>
              <select value={form.opening_currency} onChange={(e) => set("opening_currency", e.target.value)}>
                <option value="EGP">جنيه مصري</option>
                <option value="USD">دولار أمريكي</option>
                <option value="LYD">دينار ليبي</option>
              </select>
            </div>
            <div className="form-group"><label>التاريخ</label><input type="date" value={form.opening_date} onChange={(e) => set("opening_date", e.target.value)} /></div>
            <div className="form-group full"><label>ملاحظات</label><input value={form.opening_note} onChange={(e) => set("opening_note", e.target.value)} /></div>
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
  const [statement, setStatement] = useState("");
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

    // 1) Insert merchant_cash_collections rows (merchant balance is aggregated from this table).
    const rows = valid.map((r) => ({
      merchant_id: r.merchant_id,
      date,
      amount: Number(r.amount || 0),
      note: note.trim() ? note.trim() : null,
      statement: statement.trim() ? statement.trim() : null,
    }));
    const { data: inserted, error } = await supabase
      .from("merchant_cash_collections")
      .insert(rows)
      .select("id, merchant_id, amount");
    if (error) return toast.error(error.message);

    // 2) Mirror each row into payment_splits via the Financial Engine
    //    so the movement appears in unified financial logs (no cash_box impact
    //    because collections drain a merchant wallet, not a company treasury).
    const methodLabelFor = (m: string): string => {
      if (m === "merchant_instapay") return "انستا";
      if (m === "merchant_wallet") return "فودافون كاش";
      if (m === "merchant_physical") return "نقدي";
      return "نقدي";
    };
    for (let i = 0; i < valid.length; i++) {
      const row = valid[i];
      const dbRow = (inserted as any[])?.[i];
      if (!dbRow) continue;
      const engineSplits: MovementSplit[] = [{
        method: methodLabelFor(row.method),
        currency: "EGP",
        cashBoxId: null,
        amount: Number(row.amount || 0),
        direction: "in",
        grossAmount: Number(row.amount || 0),
        netAmount: Number(row.amount || 0),
        exchangeRate: 1,
        egpEquivalent: Number(row.amount || 0),
      }];
      const res = await postMovement({
        partyType: "merchant",
        partyId: row.merchant_id,
        kind: "receipt",
        date,
        statement: statement.trim() || undefined,
        note: note.trim() || undefined,
        splits: engineSplits,
        sourceTable: "merchant_cash_collections",
        sourceId: dbRow.id,
      });
      if (!res.ok) {
        toast.error(res.error || "تعذر تسجيل الحركة في السجل المالي");
      }
    }

    toast.success("تم حفظ التحصيل");
    const r = newPaymentSplitRow();
    r.source = "merchant";
    r.method = "";
    setSplits([r]);
    setNote("");
    setStatement("");
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💵 تحصيل نقدية من تاجر</div></div>
      <div className="form-grid">
        <div className="form-group"><label>التاريخ</label><DateInput value={date} onChange={setDate} defaultToday /></div>
        <div className="form-group full"><label>البيان</label><input value={statement} onChange={(e) => setStatement(e.target.value)} /></div>
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
  const { filtered, total } = useMemo(
    () => summarizeMerchantCollectionsPeriod(collections, from, to),
    [collections, from, to],
  );
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
            <thead><tr><th>#</th><th>التاريخ</th><th>التاجر</th><th>المبلغ</th><th>البيان</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6}><div className="empty"><div className="empty-text">لا توجد تحصيلات بعد</div></div></td></tr>
              ) : filtered.map((c, i) => (
                <tr key={c.id}>
                  <td data-label="#">{i + 1}</td>
                  <td data-label="التاريخ">{c.date}</td>
                  <td className="bold" data-label="التاجر">{merchants.find((m) => m.id === c.merchant_id)?.merchant_name || "—"}</td>
                  <td data-label="المبلغ">{fmtDL(Number(c.amount || 0))}</td>
                  <td data-label="البيان">{(c as any).statement || ""}</td>
                  <td data-label="ملاحظات">{c.note || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>الإجمالي</td><td>{fmtDL(total)}</td><td colSpan={2}></td></tr></tfoot>
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
  const { filtered, total } = useMemo(
    () => summarizeMerchantIncomingPeriod(txns, agentId, from, to),
    [txns, agentId, from, to],
  );
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
                  <td data-label="بيان">{(t as any).statement || ""}</td>
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
  const { filtered, total } = useMemo(
    () => summarizeMerchantOutgoingPeriod(txns, companyId, from, to),
    [txns, companyId, from, to],
  );
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
                  <td data-label="بيان">{(t as any).statement || ""}</td>
                  <td data-label="تاجر الكاش">{fmtCurrency(merchantCompanyOutflowAmount(t), normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP"))}</td>
                  <td data-label="صافي تاجر الكاش بعد الخصم">{fmtCurrency(merchantCompanyOutflowAmount(t), normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP"))}</td>
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
  const m: any = merchant;
  const [form, setForm] = useState({
    merchant_name: merchant.merchant_name || "",
    phone: merchant.phone || "",
    whatsapp: merchant.whatsapp || "",
    supports_instapay: merchant.supports_instapay ?? true,
    supports_cash_wallet: merchant.supports_cash_wallet ?? true,
    supports_physical_cash: merchant.supports_physical_cash ?? true,
    status: m.status || "نشط",
    opening_kind: (Number(m.opening_debit) > 0 ? "debit" : Number(m.opening_credit) > 0 ? "credit" : "") as "" | "debit" | "credit",
    opening_amount: Number(m.opening_debit) > 0 ? String(m.opening_debit) : Number(m.opening_credit) > 0 ? String(m.opening_credit) : "",
    opening_currency: m.opening_currency || "EGP",
    opening_date: m.opening_date || "",
    opening_note: m.opening_note || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.merchant_name.trim()) return toast.error("اسم التاجر مطلوب");
    const amount = Math.max(0, Number(form.opening_amount) || 0);
    const hasOpening = !!form.opening_kind || amount > 0;
    if (hasOpening) {
      if (!form.opening_kind) { return toast.error("اختر نوع الرصيد (مدين / دائن)"); }
      if (!(amount > 0)) { return toast.error("أدخل مبلغ الرصيد السابق"); }
      if (!form.opening_currency) { return toast.error("اختر عملة الرصيد السابق"); }
      if (!form.opening_date) { return toast.error("أدخل تاريخ الرصيد السابق"); }
    }
    setSaving(true);
    const debit = form.opening_kind === "debit" ? amount : 0;
    const credit = form.opening_kind === "credit" ? amount : 0;
    const { error } = await supabase.from("merchants").update({
      merchant_name: form.merchant_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      supports_instapay: form.supports_instapay,
      supports_cash_wallet: form.supports_cash_wallet,
      supports_physical_cash: form.supports_physical_cash,
      status: form.status || "نشط",
      opening_debit: debit,
      opening_credit: credit,
      opening_currency: form.opening_currency || "EGP",
      opening_date: form.opening_date || null,
      opening_note: form.opening_note || null,
    } as any).eq("id", merchant.id);
    if (error) { setSaving(false); return toast.error(error.message); }
    try {
      await syncMerchantOpeningBalance(merchant.id, {
        debit, credit,
        currency: form.opening_currency || "EGP",
        date: form.opening_date || null,
        note: form.opening_note || null,
      });
    } catch (e: any) {
      setSaving(false);
      return toast.error(String(e?.message || "").includes("ux_merchant_opening_row")
        ? "يوجد رصيد سابق لهذه الجهة بهذه العملة"
        : (e?.message || "فشل حفظ الرصيد السابق"));
    }
    setSaving(false);
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
          <div className="form-group"><label>الحالة</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="نشط">نشط</option>
              <option value="غير نشط">غير نشط</option>
            </select>
          </div>
          <div className="form-group full">
            <label style={{ fontWeight: 700, marginBottom: 8 }}>طرق الدفع المتاحة</label>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", whiteSpace: "nowrap", height: 42, fontSize: 14 }}><input type="checkbox" checked={form.supports_physical_cash} onChange={(e) => set("supports_physical_cash", e.target.checked)} /> نقدي</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", whiteSpace: "nowrap", height: 42, fontSize: 14 }}><input type="checkbox" checked={form.supports_instapay} onChange={(e) => set("supports_instapay", e.target.checked)} /> انستا</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", whiteSpace: "nowrap", height: 42, fontSize: 14 }}><input type="checkbox" checked={form.supports_cash_wallet} onChange={(e) => set("supports_cash_wallet", e.target.checked)} /> فودافون كاش</label>
            </div>
          </div>
          <div className="form-group full" style={{ marginTop: 8, padding: 12, border: "1px dashed var(--border)", borderRadius: 8 }}>
            <label style={{ fontWeight: 700, marginBottom: 8 }}>رصيد سابق</label>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <div className="form-group full">
                <label>نوع الرصيد</label>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="radio" name="mrc-edit-open-kind" checked={form.opening_kind === "debit"} onChange={() => set("opening_kind", "debit")} /> مدين</label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="radio" name="mrc-edit-open-kind" checked={form.opening_kind === "credit"} onChange={() => set("opening_kind", "credit")} /> دائن</label>
                  {form.opening_kind && (
                    <button type="button" className="action-btn" onClick={() => set("opening_kind", "")}>مسح</button>
                  )}
                </div>
              </div>
              <div className="form-group"><label>المبلغ</label><input type="number" min={0} value={form.opening_amount} onChange={(e) => set("opening_amount", e.target.value)} /></div>
              <div className="form-group"><label>العملة</label>
                <select value={form.opening_currency} onChange={(e) => set("opening_currency", e.target.value)}>
                  <option value="EGP">جنيه مصري</option>
                  <option value="USD">دولار أمريكي</option>
                  <option value="LYD">دينار ليبي</option>
                </select>
              </div>
              <div className="form-group"><label>التاريخ</label><input type="date" value={form.opening_date} onChange={(e) => set("opening_date", e.target.value)} /></div>
              <div className="form-group full"><label>ملاحظات</label><input value={form.opening_note} onChange={(e) => set("opening_note", e.target.value)} /></div>
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
  type: "وارد من وكيل" | "صادر لشركة" | "تحصيل نقدية من التاجر" | "صرف نقدية للتاجر" | "صرف نقدية لوكيل" | "تحويل لـ USD" | "رصيد سابق";
  statement: string;
  gross: number;
  commission: number;
  net: number;
  delta: number; // signed effect on merchant balance (EGP)
  currency: string; // "EGP" by default; opening rows carry the user-chosen currency
  sourceTable: CancellableTable;
  sourceId: string;
};


function MerchantStatementTab({
  merchants, incomingTxns, outgoingTxns, cashMoveTxns, collections, conversions,
}: {
  merchants: Merchant[];
  incomingTxns: Transaction[];
  outgoingTxns: CompanyTransaction[];
  cashMoveTxns: Transaction[];
  collections: MerchantCashCollection[];
  conversions: UsdTreasuryTransaction[];
}) {
  const [merchantId, setMerchantId] = useState<string>(merchants[0]?.id || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "incoming" | "outgoing" | "collection" | "cashout" | "conversion">("all");
  const [currencyFilter, setCurrencyFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const merchant = merchants.find((m) => m.id === merchantId);
  const movements: StatementMovement[] = useMemo(() => {
    if (!merchantId) return [];
    const list: StatementMovement[] = [];
    for (const t of incomingTxns) {
      if (t.merchant_id !== merchantId) continue;
      if ((t as any).cancelled_at) continue;
      const gross = merchantCashGross(t) + Number(t.merchant_cash_physical_amount || 0);
      const net = merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
      const cur = normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP");
      list.push({
        id: `in-${t.id}`, date: t.date, createdAt: (t as any).created_at || "", type: "وارد من وكيل",
        statement: String((t as any).statement || "").trim(),
        gross, commission: gross - net, net, delta: net, currency: cur,
        sourceTable: "transactions", sourceId: t.id,
      });
    }
    for (const t of outgoingTxns) {
      if (t.merchant_id !== merchantId) continue;
      if ((t as any).cancelled_at) continue;
      const gross = merchantCompanyOutflowAmount(t);
      const net = merchantCompanyOutflowAmount(t);
      const cur = normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP");
      list.push({
        id: `out-${t.id}`, date: t.date, createdAt: (t as any).created_at || "", type: "صادر لشركة",
        statement: String((t as any).statement || "").trim(),
        gross, commission: gross - net, net, delta: -net, currency: cur,
        sourceTable: "company_transactions", sourceId: t.id,
      });
    }
    for (const c of collections) {
      if (c.merchant_id !== merchantId) continue;
      if ((c as any).cancelled_at) continue;
      const amt = Number(c.amount || 0);
      const isOpening = ((c as any).source_service_type === "opening_debit" || (c as any).source_service_type === "opening_credit");
      const rowCurrency = normalizeCurrency(isOpening ? (c as any).opening_currency : (c as any).currency);
      list.push({
        id: `col-${c.id}`, date: c.date, createdAt: (c as any).created_at || "",
        type: isOpening ? "رصيد سابق" : "تحصيل نقدية من التاجر",
        statement: isOpening ? `رصيد سابق (${rowCurrency})` : String((c as any).statement || "").trim(),
        gross: Math.abs(amt), commission: 0, net: Math.abs(amt), delta: -amt, currency: rowCurrency,
        sourceTable: "merchant_cash_collections", sourceId: c.id,
      });
    }

    for (const t of cashMoveTxns) {
      if (t.merchant_id !== merchantId) continue;
      if ((t as any).cancelled_at) continue;
      const amt = Math.abs(Number(t.paid || 0));
      if (amt <= 0) continue;
      const cur = normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP");
      const toCompany = t.source_service_type === "merchant_cash_out_to_company";
      const toAgent = t.source_service_type === "merchant_cash_out_to_agent";
      const type = toCompany ? "صادر لشركة" : toAgent ? "صرف نقدية لوكيل" : "صرف نقدية للتاجر";
      const delta = (toCompany || toAgent) ? -amt : amt;
      list.push({
        id: `cashout-${t.id}`, date: t.date, createdAt: (t as any).created_at || "",
        type,
        statement: String((t as any).statement || "").trim(),
        gross: amt, commission: 0, net: amt, delta, currency: cur,
        sourceTable: "transactions", sourceId: t.id,
      });
    }
    for (const r of conversions) {
      if (r.type !== "conversion" || r.merchant_id !== merchantId) continue;
      if ((r as any).cancelled_at) continue;
      if (r.source_type !== "merchant_wallet" && r.source_type !== "merchant_physical") continue;
      const amt = Number(r.egp_amount || 0);
      list.push({
        id: `conv-${r.id}`, date: r.date, createdAt: (r as any).created_at || "", type: "تحويل لـ USD",
        statement: String((r as any).statement || "").trim(),
        gross: amt, commission: 0, net: amt, delta: -amt, currency: "EGP",
        sourceTable: "usd_treasury_transactions", sourceId: r.id,
      });
    }
    return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.createdAt.localeCompare(b.createdAt));
  }, [merchantId, incomingTxns, outgoingTxns, cashMoveTxns, collections, conversions]);

  const debouncedSearch = useDebouncedValue(search, 250);
  const filtered = useMemo(() => movements.filter((m) => {
    if (from && m.date < from) return false;
    if (to && m.date > to) return false;
    if (typeFilter === "incoming" && m.type !== "وارد من وكيل") return false;
    if (typeFilter === "outgoing" && m.type !== "صادر لشركة") return false;
    if (typeFilter === "collection" && m.type !== "تحصيل نقدية من التاجر") return false;
    if (typeFilter === "cashout" && m.type !== "صرف نقدية للتاجر") return false;
    if (typeFilter === "conversion" && m.type !== "تحويل لـ USD") return false;
    if (currencyFilter && (m.currency || "EGP") !== currencyFilter) return false;
    if (debouncedSearch && !`${m.type} ${m.statement}`.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  }), [movements, from, to, typeFilter, currencyFilter, debouncedSearch]);
  const currencyOptions = useMemo(
    () => Array.from(new Set(movements.map((m) => m.currency || "EGP"))).sort(),
    [movements],
  );

  // Per-currency running balance. Each currency accumulates independently so
  // EGP, USD, LYD, ... never mix into a single total.
  const withRunning = useMemo(() => {
    const bals = new Map<string, number>();
    return filtered.map((m) => {
      const cur = m.currency || "EGP";
      const next = (bals.get(cur) || 0) + m.delta;
      bals.set(cur, next);
      return { ...m, balance: next, countsInEgp: cur === "EGP" };
    });
  }, [filtered]);

  const { pageRows: pageMovements, Controls, page, pageSize } = usePagination(withRunning, 50);

  const totals = useMemo(() => summarizeMerchantMovementTotals(filtered), [filtered]);
  const totalIncoming = totals.totalIncoming;
  const totalOutgoing = totals.totalOutgoing;
  const totalCollected = totals.totalCollected;
  const totalPaidOut = totals.totalPaidOut;
  const totalConverted = totals.totalConverted;
  const totalCommission = totals.totalCommission;
  const byCurrency = totals.byCurrency as CurrencyTotal[];

  // Per-currency final balances (last row of each currency) — display-only.
  const finalByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of withRunning) map.set(m.currency || "EGP", m.balance);
    return Array.from(map.entries());
  }, [withRunning]);
  const finalBalance = finalByCurrency.find(([c]) => c === "EGP")?.[1] ?? 0;

  const [visible, setVisible] = usePersistentColumnVisibility("merchant-statement", MERCHANT_STATEMENT_COLUMNS);
  const isVisible = (k: string) => visible[k] !== false;
  const visibleCount = MERCHANT_STATEMENT_COLUMNS.filter((c) => isVisible(c.key)).length;

  const buildExport = () => ({
    title: `كشف حساب تاجر الكاش${merchant?.merchant_name ? ` — ${merchant.merchant_name}` : ""}${currencyFilter ? ` (${currencyFilter})` : ""}`,
    subtitle: `${merchant?.merchant_name || ""}${from || to ? ` — من ${from || "..."} إلى ${to || "..."}` : ""}`,
    fileName: buildArabicFileName("كشف حساب تاجر الكاش", merchant?.merchant_name, currencyFilter),
    summary: (() => {
      const CUR_NAMES: Record<string, string> = {
        EGP: "الجنيه المصري",
        USD: "الدولار الأمريكي",
        LYD: "الدينار الليبي",
      };
      const LABELS = { debit: "مستحق على التاجر", credit: "مستحق للتاجر", balanced: "متوازن" };
      const base = [
        { label: "إجمالي الوارد", value: fmtDL(totalIncoming) },
        { label: "النقدية المحصلة من التاجر", value: fmtDL(totalCollected) },
        { label: "إجمالي الصادر للشركات", value: fmtDL(totalOutgoing) },
        { label: "النقدية المصروفة للتاجر", value: fmtDL(totalPaidOut) },
        { label: "نسبة التاجر (1%)", value: fmtDL(totalCommission) },
      ];
      const perCurrency = byCurrency.flatMap((t) => {
        const name = CUR_NAMES[t.currency] || t.currency;
        const status = t.net > 0 ? LABELS.debit : t.net < 0 ? LABELS.credit : LABELS.balanced;
        return [
          { label: `— ${name} —`, value: "" },
          { label: `مدين (${name})`, value: fmtCurrency(t.debit, t.currency) },
          { label: `دائن (${name})`, value: fmtCurrency(t.credit, t.currency) },
          { label: `الصافي (${name})`, value: fmtCurrency(Math.abs(t.net), t.currency) },
          { label: `حالة الحساب (${name})`, value: status },
          { label: `عدد الحركات (${name})`, value: String(t.count ?? 0) },
        ];
      });
      return [...base, ...perCurrency];
    })(),
    columns: ([
      { header: "#", key: "n" },
      { header: "التاريخ", key: "date" },
      { header: "نوع الحركة", key: "type" },
      { header: "البيان", key: "statement" },
      { header: "المبلغ", key: "gross" },
      { header: "النسبة", key: "commission" },
      { header: "الصافي", key: "net" },
      { header: "الرصيد الحالي", key: "balance" },
    ] as Array<{ header: string; key: string }>).filter((c) => isVisible(c.key)),
    rows: withRunning.map((m, i) => ({
      n: i + 1, date: m.date, type: m.type, statement: m.statement,
      gross: fmtCurrency(m.gross, m.currency), gross__excel: m.gross,
      commission: fmtCurrency(m.commission, m.currency), commission__excel: m.commission,
      net: fmtCurrency(m.net, m.currency), net__excel: m.net,
      balance: fmtCurrency(m.balance, m.currency), balance__excel: m.balance,
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
            <ColumnVisibility columns={MERCHANT_STATEMENT_COLUMNS} visible={visible} onChange={setVisible} />
            <ExportButton disabled={withRunning.length === 0} getData={buildExport} whatsapp={{ phone: (merchant as any)?.whatsapp || (merchant as any)?.phone || null, recipientName: (merchant as any)?.merchant_name || null }} />
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>التاجر</label>
              <SearchableSelect value={merchantId} onChange={setMerchantId} options={merchants.map((m) => ({ value: m.id, label: m.merchant_name }))} allowClear={false} />
            </div>
            <div className="form-group"><label><Calendar size={12} /> من تاريخ</label><DateInput value={from} onChange={setFrom} /></div>
            <div className="form-group"><label><Calendar size={12} /> إلى تاريخ</label><DateInput value={to} onChange={setTo} /></div>
            <div className="form-group">
              <label>نوع الحركة</label>
              <SearchableSelect
                value={typeFilter}
                onChange={(v) => setTypeFilter((v as typeof typeFilter) || "all")}
                options={[
                  { value: "all", label: "كل الحركات" },
                  { value: "incoming", label: "وارد من وكيل" },
                  { value: "outgoing", label: "صادر لشركة" },
                  { value: "collection", label: "تحصيل نقدية من التاجر" },
                  { value: "cashout", label: "صرف نقدية" },
                  { value: "conversion", label: "تحويل لـ USD" },
                ]}
                allowClear={false}
              />
            </div>
            <CurrencyFilter value={currencyFilter} onChange={setCurrencyFilter} options={currencyOptions} />
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
                <div className="stat-row"><span className="stat-key">الرصيد الحالي</span><span className="stat-val bold">{finalByCurrency.length === 0 ? fmtDL(0) : finalByCurrency.map(([c, v]) => fmtCurrency(v, c)).join(" · ")}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="account-summary kpi-rich kpi-merchants">
        <div className="sum-box green">
          <span className="kpi-icon"><ArrowDownCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">الوارد من الوكلاء</div><div className="val">{fmtDL(totalIncoming)}</div></div>
        </div>
        <div className="sum-box gold">
          <span className="kpi-icon"><Banknote size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">النقدية المحصلة من التاجر</div><div className="val">{fmtDL(totalCollected)}</div></div>
        </div>
        <div className="sum-box red">
          <span className="kpi-icon"><ArrowUpCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">الصادر للشركات</div><div className="val">{fmtDL(totalOutgoing)}</div></div>
        </div>
        <div className="sum-box red">
          <span className="kpi-icon"><ArrowUpFromLine size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">النقدية المصروفة للتاجر</div><div className="val">{fmtDL(totalPaidOut)}</div></div>
        </div>
        <div className="sum-box">
          <span className="kpi-icon"><Percent size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">نسبة التاجر (1%)</div><div className="val">{fmtDL(totalCommission)}</div></div>
        </div>
        <div className="sum-box hero">
          <span className="kpi-icon"><Wallet size={22} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">صافي الرصيد</div>
            <div className="val">{fmtDL(finalBalance)}</div>
            <div className="kpi-sub">= الوارد + المصروف − المحصل − الصادر − التحويلات</div>
          </div>
        </div>
      </div>

      <CurrencyTotalsCards totals={byCurrency} entityKind="merchant" />


      <div className="card">
        <div className="card-header"><div className="card-title">💳 الحركات المالية</div></div>
        <div className="card-body">
          <div className="table-wrap enterprise-table">
            <table className="mobile-cards">
              <thead><tr>
                {isVisible("n") && <th>#</th>}
                {isVisible("date") && <th>التاريخ</th>}
                {isVisible("type") && <th>نوع الحركة</th>}
                {isVisible("statement") && <th>البيان</th>}
                {isVisible("gross") && <th className="num-col">المبلغ</th>}
                {isVisible("commission") && <th className="num-col">النسبة</th>}
                {isVisible("net") && <th className="num-col">الصافي</th>}
                {isVisible("balance") && <th className="num-col">الرصيد الحالي</th>}
                {isVisible("actions") && <th>إجراءات</th>}
              </tr></thead>
              <tbody>
                {withRunning.length === 0 ? (
                  <tr><td colSpan={visibleCount}><div className="empty"><div className="empty-icon">💳</div><div className="empty-text">لا توجد حركات مطابقة</div></div></td></tr>
                ) : pageMovements.map((m, i) => {
                  const idx = page * pageSize + i;
                  const color = m.type === "وارد من وكيل" ? "#15803D" : "#B91C1C";
                  return (
                    <tr key={m.id}>
                      {isVisible("n") && <td data-label="#">{idx + 1}</td>}
                      {isVisible("date") && <td data-label="التاريخ">{m.date}</td>}
                      {isVisible("type") && <td data-label="نوع الحركة"><span className="badge">{m.type}</span></td>}
                      {isVisible("statement") && <td data-label="البيان">{m.statement}</td>}
                      {isVisible("gross") && <td className="num-col" data-label="المبلغ">{fmtCurrency(m.gross, m.currency)}</td>}
                      {isVisible("commission") && <td className="num-col" data-label="النسبة">{fmtCurrency(m.commission, m.currency)}</td>}
                      {isVisible("net") && <td className="num-col" data-label="الصافي" style={{ color, fontWeight: 700 }}>{m.delta >= 0 ? "+" : "-"}{fmtCurrency(Math.abs(m.delta), m.currency)}</td>}
                      {isVisible("balance") && <td className="num-col" data-label="الرصيد" style={{ fontWeight: 800, color: m.balance >= 0 ? "#15803D" : "#B91C1C" }}>{fmtCurrency(m.balance, m.currency)}</td>}
                      {isVisible("actions") && (
                        <td data-label="إجراءات">
                          <EditTransactionButton table={m.sourceTable} id={m.sourceId} cancelled={false} />
                          <CancelTransactionButton table={m.sourceTable} id={m.sourceId} cancelled={false} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={visibleCount} style={{ fontWeight: 800 }}>الإجمالي بالجنيه — المبلغ: {fmtDL(totals.egpGross)} · النسبة: {fmtDL(totalCommission)} · الصافي: {fmtDL(totalIncoming + totalPaidOut - totalCollected - totalOutgoing - totalConverted)}</td></tr>
                <tr><td colSpan={visibleCount} style={{ fontWeight: 800, background: "var(--card)" }}>الرصيد الحالي حسب العملة — {finalByCurrency.length === 0 ? "—" : finalByCurrency.map(([c, v]) => fmtCurrency(v, c)).join(" · ")}</td></tr>
              </tfoot>
            </table>
          </div>
          <Controls />
        </div>
      </div>
    </>
  );
}
