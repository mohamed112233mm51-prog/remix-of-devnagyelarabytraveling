import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDL,
  fmtUSD,
  useLive,
  type Expense,
  type ExpenseDeduction,
  type Merchant,
  type MerchantCashCollection,
} from "@/lib/db";
import { confirmDialog } from "@/lib/confirm";
import { Wallet, Receipt, TrendingDown, Plus } from "lucide-react";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { NumberInput } from "@/components/inputs/NumberInput";
import { DateInput } from "@/components/inputs/DateInput";
import {
  PaymentSplits,
  type PaymentSplitRow,
  newPaymentSplitRow,
  validatePaymentSplits,
  filterValidSplits,
  methodsForSplit,
} from "@/components/PaymentSplits";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { confirmFinancialOperation, deriveFinancialOperationUuid, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";
import { atomicRow, buildAtomicPaymentSplitRows, executeFinancialAtomic } from "@/lib/financialAtomic";
import { logCreate } from "@/lib/financialAudit";
import { resolveCompanyCashBoxForSplit, useSourceBalances, validateSplitOutflows } from "@/lib/balanceGuard";
import { useExpensesTotals } from "@/lib/financialSummary";
import { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";

export const Route = createFileRoute("/expenses")({
  component: ExpensesPage,
});

const EXPENSE_TYPES = ["ثابت", "متغير"] as const;

// Legacy single-source labels (kept for backward-compat on old rows)
const LEGACY_SOURCE_LABELS: Record<string, string> = {
  insta_company: "انستا الشركة",
  cash_company: "نقدي الشركة",
  usd_treasury: "الخزينة الدولارية",
  merchant_wallet: "تاجر الكاش",
  merchant_physical: "نقدي التاجر",
};
const legacySourceLabel = (v?: string | null) =>
  (v && LEGACY_SOURCE_LABELS[v]) || v || "—";

type Tab = "add" | "history";

function ExpensesPage() {
  const { rows: expenses } = useLive<Expense>("expenses");
  const { rows: deductions } = useLive<ExpenseDeduction>("expense_deductions");
  const [tab, setTab] = useState<Tab>("history");

  // Financial Summary Engine — نفس الأرقام، مصدر واحد.
  const { total: totalExpenses, fixed: fixedTotal, variable: variableTotal } = useExpensesTotals();
  // keep deductions referenced so live subscription stays mounted for balance calcs
  void deductions;

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
  const { rows: cashBoxes } = useLive<{ id: string; name: string; currency: string }>("cash_boxes");


  const [form, setForm] = useState({
    expense_name: initial?.expense_name || "",
    expense_type: initial?.expense_type || "متغير",
    amount: initial ? String(initial.amount) : "",
    date: initial?.date || new Date().toISOString().slice(0, 10),
    notes: initial?.notes || "",
    statement: (initial as any)?.statement || "",
    auto_deduct_enabled: initial?.auto_deduct_enabled || false,
    auto_deduct_day: initial?.auto_deduct_day ? String(initial.auto_deduct_day) : "1",
  });
  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));


  // Multi-payment splits (new): only used on insert (edit keeps original record)
  const [splits, setSplits] = useState<PaymentSplitRow[]>([newPaymentSplitRow()]);
  const [saving, setSaving] = useState(false);

  const totalAmount = Number(form.amount || 0);
  const splitsTotal = useMemo(
    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [splits],
  );
  const splitsDiff = totalAmount - splitsTotal;

  // Per-source balance preview based on chosen splits
  const balanceWarnings = useMemo(() => {
    if (initial) return [] as string[]; // edit doesn't deduct again
    const err = validateSplitOutflows(filterValidSplits(splits), balances, merchants);
    return err ? [err] : [];
  }, [splits, balances, initial, merchants]);

  const save = async () => {
    if (!form.expense_name.trim()) return toast.error("اسم المصروف مطلوب");
    if (!totalAmount || totalAmount <= 0) return toast.error("أدخل إجمالي المصروف");

    // Edit mode: only update basic fields; don't touch deductions/collections.
    if (initial) {
      const { error } = await supabase
        .from("expenses")
        .update({
          expense_name: form.expense_name,
          expense_type: form.expense_type,
          amount: totalAmount,
          date: form.date,
          notes: form.notes.trim() ? form.notes.trim() : null,
          statement: form.statement.trim() ? form.statement.trim() : null,

          auto_deduct_enabled: form.expense_type === "ثابت" ? form.auto_deduct_enabled : false,
          auto_deduct_day:
            form.expense_type === "ثابت" && form.auto_deduct_enabled
              ? Math.max(1, Math.min(28, Number(form.auto_deduct_day) || 1))
              : null,
        })
        .eq("id", initial.id);
      if (error) return toast.error(error.message);
      toast.success("تم حفظ التعديلات");
      onDone?.();
      return;
    }

    // Insert mode with multi-payment splits
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    const valid = filterValidSplits(splits);
    for (const r of valid) {
      const allowed = methodsForSplit(r, merchants).map((m) => m.key);
      if (!allowed.includes(r.method)) return toast.error("وسيلة الدفع غير مفعلة لهذا التاجر");
    }
    if (Math.abs(splitsDiff) > 0.5) {
      return toast.error(`إجمالي وسائل الدفع (${fmtDL(splitsTotal)}) لا يساوي إجمالي المصروف (${fmtDL(totalAmount)})`);
    }
    const balanceErr = validateSplitOutflows(valid, balances, merchants);
    const merchantDbErr = await assertMerchantOutflowsAllowed(valid);
    if (merchantDbErr) return toast.error(merchantDbErr);

    if (balanceErr) return toast.error(balanceErr);


    const firstMethodKey = valid[0].method;
    const firstMerchantId = valid.find((r) => r.source === "merchant")?.merchant_id || null;

    const expensePayload: any = {
      expense_name: form.expense_name,
      expense_type: form.expense_type,
      amount: totalAmount,
      date: form.date,
      payment_method: valid.length > 1 ? "متعدد" : (methodsForSplit(valid[0], merchants).find((m) => m.key === firstMethodKey)?.label || "نقدي"),
      // لا نضيف ملخص طرق الدفع تلقائياً — يبقى كما كتبه المستخدم فقط
      notes: form.notes.trim() ? form.notes.trim() : null,
      statement: form.statement.trim() ? form.statement.trim() : null,
      auto_deduct_enabled: form.expense_type === "ثابت" ? form.auto_deduct_enabled : false,
      auto_deduct_day:
        form.expense_type === "ثابت" && form.auto_deduct_enabled
          ? Math.max(1, Math.min(28, Number(form.auto_deduct_day) || 1))
          : null,
      funding_source: valid.length > 1
        ? "متعدد"
        : (firstMethodKey === "company_instapay" ? "insta_company"
          : firstMethodKey === "company_cash" ? "cash_company"
          : firstMethodKey === "merchant_wallet" ? "merchant_wallet"
          : firstMethodKey === "merchant_physical" ? "merchant_physical"
          : firstMethodKey === "merchant_instapay" ? "merchant_wallet"
          : null),
      merchant_id: valid.length === 1 ? firstMerchantId : null,
      currency: "EGP",
      usd_amount: 0,
      exchange_rate: null,
      // FX-lock: EGP expenses are locked at 1 immediately (historical source
      // of truth). Non-EGP paths must call ensureExpenseFxLock from the
      // write side; Dashboard/Reports never resolve rates at read time.
      fx_rate: 1,
      fx_locked_at: new Date().toISOString(),
    };



    for (const r of valid) {
      if (r.source !== "company") continue;
      const box = resolveCompanyCashBoxForSplit(cashBoxes, r.currency || "EGP", r.method);
      if (!box) return toast.error(`لا توجد خزنة شركة مطابقة لوسيلة الدفع المختارة بعملة ${r.currency || "EGP"}`);
    }

    const fingerprint = financialOperationFingerprint({
      name: form.expense_name.trim(),
      type: form.expense_type,
      amount: totalAmount,
      date: form.date,
      splits: valid.map((r) => ({ source: r.source, merchantId: r.merchant_id || null, method: r.method, currency: r.currency || "EGP", amount: Number(r.amount) || 0 })),
    });
    const operationId = getOrCreateFinancialOperationId("expense", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const expenseRow = { id: operationId };

    const deductionRows: any[] = [];
    const collectionRows: any[] = [];
    const engineSplits: MovementSplit[] = [];
    for (const r of valid) {
      const a = Number(r.amount) || 0;
      if (r.method === "company_instapay" || r.method === "company_cash") {
        deductionRows.push({
          expense_id: expenseRow.id,
          deduction_date: form.date,
          amount: a,
          status: "مكتمل",
          funding_source: r.method === "company_instapay" ? "insta_company" : "cash_company",
          currency: r.currency || "EGP",
        });
        const box = resolveCompanyCashBoxForSplit(cashBoxes, r.currency || "EGP", r.method);
        engineSplits.push({
          method: r.method === "company_instapay" ? "إنستاباي" : "نقدي",
          currency: (r.currency || "EGP") as any,
          cashBoxId: box?.id || null,
          requiresCashBox: true,
          amount: a,
          direction: "out",
          grossAmount: a,
          commissionRate: 0,
          commissionAmount: 0,
          netAmount: a,
          exchangeRate: 1,
          egpEquivalent: (r.currency || "EGP") === "EGP" ? a : 0,
        });
      } else if (r.source === "merchant" && r.merchant_id) {
        collectionRows.push({
          expense_id: expenseRow.id,
          merchant_id: r.merchant_id,
          date: form.date,
          amount: a,
          note: form.notes.trim() ? form.notes.trim() : null,
          statement: form.statement.trim() ? form.statement.trim() : null,
        });
      }
    }

    const deductionIds = deductionRows.map((_, index) =>
      deriveFinancialOperationUuid(operationId, `deduction:${index}`),
    );
    const deductions = { ids: deductionIds };


    const collectionIds = collectionRows.map((_, index) =>
      deriveFinancialOperationUuid(operationId, `merchant-collection:${index}`),
    );
    const collections = { ids: collectionIds };
    const atomicRows = [
      atomicRow("expenses", { ...expensePayload, id: operationId }),
      ...deductionRows.map((row, index) => atomicRow("expense_deductions", { ...row, id: deductionIds[index] })),
      ...buildAtomicPaymentSplitRows({
        operationId,
        splits: engineSplits,
        sourceTable: "expenses",
        sourceId: operationId,
      }),
      ...collectionRows.map((row, index) => atomicRow("merchant_cash_collections", { ...row, id: collectionIds[index] })),
    ];
    const saved = await executeFinancialAtomic({
      operationId,
      fingerprint,
      rows: atomicRows,
      result: { expenseId: operationId, deductionIds, collectionIds },
    });
    if (!saved.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(saved.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (saved.error || "تعذر حفظ المصروف"), { id: toastId });
      return;
    }


    if (!saved.reused) {
      try { await logCreate("expenses", expenseRow.id, { ...expensePayload, id: expenseRow.id }, "مصروف"); } catch { /* non-blocking audit */ }
    }
    if (!saved.reused) {
      for (let i = 0; i < deductions.ids.length; i += 1) {
        try { await logCreate("expense_deductions", deductions.ids[i], { ...deductionRows[i], id: deductions.ids[i] }, "خصم مصروف"); } catch { /* non-blocking audit */ }
      }
      for (let i = 0; i < collections.ids.length; i += 1) {
        try { await logCreate("merchant_cash_collections", collections.ids[i], { ...collectionRows[i], id: collections.ids[i] }, "خصم رصيد تاجر (مصروف)"); } catch { /* non-blocking audit */ }
      }
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    setForm({
      expense_name: "",
      expense_type: "متغير",
      amount: "",
      date: new Date().toISOString().slice(0, 10),
      notes: "",
      statement: "",
      auto_deduct_enabled: false,
      auto_deduct_day: "1",
    });
    setSplits([newPaymentSplitRow()]);
    onDone?.();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">{initial ? "✏️ تعديل مصروف" : "➕ إضافة مصروف"}</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم المصروف</label><input value={form.expense_name} onChange={(e) => set("expense_name", e.target.value)} /></div>
        <div className="form-group"><label>نوع المصروف</label>
          <SearchableSelect value={form.expense_type} onChange={(v) => set("expense_type", v)} options={EXPENSE_TYPES as unknown as string[]} allowClear={false} />
        </div>
        <div className="form-group"><label>إجمالي المصروف (ج.م)</label>
          <NumberInput value={Number(form.amount) || 0} onChange={(n) => set("amount", n === 0 ? "" : String(n))} min={0} />
        </div>
        <div className="form-group"><label>التاريخ</label><DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday /></div>
        <div className="form-group full"><label>البيان</label><input value={form.statement} onChange={(e) => set("statement", e.target.value)} /></div>
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
                <NumberInput value={Number(form.auto_deduct_day) || 0} onChange={(n) => set("auto_deduct_day", String(n))} min={1} max={28} />
              </div>
            )}
          </>
        )}
      </div>

      {!initial && (
        <>
          <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} title="وسائل الدفع" />
          <div style={{ padding: "0 8px 8px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 13 }}>
            <div>
              إجمالي وسائل الدفع: <b>{fmtDL(splitsTotal)}</b>
              {Math.abs(splitsDiff) > 0.5 && (
                <span style={{ color: "var(--red, #dc2626)", marginInlineStart: 12, fontWeight: 700 }}>
                  الفرق: {fmtDL(splitsDiff)}
                </span>
              )}
            </div>
            {balanceWarnings.length > 0 && (
              <div style={{ color: "var(--red, #dc2626)", fontWeight: 700 }}>
                {balanceWarnings.join(" • ")}
              </div>
            )}
          </div>
        </>
      )}

      {initial && (
        <div style={{ padding: "8px 12px", margin: "8px", borderRadius: 8, background: "var(--card, #f7f7f9)", border: "1px solid var(--border, #e5e7eb)", fontSize: 12, color: "var(--muted-foreground, #6b7280)" }}>
          ملاحظة: لتغيير وسائل الدفع، احذف المصروف وأعد إضافته. التعديل هنا يقتصر على الحقول الأساسية فقط.
        </div>
      )}

      <div className="form-footer">
        <button data-confirm-save={initial ? "تأكيد حفظ تعديلات المصروف" : "تأكيد حفظ المصروف"} className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ التأكيد..." : `💾 ${initial ? "حفظ التعديلات" : "حفظ المصروف"}`}</button>
        {initial && onDone && <button className="btn" onClick={onDone} style={{ marginInlineStart: 8 }}>إلغاء</button>}
      </div>
    </div>
  );
}

function ExpensesHistory({ expenses }: { expenses: Expense[] }) {
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: deductions } = useLive<ExpenseDeduction>("expense_deductions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const [edit, setEdit] = useState<Expense | null>(null);

  const merchantName = (id: string | null | undefined) =>
    id ? merchants.find((m) => m.id === id)?.merchant_name || "تاجر" : "—";

  // Group splits per expense_id
  const splitsByExpense = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of deductions) {
      if (!d.expense_id) continue;
      const label =
        d.funding_source === "insta_company" ? "إنستا الشركة"
        : d.funding_source === "cash_company" ? "نقدي الشركة"
        : d.funding_source || "—";
      const arr = map.get(d.expense_id) || [];
      arr.push(`${label}: ${fmtDL(Number(d.amount || 0))}`);
      map.set(d.expense_id, arr);
    }
    for (const c of collections) {
      if (!c.expense_id) continue;
      const arr = map.get(c.expense_id) || [];
      arr.push(`${merchantName(c.merchant_id)}: ${fmtDL(Number(c.amount || 0))}`);
      map.set(c.expense_id, arr);
    }
    return map;
  }, [deductions, collections, merchants]);

  const del = async (id: string) => {
    if (!(await confirmDialog("حذف هذا المصروف؟ سيتم حذف كل وسائل الدفع المرتبطة به."))) return;
    const { data, error } = await (supabase as any).rpc("delete_expense_atomic", { p_expense_id: id });
    if (error || data?.ok !== true) {
      const message = String(error?.message || data?.error || "تعذر حذف المصروف");
      const missingRpc = String((error as any)?.code || "") === "PGRST202" || message.toLowerCase().includes("schema cache");
      toast.error(missingRpc ? "تم إيقاف الحذف بدون تغيير أي جزء: تحديث الحذف المالي الذري غير مُطبق على قاعدة البيانات بعد." : message);
    } else {
      toast.success("تم حذف المصروف وكل آثاره المالية بنجاح");
    }
  };

  if (edit) return <ExpenseForm initial={edit} onDone={() => setEdit(null)} />;

  const paymentsCell = (e: Expense) => {
    const list = splitsByExpense.get(e.id);
    if (list && list.length) return list.join(" | ");
    // Legacy single-source fallback
    const src = legacySourceLabel(e.funding_source);
    if (e.merchant_id) return `${src} (${merchantName(e.merchant_id)}): ${fmtDL(Number(e.amount || 0))}`;
    return `${src}: ${fmtDL(Number(e.amount || 0))}`;
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">📜 سجل المصروفات</div></div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>اسم المصروف</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th><th>وسائل الدفع</th><th>البيان</th><th>ملاحظات</th><th>إجراءات</th></tr></thead>
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
                  <td data-label="وسائل الدفع" style={{ fontSize: 12, lineHeight: 1.6 }}>{paymentsCell(e)}</td>
                  <td data-label="البيان">{(e as any).statement || ""}</td>
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
