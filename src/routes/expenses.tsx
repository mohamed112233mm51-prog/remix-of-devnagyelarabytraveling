import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDL, useLive, type Expense, type ExpenseDeduction } from "@/lib/db";
import { Wallet, Receipt, TrendingDown, Plus } from "lucide-react";

export const Route = createFileRoute("/expenses")({
  component: ExpensesPage,
});

const EXPENSE_TYPES = ["ثابت", "متغير"] as const;
const PAYMENT_METHODS = ["انستا", "نقدي", "كاش"] as const;

type Tab = "add" | "history";

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

      {tab === "add" && <ExpenseForm />}
      {tab === "history" && <ExpensesHistory expenses={expenses} />}
    </div>
  );
}

function ExpenseForm({ initial, onDone }: { initial?: Expense; onDone?: () => void } = {}) {
  const [form, setForm] = useState({
    expense_name: initial?.expense_name || "",
    expense_type: initial?.expense_type || "متغير",
    amount: initial ? String(initial.amount) : "",
    date: initial?.date || new Date().toISOString().slice(0, 10),
    payment_method: initial?.payment_method || "نقدي",
    notes: initial?.notes || "",
    auto_deduct_enabled: initial?.auto_deduct_enabled || false,
    auto_deduct_day: initial?.auto_deduct_day ? String(initial.auto_deduct_day) : "1",
  });
  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.expense_name.trim()) return toast.error("اسم المصروف مطلوب");
    if (!Number(form.amount)) return toast.error("أدخل المبلغ");
    const payload = {
      expense_name: form.expense_name,
      expense_type: form.expense_type,
      amount: Math.round(Number(form.amount)),
      date: form.date,
      payment_method: form.payment_method,
      notes: form.notes || null,
      auto_deduct_enabled: form.expense_type === "ثابت" ? form.auto_deduct_enabled : false,
      auto_deduct_day:
        form.expense_type === "ثابت" && form.auto_deduct_enabled
          ? Math.max(1, Math.min(28, Number(form.auto_deduct_day) || 1))
          : null,
    };
    const { error } = initial
      ? await supabase.from("expenses").update(payload).eq("id", initial.id)
      : await supabase.from("expenses").insert(payload);
    if (error) return toast.error(error.message);
    if (!initial) {
      setForm({
        expense_name: "",
        expense_type: "متغير",
        amount: "",
        date: new Date().toISOString().slice(0, 10),
        payment_method: "نقدي",
        notes: "",
        auto_deduct_enabled: false,
        auto_deduct_day: "1",
      });
    }
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
        <div className="form-group"><label>المبلغ</label><input type="number" placeholder="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
        <div className="form-group"><label>التاريخ</label><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
        <div className="form-group"><label>طريقة الدفع</label>
          <select value={form.payment_method} onChange={(e) => set("payment_method", e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="form-group full"><label>ملاحظات</label><input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>

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
  const [edit, setEdit] = useState<Expense | null>(null);
  const del = async (id: string) => {
    if (!confirm("حذف هذا المصروف؟")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) toast.error(error.message);
  };

  if (edit) return <ExpenseForm initial={edit} onDone={() => setEdit(null)} />;

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">📜 سجل المصروفات</div></div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>اسم المصروف</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th><th>طريقة الدفع</th><th>ملاحظات</th><th>إجراءات</th></tr></thead>
            <tbody>
              {expenses.length === 0 ? (
                <tr><td colSpan={8}><div className="empty"><div className="empty-text">لا توجد مصروفات</div></div></td></tr>
              ) : expenses.map((e, i) => (
                <tr key={e.id}>
                  <td data-label="#">{i + 1}</td>
                  <td className="bold" data-label="اسم المصروف">{e.expense_name}</td>
                  <td data-label="النوع">{e.expense_type}{e.auto_deduct_enabled ? ` (يوم ${e.auto_deduct_day})` : ""}</td>
                  <td data-label="المبلغ">{fmtDL(Number(e.amount || 0))}</td>
                  <td data-label="التاريخ">{e.date}</td>
                  <td data-label="طريقة الدفع">{e.payment_method}</td>
                  <td data-label="ملاحظات">{e.notes || "—"}</td>
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
