import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, normalizeCurrency, refetchLiveTables, useLive, type Investor, type InvestorTransaction } from "@/lib/db";
import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";
import { formatCurrencyMap } from "@/lib/financialSummary";
import { CurrencyLines } from "@/components/CurrencyLines";
import { FinancialPositionPanel } from "@/components/FinancialPositionPanel";
import { buildInvestorCapitalSummary, investorTransactionCurrency, type FinancialPositionSplit } from "@/hooks/useFinancialPosition";
import { checkOutflowAllowed, postMovement } from "@/lib/financialEngine";
import { confirmFinancialOperation, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";
import { resolveCompanyCashBoxForSplit } from "@/lib/balanceGuard";
import { usePerm } from "@/hooks/usePerm";
import { ExportButton } from "@/components/ExportButton";
import { buildArabicFileName } from "@/lib/exportStatement";
import { useRegisterStatementCapture } from "@/lib/statementCapture";
import { Briefcase, ArrowDownCircle, ArrowUpCircle, Wallet, UserPlus, Users, Receipt, FileText, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { NumberInput } from "@/components/inputs/NumberInput";
import { DateInput } from "@/components/inputs/DateInput";

export const Route = createFileRoute("/investors")({
  component: InvestorsPage,
});

const TXN_TYPES = ["صرف نقدية", "توريد نقدية"] as const;

type OwnerCashBox = { id: string; name: string; currency: string; balance: number | string | null; is_active?: boolean | null; method_key?: string | null };

type Tab = "list" | "history" | "statement" | "withdraw" | "deposit";

function InvestorsPage() {
  const perm = usePerm("investors");
  const { rows: investors } = useLive<Investor>("investors");
  const { rows: txns } = useCompleteFinancialTable<InvestorTransaction>("investor_transactions");
  const { rows: paymentSplits } = useCompleteFinancialTable<FinancialPositionSplit>("payment_splits");
  const [tab, setTab] = useState<Tab>("history");
  const [addOpen, setAddOpen] = useState(false);

  const capitalTotals = useMemo(
    () => buildInvestorCapitalSummary(txns, paymentSplits, { includeLegacy: true }),
    [txns, paymentSplits],
  );

  const investorName = (id: string) => investors.find((i) => i.id === id)?.investor_name || "—";


  return (
    <div className="section active fin-page accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الحسابات المالية</span>
            <span>›</span>
            <span className="crumb-current">حساب المالك / المستثمرين</span>
          </div>
          <h1 className="page-h1"><Briefcase size={22} strokeWidth={2.2} /> حساب المالك / المستثمرين</h1>
        </div>
        {perm.create && (
          <button className="page-head-cta" onClick={() => setAddOpen(true)}>
            <UserPlus size={16} strokeWidth={2.4} /> إضافة مالك / مستثمر
          </button>
        )}
      </div>
      <div className="account-summary kpi-rich kpi-investors">
        <div className="sum-box green">
          <span className="kpi-icon"><ArrowDownCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">إجمالي التمويل / التوريدات</div><div className="val"><CurrencyLines map={capitalTotals.deposit} /></div></div>
        </div>
        <div className="sum-box red">
          <span className="kpi-icon"><ArrowUpCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">إجمالي السحوبات</div><div className="val"><CurrencyLines map={capitalTotals.withdraw} /></div></div>
        </div>
        <div className="sum-box hero">
          <span className="kpi-icon"><Wallet size={22} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">صافي حساب المالك / المستثمرين</div>
            <div className="val"><CurrencyLines map={capitalTotals.balance} /></div>
            <div className="kpi-sub">التوريدات ناقص السحوبات — كل عملة مستقلة</div>
          </div>
        </div>
      </div>

      <FinancialPositionPanel variant="full" />

      <div className="action-toolbar">
        <div className={`tool-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
          <Receipt size={15} strokeWidth={2} /> <span>سجل الحركات</span>
        </div>
        <div className={`tool-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          <Users size={15} strokeWidth={2} /> <span>قائمة المستثمرين</span>
        </div>
        <div className={`tool-tab ${tab === "statement" ? "active" : ""}`} onClick={() => setTab("statement")}>
          <FileText size={15} strokeWidth={2} /> <span>كشف حساب</span>
        </div>
        {perm.create && (
          <div className={`tool-tab ${tab === "deposit" ? "active" : ""}`} onClick={() => setTab("deposit")}>
            <ArrowDownLeft size={15} strokeWidth={2} /> <span>توريد تمويل</span>
          </div>
        )}
        {perm.create && (
          <div className={`tool-tab ${tab === "withdraw" ? "active" : ""}`} onClick={() => setTab("withdraw")}>
            <ArrowUpRight size={15} strokeWidth={2} /> <span>سحب من التمويل</span>
          </div>
        )}
      </div>

      {tab === "list" && <InvestorsListTab investors={investors} txns={txns} splits={paymentSplits} canEdit={perm.edit} />}


      {tab === "history" && <HistoryTab txns={txns} investorName={investorName} investors={investors} splits={paymentSplits} />}
      {tab === "statement" && <StatementTab txns={txns} investors={investors} splits={paymentSplits} canExport={perm.export} />}
      {tab === "withdraw" && perm.create && <TxnForm investors={investors} kind="صرف نقدية" methodLabel="الخزينة" title="⬆️ سحب من تمويل المالك / المستثمر" />}
      {tab === "deposit" && perm.create && <TxnForm investors={investors} kind="توريد نقدية" methodLabel="الخزينة" title="⬇️ توريد تمويل المالك / المستثمر" />}
      {addOpen && perm.create && <InvestorForm onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function InvestorForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ investor_name: "", phone: "", whatsapp: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.investor_name.trim()) return toast.error("اسم المستثمر مطلوب");
    setSaving(true);
    const { error } = await supabase.from("investors").insert({
      investor_name: form.investor_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setForm({ investor_name: "", phone: "", whatsapp: "" });
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">➕ إضافة مالك / مستثمر جديد</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم المستثمر</label><input autoFocus value={form.investor_name} onChange={(e) => set("investor_name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ المستثمر" type="button" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "💾 حفظ المستثمر"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TxnForm({ investors, kind, methodLabel, title }: { investors: Investor[]; kind: typeof TXN_TYPES[number]; methodLabel: string; title: string }) {
  const { rows: boxes } = useLive<OwnerCashBox>("cash_boxes");
  const activeBoxes = useMemo(() => {
    const supported = boxes.filter((box) =>
      box.is_active !== false
      && ["EGP", "USD", "LYD"].includes(normalizeCurrency(box.currency)),
    );

    // Keep all previously available active treasuries, but explicitly resolve
    // the two EGP company treasuries through the same stable mapping used by
    // the rest of the financial system. This guarantees both company cash and
    // company InstaPay are offered for owner funding when those boxes exist.
    const companyCash = resolveCompanyCashBoxForSplit(boxes, "EGP", "company_cash")
      || boxes.find((box) => box.is_active !== false && box.method_key === "company_cash")
      || null;
    const companyInstapay = resolveCompanyCashBoxForSplit(boxes, "EGP", "company_instapay")
      || boxes.find((box) => box.is_active !== false && box.method_key === "company_instapay")
      || null;

    const ordered = [companyCash, companyInstapay, ...supported];
    const seen = new Set<string>();
    return ordered.filter((box): box is OwnerCashBox => {
      if (!box || box.is_active === false || seen.has(box.id)) return false;
      seen.add(box.id);
      return true;
    });
  }, [boxes]);
  const [form, setForm] = useState({
    investor_id: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    cash_box_id: "",
    note: "",
    statement: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!form.cash_box_id && activeBoxes[0]?.id) set("cash_box_id", activeBoxes[0].id);
  }, [activeBoxes, form.cash_box_id]);

  const selectedBox = activeBoxes.find((box) => box.id === form.cash_box_id) || null;

  const save = async () => {
    if (!form.investor_id) return toast.error("اختر المالك / المستثمر");
    const amount = Math.round(Number(form.amount || 0));
    if (amount <= 0) return toast.error("أدخل المبلغ");
    if (!selectedBox) return toast.error(`اختر ${methodLabel}`);

    if (kind === "صرف نقدية") {
      const outflowError = await checkOutflowAllowed(selectedBox.id, amount, selectedBox.name);
      if (outflowError) return toast.error(outflowError);
    }

    const fingerprint = financialOperationFingerprint({
      investorId: form.investor_id,
      kind,
      date: form.date,
      amount,
      cashBoxId: selectedBox.id,
      currency: normalizeCurrency(selectedBox.currency),
    });
    const operationId = getOrCreateFinancialOperationId("investor-cash-movement", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const parent = await ensureFinancialParentRow("investor_transactions", operationId, {
      investor_id: form.investor_id,
      transaction_type: kind,
      date: form.date,
      amount,
      payment_method: selectedBox.name,
      note: form.note.trim() ? form.note.trim() : null,
      statement: form.statement.trim() ? form.statement.trim() : null,
    });
    if (parent.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(parent.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : parent.error, { id: toastId });
      return;
    }

    const movement = await postMovement({
      partyType: "investor",
      partyId: form.investor_id,
      kind: kind === "توريد نقدية" ? "receipt" : "payment",
      date: form.date,
      note: form.note.trim() || undefined,
      statement: form.statement.trim() || undefined,
      sourceTable: "investor_transactions",
      sourceId: parent.id,
      operationId,
      splits: [{
        method: selectedBox.name,
        currency: normalizeCurrency(selectedBox.currency) as "EGP" | "USD" | "LYD",
        cashBoxId: selectedBox.id,
        amount,
        direction: kind === "توريد نقدية" ? "in" : "out",
      }],
    });
    if (!movement.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(movement.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (movement.error || "فشل ربط حركة المالك بالخزينة"), { id: toastId });
      return;
    }

    try { await refetchLiveTables(["investor_transactions", "payment_splits", "cash_boxes"]); } catch { /* realtime will reconcile */ }
    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    setForm({ investor_id: "", date: new Date().toISOString().slice(0, 10), amount: "", cash_box_id: activeBoxes[0]?.id || "", note: "", statement: "" });
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="form-grid">
        <div className="form-group"><label>المالك / المستثمر</label>
          <SearchableSelect value={form.investor_id} onChange={(v) => set("investor_id", v)} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>التاريخ</label><DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday /></div>
        <div className="form-group"><label>المبلغ</label><NumberInput value={Number(form.amount) || 0} onChange={(n) => set("amount", n === 0 ? "" : String(n))} min={0} /></div>
        <div className="form-group"><label>{methodLabel}</label>
          <select value={form.cash_box_id} onChange={(e) => set("cash_box_id", e.target.value)}>
            <option value="">اختر الخزينة...</option>
            {activeBoxes.map((box) => (
              <option key={box.id} value={box.id}>{box.name} — {fmtCurrency(Number(box.balance || 0), box.currency)}</option>
            ))}
          </select>
        </div>
        {selectedBox && (
          <div className="form-group full">
            <div style={{ padding: 10, borderRadius: 9, background: "#F8FAFC", color: "#475569", fontSize: 12 }}>
              العملة: {selectedBox.currency} — الرصيد الحالي: {fmtCurrency(Number(selectedBox.balance || 0), selectedBox.currency)}. هذه الحركة ستؤثر على الخزينة فقط ولن تدخل في صافي الأرباح.
            </div>
          </div>
        )}
        <div className="form-group full"><label>البيان</label><input value={form.statement} onChange={(e) => set("statement", e.target.value)} /></div>
        <div className="form-group full"><label>ملاحظات</label><input value={form.note} onChange={(e) => set("note", e.target.value)} /></div>
      </div>
      <div className="form-footer"><button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "💾 حفظ الحركة"}</button></div>
    </div>
  );
}


function HistoryTab({ txns, investorName, investors, splits }: { txns: InvestorTransaction[]; investorName: (id: string) => string; investors: Investor[]; splits: FinancialPositionSplit[] }) {
  const [investorId, setInvestorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = txns.filter((t) =>
    (!investorId || t.investor_id === investorId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  );
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">📜 سجل حركات المالك / المستثمرين</div></div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
          <SearchableSelect value={investorId} onChange={setInvestorId} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="كل المالكين / المستثمرين" />
          <DateInput value={from} onChange={setFrom} placeholder="من" />
          <DateInput value={to} onChange={setTo} placeholder="إلى" />
          <button className="action-btn" onClick={() => { setInvestorId(""); setFrom(""); setTo(""); }}>إعادة ضبط</button>
        </div>
        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>التاريخ</th><th>المالك / المستثمر</th><th>نوع الحركة</th><th className="num-col">المبلغ</th><th>العملة</th><th>الخزينة</th><th>البيان</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9}><div className="empty"><div className="empty-icon">📜</div><div className="empty-text">لا توجد حركات مالية بعد</div></div></td></tr>
              ) : filtered.map((t, i) => {
                const isDep = t.transaction_type === "توريد نقدية";
                const currency = investorTransactionCurrency(t.id, splits);
                return (
                  <tr key={t.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="التاريخ">{t.date}</td>
                    <td className="bold" data-label="المالك / المستثمر">{investorName(t.investor_id)}</td>
                    <td data-label="نوع الحركة">{t.transaction_type}</td>
                    <td className="num-col" data-label="المبلغ" style={{ color: isDep ? "#15803D" : "#B91C1C", fontWeight: 700 }}>{fmtCurrency(Number(t.amount || 0), currency)}</td>
                    <td data-label="العملة">{currency}</td>
                    <td data-label="الخزينة">{t.payment_method || "حركة قديمة غير مربوطة"}</td>
                    <td data-label="البيان">{(t as any).statement || ""}</td>
                    <td data-label="ملاحظات">{t.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatementTab({ txns, investors, splits, canExport }: { txns: InvestorTransaction[]; investors: Investor[]; splits: FinancialPositionSplit[]; canExport: boolean }) {
  const [investorId, setInvestorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const investor = investors.find((i) => i.id === investorId);
  const filtered = useMemo(() => txns.filter((t) =>
    (!investorId || t.investor_id === investorId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  ), [txns, investorId, from, to]);
  const totals = useMemo(
    () => buildInvestorCapitalSummary(filtered, splits, { includeLegacy: true }),
    [filtered, splits],
  );

  const buildData = () => ({
    title: `كشف حساب المالك / المستثمر${investor?.investor_name ? ` — ${investor.investor_name}` : ""}`,
    subtitle: investor ? investor.investor_name : "كل المالكين / المستثمرين",
    fileName: buildArabicFileName("كشف حساب المالك المستثمر", investor?.investor_name),
    summary: [
      { label: "إجمالي التوريد", value: formatCurrencyMap(totals.deposit) },
      { label: "إجمالي الصرف", value: formatCurrencyMap(totals.withdraw) },
      { label: "الرصيد", value: formatCurrencyMap(totals.balance) },
    ],
    columns: [
      { header: "#", key: "n" },
      { header: "التاريخ", key: "date" },
      { header: "نوع الحركة", key: "type" },
      { header: "المبلغ", key: "amount" },
      { header: "العملة", key: "currency" },
      { header: "الخزينة", key: "method" },
      { header: "البيان", key: "statement" },
      { header: "ملاحظات", key: "note" },
    ],
    rows: filtered.map((t, i) => {
      const amount = Number(t.amount || 0);
      const currency = investorTransactionCurrency(t.id, splits);
      return {
        n: i + 1,
        date: t.date,
        type: t.transaction_type,
        amount: fmtCurrency(amount, currency),
        amount__excel: amount,
        currency,
        method: t.payment_method || "حركة قديمة غير مربوطة",
        statement: (t as any).statement || "",
        note: t.note || "—",
      };
    }),
  });

  useRegisterStatementCapture(
    () => ({ data: buildData(), whatsapp: (investor as any)?.whatsapp || null, contextId: investor?.id || null }),
    [investor, from, to, filtered.length, splits.length, totals.linkedTransactionCount, totals.legacyTransactionCount],
  );

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="card-title">🧾 كشف حساب المالك / المستثمر</div>
        {canExport && <ExportButton disabled={filtered.length === 0} getData={buildData} whatsapp={{ phone: (investor as any)?.whatsapp || (investor as any)?.phone || null, recipientName: (investor as any)?.investor_name || null }} />}
      </div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
          <div className="form-group"><label>المالك / المستثمر</label>
            <SearchableSelect value={investorId} onChange={setInvestorId} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="اختر..." />
          </div>
          <div className="form-group"><label>التاريخ من</label><DateInput value={from} onChange={setFrom} /></div>
          <div className="form-group"><label>التاريخ إلى</label><DateInput value={to} onChange={setTo} /></div>
        </div>

        {investor && (
          <div className="account-summary" style={{ marginBottom: 12 }}>
            <div className="sum-box"><div className="label">المالك / المستثمر</div><div className="val">{investor.investor_name}</div></div>
            <div className="sum-box green"><div className="label">إجمالي التوريد</div><div className="val"><CurrencyLines map={totals.deposit} /></div></div>
            <div className="sum-box red"><div className="label">إجمالي الصرف</div><div className="val"><CurrencyLines map={totals.withdraw} /></div></div>
            <div className="sum-box gold"><div className="label">الرصيد</div><div className="val"><CurrencyLines map={totals.balance} /></div></div>
          </div>
        )}

        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>التاريخ</th><th>نوع الحركة</th><th className="num-col">المبلغ</th><th>العملة</th><th>الخزينة</th><th>البيان</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8}><div className="empty"><div className="empty-icon">🧾</div><div className="empty-text">لا توجد حركات في الفترة المحددة</div></div></td></tr>
              ) : filtered.map((t, i) => {
                const isDep = t.transaction_type === "توريد نقدية";
                const currency = investorTransactionCurrency(t.id, splits);
                return (
                  <tr key={t.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="التاريخ">{t.date}</td>
                    <td className="bold" data-label="نوع الحركة">{t.transaction_type}</td>
                    <td className="num-col" data-label="المبلغ" style={{ color: isDep ? "#15803D" : "#B91C1C", fontWeight: 700 }}>{fmtCurrency(Number(t.amount || 0), currency)}</td>
                    <td data-label="العملة">{currency}</td>
                    <td data-label="الخزينة">{t.payment_method || "حركة قديمة غير مربوطة"}</td>
                    <td data-label="البيان">{(t as any).statement || ""}</td>
                    <td data-label="ملاحظات">{t.note || "—"}</td>
                  </tr>
                );
              })}
              {filtered.length > 0 && (
                <tr style={{ background: "#F8FAFC", fontWeight: 800 }}>
                  <td colSpan={3} data-label="الإجمالي">الرصيد</td>
                  <td colSpan={5} data-label="الرصيد"><CurrencyLines map={totals.balance} /></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InvestorsListTab({ investors, txns, splits, canEdit }: { investors: Investor[]; txns: InvestorTransaction[]; splits: FinancialPositionSplit[]; canEdit: boolean }) {
  const [edit, setEdit] = useState<Investor | null>(null);
  const totals = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildInvestorCapitalSummary>>();
    for (const investor of investors) {
      map.set(
        investor.id,
        buildInvestorCapitalSummary(txns.filter((t) => t.investor_id === investor.id), splits, { includeLegacy: true }),
      );
    }
    return map;
  }, [investors, txns, splits]);

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">🧑‍💼 قائمة المالكين / المستثمرين</div></div>
      <div className="card-body">
        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>المالك / المستثمر</th><th>الهاتف</th><th>الواتساب</th><th className="num-col">إجمالي التوريد</th><th className="num-col">إجمالي الصرف</th><th className="num-col">الرصيد</th><th>إجراءات</th></tr></thead>
            <tbody>
              {investors.length === 0 ? (
                <tr><td colSpan={8}><div className="empty"><div className="empty-icon">🧑‍💼</div><div className="empty-text">لا يوجد مالكون / مستثمرون</div></div></td></tr>
              ) : investors.map((inv, i) => {
                const t = totals.get(inv.id) || buildInvestorCapitalSummary([], [], { includeLegacy: true });
                return (
                  <tr key={inv.id}>
                    <td data-label="#">{i + 1}</td>
                    <td className="bold" data-label="المالك / المستثمر">{inv.investor_name}</td>
                    <td data-label="الهاتف">{inv.phone || "—"}</td>
                    <td data-label="الواتساب">{inv.whatsapp || "—"}</td>
                    <td className="num-col" data-label="إجمالي التوريد" style={{ color: "#15803D", fontWeight: 700 }}><CurrencyLines map={t.deposit} /></td>
                    <td className="num-col" data-label="إجمالي الصرف" style={{ color: "#B91C1C", fontWeight: 700 }}><CurrencyLines map={t.withdraw} /></td>
                    <td className="num-col" data-label="الرصيد" style={{ fontWeight: 800 }}><CurrencyLines map={t.balance} /></td>
                    <td data-label="إجراءات">{canEdit ? <button className="action-btn" onClick={() => setEdit(inv)}>✏️ تعديل</button> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {edit && canEdit && <EditInvestorModal investor={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditInvestorModal({ investor, onClose }: { investor: Investor; onClose: () => void }) {
  const [form, setForm] = useState({
    investor_name: investor.investor_name || "",
    phone: investor.phone || "",
    whatsapp: investor.whatsapp || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.investor_name.trim()) return toast.error("اسم المستثمر مطلوب");
    setSaving(true);
    const { error } = await supabase.from("investors").update({
      investor_name: form.investor_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
    }).eq("id", investor.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">✏️ تعديل بيانات المستثمر</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم المستثمر</label><input value={form.investor_name} onChange={(e) => set("investor_name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
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
