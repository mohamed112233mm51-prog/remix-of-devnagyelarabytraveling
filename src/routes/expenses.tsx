import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDL,
  fmtUSD,
  useLive,
  merchantCashNet,
  type Expense,
  type ExpenseDeduction,
  type Transaction,
  type CompanyTransaction,
  type InvestorTransaction,
  type UsdTreasuryTransaction,
  type Merchant,
  type MerchantCashCollection,
} from "@/lib/db";
import { confirmDialog } from "@/lib/confirm";
import { Wallet, Receipt, TrendingDown, Plus } from "lucide-react";

export const Route = createFileRoute("/expenses")({
  component: ExpensesPage,
});

const EXPENSE_TYPES = ["ثابت", "متغير"] as const;

type FundingSource =
  | "insta_company"
  | "cash_company"
  | "usd_treasury"
  | "merchant_wallet"
  | "merchant_physical";

const FUNDING_SOURCES: { value: FundingSource; label: string }[] = [
  { value: "insta_company", label: "انستا الشركة" },
  { value: "cash_company", label: "نقدي الشركة" },
  { value: "usd_treasury", label: "الخزينة الدولارية" },
  { value: "merchant_wallet", label: "فودافون كاش" },
  { value: "merchant_physical", label: "نقدي التاجر" },
];

const sourceLabel = (v?: string | null) =>
  FUNDING_SOURCES.find((s) => s.value === v)?.label || v || "—";

const isMerchantSource = (v: string) =>
  v === "merchant_wallet" || v === "merchant_physical";

type Tab = "add" | "history";

function useSourceBalances() {
  const { rows: agentTxns } = useLive<Transaction>("transactions");
  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: investorTxns } = useLive<InvestorTransaction>("investor_transactions");
  const { rows: deductions } = useLive<ExpenseDeduction>("expense_deductions");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");

  return useMemo(() => {
    let instaIn = 0, cashIn = 0;
    for (const t of agentTxns) {
      instaIn += Number(t.instapay_amount || 0);
      cashIn += Number(t.cash_amount || 0);
    }
    let instaOut = 0, cashOut = 0;
    for (const t of cTxns) {
      instaOut += Number(t.instapay_amount || 0);
      cashOut += Number(t.cash_amount || 0);
    }
    let investorIn = 0, investorOut = 0;
    for (const t of investorTxns) {
      if (t.transaction_type === "توريد نقدية") investorIn += Number(t.amount || 0);
      else if (t.transaction_type === "صرف نقدية") investorOut += Number(t.amount || 0);
    }
    let usdConvEgp = 0, usdBalance = 0;
    for (const r of usdRows) {
      if (r.type === "conversion") usdConvEgp += Number(r.egp_amount || 0);
      const amt = Number(r.usd_amount || 0);
      usdBalance += r.type === "company_payment" ? -amt : amt;
    }
    let instaExp = 0, cashExp = 0;
    for (const d of deductions) {
      const a = Number(d.amount || 0);
      if (d.funding_source === "insta_company") instaExp += a;
      else if (d.funding_source === "cash_company") cashExp += a;
      else if (!d.funding_source) cashExp += a; // legacy → cash
    }
    const merchantBalance = new Map<string, number>();
    for (const t of agentTxns) {
      if (!t.merchant_id) continue;
      const net = merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
      merchantBalance.set(t.merchant_id, (merchantBalance.get(t.merchant_id) || 0) + net);
    }
    for (const t of cTxns) {
      if (!t.merchant_id) continue;
      const net = merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
      merchantBalance.set(t.merchant_id, (merchantBalance.get(t.merchant_id) || 0) - net);
    }
    for (const c of collections) {
      merchantBalance.set(c.merchant_id, (merchantBalance.get(c.merchant_id) || 0) - Number(c.amount || 0));
    }

    return {
      insta_company: Math.round(instaIn - instaOut - instaExp),
      cash_company: Math.round(cashIn + investorIn - investorOut - cashOut - cashExp - usdConvEgp),
      usd_treasury: Math.round(usdBalance * 100) / 100,
      merchantBalance,
    };
  }, [agentTxns, cTxns, investorTxns, deductions, usdRows, collections]);
}

function ExpensesPage() {
  const { rows: expenses } = useLive<Expense>("expenses");
  const { rows: deductions } = useLive<ExpenseDeduction>("expense_deductions");
  const [tab, setTab] = useState<Tab>("history");

  const totalExpenses = useMemo(
    () =>
      expenses.reduce((s, e) => s + Number(e.amount || 0), 0) +
      deductions.reduce((s, d) => s + Number(d.amount || 0), 0),
    [expenses, deductions],
  );
  const fixedTotal = useMemo(
    () => expenses.filter((e) => e.expense_type === "ثابت").reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses],
  );
  const variableTotal = useMemo(
    () => expenses.filter((e) => e.expense_type === "متغير").reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses],
  );

  return (
    <div className="section active fin-page accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>المصروفات</span>
            <span>›</span>
            <span className="crumb-current">إدارة المصروفات</span>
          </div>
          <h1 className="page-h1"><Receipt size={22} strokeWidth={2.2} /> إدارة المصروفات</h1>
          <div className="page-sub">متابعة المصروفات الثابتة والمتغيرة بدقة محاسبية</div>
        </div>
        <button className="page-head-cta" onClick={() => setTab("add")}>
          <Plus size={16} strokeWidth={2.4} /> إضافة مصروف
        </button>
      </div>
      <div className="account-summary">
        <div className="sum-box red">
          <span className="kpi-icon"><TrendingDown size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">إجمالي المصروفات</div><div className="val">{fmtDL(totalExpenses)}</div></div>
        </div>
        <div className="sum-box gold">
          <span className="kpi-icon"><Wallet size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">المصروفات الثابتة</div><div className="val">{fmtDL(fixedTotal)}</div></div>
        </div>
        <div className="sum-box green">
          <span className="kpi-icon"><Receipt size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">المصروفات المتغيرة</div><div className="val">{fmtDL(variableTotal)}</div></div>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>📜 سجل المصروفات</div>
      </div>

      {tab === "add" && <ExpenseForm onDone={() => setTab("history")} />}
      {tab === "history" && <ExpensesHistory expenses={expenses} />}
    </div>
  );
}

function ExpenseForm({ initial, onDone }: { initial?: Expense; onDone?: () => void } = {}) {
  const balances = useSourceBalances();
  const { rows: merchants } = useLive<Merchant>("merchants");

  const [form, setForm] = useState({
    expense_name: initial?.expense_name || "",
    expense_type: initial?.expense_type || "متغير",
    amount: initial ? String(initial.amount) : "",
    date: initial?.date || new Date().toISOString().slice(0, 10),
    funding_source: (initial?.funding_source as FundingSource | "") || "",
    merchant_id: initial?.merchant_id || "",
    usd_amount: initial?.usd_amount ? String(initial.usd_amount) : "",
    exchange_rate: initial?.exchange_rate ? String(initial.exchange_rate) : "",
    notes: initial?.notes || "",
    auto_deduct_enabled: initial?.auto_deduct_enabled || false,
    auto_deduct_day: initial?.auto_deduct_day ? String(initial.auto_deduct_day) : "1",
  });
  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  const isUsd = form.funding_source === "usd_treasury";
  const isMerchant = isMerchantSource(form.funding_source);

  // EGP amount: for USD source it's computed = usd * rate; otherwise it's the typed amount
  const egpAmount = useMemo(() => {
    if (isUsd) {
      return Math.round(Number(form.usd_amount || 0) * Number(form.exchange_rate || 0));
    }
    return Math.round(Number(form.amount || 0));
  }, [form.amount, form.usd_amount, form.exchange_rate, isUsd]);

  const selectedBalance = useMemo(() => {
    if (!form.funding_source) return null;
    if (form.funding_source === "insta_company") return { v: balances.insta_company, label: "رصيد انستا الشركة", egp: true };
    if (form.funding_source === "cash_company") return { v: balances.cash_company, label: "رصيد نقدي الشركة", egp: true };
    if (form.funding_source === "usd_treasury") return { v: balances.usd_treasury, label: "رصيد الخزينة الدولارية", egp: false };
    if (isMerchant && form.merchant_id) {
      return { v: balances.merchantBalance.get(form.merchant_id) || 0, label: "رصيد التاجر", egp: true };
    }
    return null;
  }, [form.funding_source, form.merchant_id, balances, isMerchant]);

  const save = async () => {
    if (!form.expense_name.trim()) return toast.error("اسم المصروف مطلوب");
    if (!form.funding_source) return toast.error("اختر مصدر الدفع");
    if (isMerchant && !form.merchant_id) return toast.error("اختر التاجر");

    if (isUsd) {
      const usd = Number(form.usd_amount || 0);
      const rate = Number(form.exchange_rate || 0);
      if (!usd || usd <= 0) return toast.error("أدخل المبلغ بالدولار");
      if (!rate || rate <= 0) return toast.error("أدخل سعر الصرف");
      if (!initial && usd > Number(balances.usd_treasury)) {
        return toast.error("لا يوجد رصيد كافي في مصدر الدفع");
      }
    } else {
      if (!egpAmount || egpAmount <= 0) return toast.error("أدخل المبلغ");
      if (!initial && selectedBalance && egpAmount > Number(selectedBalance.v)) {
        return toast.error("لا يوجد رصيد كافي في مصدر الدفع");
      }
    }

    const payload: any = {
      expense_name: form.expense_name,
      expense_type: form.expense_type,
      amount: egpAmount,
      date: form.date,
      payment_method: sourceLabel(form.funding_source), // back-compat
      notes: form.notes || null,
      auto_deduct_enabled: form.expense_type === "ثابت" ? form.auto_deduct_enabled : false,
      auto_deduct_day:
        form.expense_type === "ثابت" && form.auto_deduct_enabled
          ? Math.max(1, Math.min(28, Number(form.auto_deduct_day) || 1))
          : null,
      funding_source: form.funding_source,
      merchant_id: isMerchant ? form.merchant_id : null,
      currency: isUsd ? "USD" : "EGP",
      usd_amount: isUsd ? Number(form.usd_amount || 0) : 0,
      exchange_rate: isUsd ? Number(form.exchange_rate || 0) : null,
    };

    if (initial) {
      const { error } = await supabase.from("expenses").update(payload).eq("id", initial.id);
      if (error) return toast.error(error.message);
      toast.success("تم حفظ التعديلات");
      onDone?.();
      return;
    }

    // Insert expense, then deduct from chosen source
    const { data: expenseRow, error } = await supabase
      .from("expenses").insert(payload).select("id").single();
    if (error || !expenseRow) return toast.error(error?.message || "تعذر حفظ المصروف");

    if (form.funding_source === "insta_company" || form.funding_source === "cash_company") {
      const { error: e2 } = await supabase.from("expense_deductions").insert({
        expense_id: expenseRow.id,
        deduction_date: form.date,
        amount: egpAmount,
        status: "مكتمل",
        funding_source: form.funding_source,
        currency: "EGP",
      });
      if (e2) toast.error("تم حفظ المصروف لكن تعذر تسجيل الخصم: " + e2.message);
    } else if (form.funding_source === "usd_treasury") {
      const { error: e2 } = await supabase.from("usd_treasury_transactions").insert({
        date: form.date,
        type: "company_payment",
        usd_amount: Number(form.usd_amount || 0),
        egp_amount: egpAmount,
        exchange_rate: Number(form.exchange_rate || 0),
        source_type: "expense",
        note: `مصروف: ${form.expense_name}`,
      });
      if (e2) toast.error("تم حفظ المصروف لكن تعذر تسجيل الخصم الدولاري: " + e2.message);
    } else if (isMerchant) {
      const { error: e2 } = await supabase.from("merchant_cash_collections").insert({
        merchant_id: form.merchant_id,
        date: form.date,
        amount: egpAmount,
        note: `مصروف (${sourceLabel(form.funding_source)}): ${form.expense_name}`,
      });
      if (e2) toast.error("تم حفظ المصروف لكن تعذر خصم رصيد التاجر: " + e2.message);
    }

    toast.success("تم حفظ المصروف وخصمه من مصدر الدفع");
    setForm({
      expense_name: "",
      expense_type: "متغير",
      amount: "",
      date: new Date().toISOString().slice(0, 10),
      funding_source: "",
      merchant_id: "",
      usd_amount: "",
      exchange_rate: "",
      notes: "",
      auto_deduct_enabled: false,
      auto_deduct_day: "1",
    });
    onDone?.();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">{initial ? "✏️ تعديل مصروف" : "➕ إضافة مصروف"}</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم المصروف</label><input value={form.expense_name} onChange={(e) => set("expense_name", e.target.value)} /></div>
        <div className="form-group"><label>نوع المصروف</label>
          <select value={form.expense_type} onChange={(e) => set("expense_type", e.target.value)}>
            {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {!isUsd && (
          <div className="form-group"><label>المبلغ (ج.م)</label>
            <input type="number" placeholder="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </div>
        )}

        <div className="form-group"><label>التاريخ</label><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></div>

        <div className="form-group"><label>دفع من</label>
          <select value={form.funding_source} onChange={(e) => set("funding_source", e.target.value)}>
            <option value="">— اختر مصدر الدفع —</option>
            {FUNDING_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {isMerchant && (
          <div className="form-group"><label>اختر التاجر</label>
            <select value={form.merchant_id} onChange={(e) => set("merchant_id", e.target.value)}>
              <option value="">— اختر التاجر —</option>
              {merchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
            </select>
          </div>
        )}

        {isUsd && (
          <>
            <div className="form-group"><label>المبلغ بالدولار</label>
              <input type="number" step="0.01" placeholder="0" value={form.usd_amount} onChange={(e) => set("usd_amount", e.target.value)} />
            </div>
            <div className="form-group"><label>سعر الصرف</label>
              <input type="number" step="0.01" placeholder="0" value={form.exchange_rate} onChange={(e) => set("exchange_rate", e.target.value)} />
            </div>
            <div className="form-group"><label>المعادل بالجنيه</label>
              <input type="number" value={egpAmount || ""} readOnly />
            </div>
          </>
        )}

        {selectedBalance && (
          <div className="form-group full">
            <div style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "var(--card, #f7f7f9)",
              border: "1px solid var(--border, #e5e7eb)",
              fontSize: 13,
            }}>
              {selectedBalance.label}:&nbsp;
              <b>{selectedBalance.egp ? fmtDL(selectedBalance.v) : fmtUSD(selectedBalance.v)}</b>
            </div>
          </div>
        )}

        <div className="form-group full"><label>البيان / ملاحظات</label><input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>

        {form.expense_type === "ثابت" && (
          <>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={form.auto_deduct_enabled}
                  onChange={(e) => set("auto_deduct_enabled", e.target.checked)}
                  style={{ marginInlineEnd: 6 }}
                />
                تفعيل الخصم التلقائي
              </label>
            </div>
            {form.auto_deduct_enabled && (
              <div className="form-group">
                <label>تاريخ الخصم الشهري (يوم 1-28)</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.auto_deduct_day}
                  onChange={(e) => set("auto_deduct_day", e.target.value)}
                />
              </div>
            )}
          </>
        )}
      </div>
      <div className="form-footer">
        <button className="btn btn-gold" onClick={save}>💾 {initial ? "حفظ التعديلات" : "حفظ المصروف"}</button>
        {initial && onDone && <button className="btn" onClick={onDone} style={{ marginInlineStart: 8 }}>إلغاء</button>}
      </div>
    </div>
  );
}

function ExpensesHistory({ expenses }: { expenses: Expense[] }) {
  const { rows: merchants } = useLive<Merchant>("merchants");
  const [edit, setEdit] = useState<Expense | null>(null);
  const merchantName = (id: string | null) =>
    id ? merchants.find((m) => m.id === id)?.merchant_name || "—" : "—";

  const del = async (id: string) => {
    if (!(await confirmDialog("حذف هذا المصروف؟"))) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("تم حذف المصروف");
  };

  if (edit) return <ExpenseForm initial={edit} onDone={() => setEdit(null)} />;

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">📜 سجل المصروفات</div></div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>اسم المصروف</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th><th>دفع من</th><th>التاجر</th><th>البيان</th><th>إجراءات</th></tr></thead>
            <tbody>
              {expenses.length === 0 ? (
                <tr><td colSpan={9}><div className="empty"><div className="empty-text">لا توجد مصروفات</div></div></td></tr>
              ) : expenses.map((e, i) => (
                <tr key={e.id}>
                  <td data-label="#">{i + 1}</td>
                  <td className="bold" data-label="اسم المصروف">{e.expense_name}</td>
                  <td data-label="النوع">{e.expense_type}{e.auto_deduct_enabled ? ` (يوم ${e.auto_deduct_day})` : ""}</td>
                  <td data-label="المبلغ">
                    {fmtDL(Number(e.amount || 0))}
                    {e.currency === "USD" && e.usd_amount ? (
                      <div style={{ fontSize: 11, color: "var(--muted-foreground, #6b7280)" }}>
                        {fmtUSD(Number(e.usd_amount))} × {e.exchange_rate}
                      </div>
                    ) : null}
                  </td>
                  <td data-label="التاريخ">{e.date}</td>
                  <td data-label="دفع من">{sourceLabel(e.funding_source)}</td>
                  <td data-label="التاجر">{merchantName(e.merchant_id)}</td>
                  <td data-label="البيان">{e.notes || "—"}</td>
                  <td data-label="إجراءات">
                    <button className="btn" onClick={() => setEdit(e)}>تعديل</button>
                    <button className="btn" onClick={() => del(e.id)} style={{ marginInlineStart: 6 }}>حذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
