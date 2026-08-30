// Cash movement forms — يستخدمون الآن Financial Engine (postMovement) لضمان
// أن كل حركة مالية تمر عبر نقطة كتابة واحدة موحّدة تنعكس تلقائياً على:
// كشف الجهة + رصيد الجهة + رصيد الخزنة + الداشبورد + التقارير.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLive, type Agent, type Merchant, type IssuingCompany } from "@/lib/db";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { DateInput } from "@/components/inputs/DateInput";
import { usePersistentState } from "@/hooks/usePersistentState";
import { activeOptions } from "@/lib/activeFilter";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { confirmFinancialOperation, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";
import { buildMerchantCashOutToCompanyCounterpartRows, buildMerchantCashOutToAgentCounterpartRows } from "@/lib/merchantCounterparty";
import { resolveCompanyCashBoxForSplit } from "@/lib/balanceGuard";
import { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";
import {
  PaymentSplits,
  newPaymentSplitRow,
  validatePaymentSplits,
  filterValidSplits,

  type PaymentSplitRow,
} from "@/components/PaymentSplits";

type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

/**
 * تحويل PaymentSplitRow (من الـ UI) إلى MovementSplit (للـ Engine)
 * — مركز واحد للـ method labels وربط cash_box_id.
 */
function mapSplitsForEngine(
  rows: PaymentSplitRow[],
  cashBoxes: CashBox[],
  direction: "in" | "out",
): MovementSplit[] {
  return rows.map((r) => {
    const a = Number(r.amount) || 0;
    let methodLabel = "نقدي";
    let cashBoxId: string | null = null;
    if (r.method === "company_instapay") {
      methodLabel = "إنستاباي";
      const box = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method);
      cashBoxId = box?.id || null;
    } else if (r.method === "company_cash") {
      methodLabel = "نقدي";
      const box = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method);
      cashBoxId = box?.id || null;
    } else if (r.method === "merchant_instapay") methodLabel = "انستا";
    else if (r.method === "merchant_wallet") methodLabel = "فودافون كاش";
    else if (r.method === "merchant_physical") methodLabel = "نقدي";
    return {
      method: methodLabel,
      currency: r.currency as "EGP" | "USD" | "LYD",
      cashBoxId,
      amount: a,
      direction,
      grossAmount: a,
      netAmount: a,
      exchangeRate: 1,
      egpEquivalent: r.currency === "EGP" ? a : 0,
    };
  });
}

function singleCurrencyOrError(rows: PaymentSplitRow[]): "EGP" | "USD" | "LYD" | null {
  const first = rows[0]?.currency;
  if (!first) return null;
  return rows.every((r) => r.currency === first) ? first : null;
}

function validateSingleCurrency(rows: PaymentSplitRow[]): string | null {
  if (!rows[0]?.currency) return "يجب اختيار العملة";
  return rows.every((r) => r.currency === rows[0].currency)
    ? null
    : "لا يمكن حفظ حركة واحدة بأكثر من عملة؛ أضف حركة منفصلة لكل عملة";
}


/* ============================ AGENT CASH OUT ============================ */
export function AgentCashOutForm({ initialAgentId, onDone }: { initialAgentId?: string; onDone?: () => void }) {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");

  const draftKey = `draft:agent-cash-out:${initialAgentId || "new"}`;
  const [agentId, setAgentId, clearAgentId] = usePersistentState<string>(`${draftKey}:agentId`, initialAgentId || "");
  const [date, setDate, clearDate] = usePersistentState<string>(`${draftKey}:date`, new Date().toISOString().slice(0, 10));
  const [note, setNote, clearNote] = usePersistentState<string>(`${draftKey}:note`, "");
  const [statement, setStatement, clearStatement] = usePersistentState<string>(`${draftKey}:statement`, "");
  const [splits, setSplits, clearSplits] = usePersistentState<PaymentSplitRow[]>(`${draftKey}:splits`, [newPaymentSplitRow()]);
  const [saving, setSaving] = useState(false);
  const resetDraft = () => { clearAgentId(); clearDate(); clearNote(); clearStatement(); clearSplits(); };


  const total = useMemo(() => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0), [splits]);

  const save = async () => {
    if (!agentId) return toast.error("اختر الوكيل");
    if (!date) return toast.error("التاريخ مطلوب");
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    const valid = filterValidSplits(splits);
    const currencyErr = validateSingleCurrency(valid);
    if (currencyErr) return toast.error(currencyErr);

    const merchantDbErr = await assertMerchantOutflowsAllowed(valid);
    if (merchantDbErr) return toast.error(merchantDbErr);

    const companyBoxError = valid.find((r) =>
      r.source === "company" && !resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method)
    );
    if (companyBoxError) return toast.error(`لا توجد خزنة شركة مطابقة لوسيلة الدفع المختارة بعملة ${companyBoxError.currency}`);

    const engineSplits = mapSplitsForEngine(valid, cashBoxes, "out");
    const fingerprint = financialOperationFingerprint({
      agentId,
      date,
      splits: valid.map((r) => ({ source: r.source, merchantId: r.merchant_id || null, method: r.method, currency: r.currency, amount: Number(r.amount) || 0 })),
    });
    const operationId = getOrCreateFinancialOperationId("agent-cash-out", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const counterpartRows = buildMerchantCashOutToAgentCounterpartRows({
      splits: valid,
      agentTransactionId: operationId,
      date,
      statement: statement.trim() || "صرف نقدية لوكيل",
      note: note.trim() || undefined,
    });
    const res = await postMovement({
      partyType: "agent",
      partyId: agentId,
      kind: "payment",
      date,
      note: note.trim() ? note.trim() : undefined,
      statement: statement.trim() ? statement.trim() : undefined,
      splits: engineSplits,
      operationId,
      atomicFingerprint: fingerprint,
      atomicExtraRows: counterpartRows,
    });

    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر حفظ الحركة"), { id: toastId });
      return;
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    resetDraft();
    onDone?.();
  };


  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💸 صرف نقدية للوكيل</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الوكيل *</label>
          <SearchableSelect value={agentId} onChange={setAgentId} options={activeOptions(agents, agentId, (a) => a.name)} placeholder="اختر..." disabled={!!initialAgentId} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={date} onChange={setDate} defaultToday />
        </div>
        <div className="form-group full"><label>البيان</label>
          <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="" />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="" />
        </div>

      </div>

      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} title="سطور الدفع" />

      <div style={{ padding: "0 8px", textAlign: "end", fontWeight: 600 }}>
        الإجمالي: {total.toLocaleString()}
      </div>
      <div className="form-footer">
        <button data-confirm-save="تأكيد صرف النقدية" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الصرف</button>
      </div>
    </div>
  );
}

/* ============================ MERCHANT CASH OUT ============================ */
export function MerchantCashOutForm({ initialMerchantId, onDone }: { initialMerchantId?: string; onDone?: () => void }) {
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");

  const draftKey = `draft:merchant-cash-out:${initialMerchantId || "new"}`;
  const [merchantId, setMerchantId, clearMerchantId] = usePersistentState<string>(`${draftKey}:merchantId`, initialMerchantId || "");
  const [date, setDate, clearDate] = usePersistentState<string>(`${draftKey}:date`, new Date().toISOString().slice(0, 10));
  const [note, setNote, clearNote] = usePersistentState<string>(`${draftKey}:note`, "");
  const [statement, setStatement, clearStatement] = usePersistentState<string>(`${draftKey}:statement`, "");
  const [splits, setSplits, clearSplits] = usePersistentState<PaymentSplitRow[]>(`${draftKey}:splits`, [newPaymentSplitRow()]);
  const [saving, setSaving] = useState(false);
  const resetDraft = () => { clearMerchantId(); clearDate(); clearNote(); clearStatement(); clearSplits(); };

  const total = useMemo(() => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0), [splits]);

  const save = async () => {
    if (!merchantId) return toast.error("اختر التاجر");
    if (!date) return toast.error("التاريخ مطلوب");
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    const valid = filterValidSplits(splits);
    const currencyErr = validateSingleCurrency(valid);
    if (currencyErr) return toast.error(currencyErr);

    const merchantDbErr = await assertMerchantOutflowsAllowed(valid);
    if (merchantDbErr) return toast.error(merchantDbErr);

    const companyBoxError = valid.find((r) =>
      r.source === "company" && !resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method)
    );
    if (companyBoxError) return toast.error(`لا توجد خزنة شركة مطابقة لوسيلة الدفع المختارة بعملة ${companyBoxError.currency}`);

    const engineSplits = mapSplitsForEngine(valid, cashBoxes, "out");
    const fingerprint = financialOperationFingerprint({
      merchantId,
      date,
      splits: valid.map((r) => ({ source: r.source, merchantId: r.merchant_id || null, method: r.method, currency: r.currency, amount: Number(r.amount) || 0 })),
    });
    const operationId = getOrCreateFinancialOperationId("merchant-cash-out", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const res = await postMovement({
      partyType: "merchant",
      partyId: merchantId,
      kind: "payment",
      date,
      note: note.trim() ? note.trim() : undefined,
      statement: statement.trim() ? statement.trim() : undefined,
      splits: engineSplits,
      operationId,
      atomicFingerprint: fingerprint,
    });
    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر حفظ الحركة"), { id: toastId });
      return;
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    resetDraft();
    onDone?.();
  };



  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💸 صرف نقدية للتاجر</div></div>
      <div className="form-grid">
        <div className="form-group"><label>التاجر *</label>
          <SearchableSelect value={merchantId} onChange={setMerchantId} options={activeOptions(merchants, merchantId, (m) => m.merchant_name)} placeholder="اختر..." disabled={!!initialMerchantId} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={date} onChange={setDate} defaultToday />
        </div>
        <div className="form-group full"><label>البيان</label>
          <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="" />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="" />
        </div>

      </div>

      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} title="سطور الدفع" />

      <div style={{ padding: "0 8px", textAlign: "end", fontWeight: 600 }}>
        الإجمالي: {total.toLocaleString()}
      </div>
      <div className="form-footer">
        <button data-confirm-save="تأكيد صرف النقدية للتاجر" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الصرف</button>
      </div>
    </div>
  );
}


/* ============================ COMPANY CASH SUPPLY ============================ */
export function CompanySupplyForm({ initialCompanyId, onDone }: { initialCompanyId?: string; onDone?: () => void }) {
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");

  const draftKey = `draft:company-supply:${initialCompanyId || "new"}`;
  const [companyId, setCompanyId, clearCompanyId] = usePersistentState<string>(`${draftKey}:companyId`, initialCompanyId || "");
  const [date, setDate, clearDate] = usePersistentState<string>(`${draftKey}:date`, new Date().toISOString().slice(0, 10));
  const [note, setNote, clearNote] = usePersistentState<string>(`${draftKey}:note`, "");
  const [statement, setStatement, clearStatement] = usePersistentState<string>(`${draftKey}:statement`, "");
  const [splits, setSplits, clearSplits] = usePersistentState<PaymentSplitRow[]>(`${draftKey}:splits`, [newPaymentSplitRow()]);
  const [saving, setSaving] = useState(false);
  const resetDraft = () => { clearCompanyId(); clearDate(); clearNote(); clearStatement(); clearSplits(); };


  const total = useMemo(() => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0), [splits]);

  const save = async () => {
    if (!companyId) return toast.error("اختر الشركة الصادرة");
    if (!date) return toast.error("التاريخ مطلوب");
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    const valid = filterValidSplits(splits);
    const selectedCurrency = singleCurrencyOrError(valid);
    const currencyErr = validateSingleCurrency(valid);
    if (currencyErr) return toast.error(currencyErr);

    const merchantDbErr = await assertMerchantOutflowsAllowed(valid);
    if (merchantDbErr) return toast.error(merchantDbErr);

    // Aggregate for company_transactions metadata row (kept for ledger display).
    let instapay = 0, cash = 0, merchantWallet = 0, merchantPhysical = 0;
    for (const r of valid) {
      const a = Number(r.amount) || 0;
      if (r.method === "company_instapay" || r.method === "merchant_instapay") instapay += a;
      else if (r.method === "company_cash") cash += a;
      else if (r.method === "merchant_wallet") merchantWallet += a;
      else if (r.method === "merchant_physical") merchantPhysical += a;
    }
    const firstMerchant = valid.find((r) => r.source === "merchant")?.merchant_id || null;

    const companyBoxError = valid.find((r) =>
      r.source === "company" && !resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method)
    );
    if (companyBoxError) return toast.error(`لا توجد خزنة شركة مطابقة لوسيلة الدفع المختارة بعملة ${companyBoxError.currency}`);

    const engineSplits = mapSplitsForEngine(valid, cashBoxes, "in");
    const fingerprint = financialOperationFingerprint({
      companyId,
      date,
      splits: valid.map((r) => ({ source: r.source, merchantId: r.merchant_id || null, method: r.method, currency: r.currency, amount: Number(r.amount) || 0 })),
    });
    const operationId = getOrCreateFinancialOperationId("company-cash-supply", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const parentPayload = {
      company_id: companyId,
      date,
      count: 0,
      price: 0,
      trip_value: 0,
      instapay_amount: -instapay,
      cash_amount: -cash,
      merchant_cash_amount: -merchantWallet,
      merchant_cash_net_amount: -merchantWallet,
      merchant_cash_physical_amount: -merchantPhysical,
      total_paid: -total,
      currency: selectedCurrency,
      payment_currency: selectedCurrency,
      merchant_id: firstMerchant,
      note: note.trim() ? note.trim() : null,
      statement: statement.trim() ? statement.trim() : null,
      source_service_type: "company_cash_supply",
    };
    const counterpartRows = buildMerchantCashOutToCompanyCounterpartRows({
      splits: valid,
      companyTransactionId: operationId,
      date,
      statement: statement.trim() || "صادر لشركة",
      note: note.trim() || undefined,
    });
    const res = await postMovement({
      partyType: "company",
      partyId: companyId,
      kind: "receipt",
      date,
      note: note.trim() ? note.trim() : undefined,
      statement: statement.trim() ? statement.trim() : undefined,
      splits: engineSplits,
      operationId,
      atomicFingerprint: fingerprint,
      atomicParent: {
        table: "company_transactions",
        id: operationId,
        payload: parentPayload,
      },
      atomicExtraRows: counterpartRows,
    });
    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر حفظ الحركة المالية"), { id: toastId });
      return;
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    resetDraft();
    onDone?.();
  };


  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💰 توريد نقدية من الشركة الصادرة</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الشركة الصادرة *</label>
          <SearchableSelect value={companyId} onChange={setCompanyId} options={activeOptions(companies, companyId, (c) => c.company_name)} placeholder="اختر..." disabled={!!initialCompanyId} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={date} onChange={setDate} defaultToday />
        </div>
        <div className="form-group full"><label>البيان</label>
          <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="" />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="" />
        </div>

      </div>

      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} title="سطور الدفع" />

      <div style={{ padding: "0 8px", textAlign: "end", fontWeight: 600 }}>
        الإجمالي: {total.toLocaleString()}
      </div>
      <div className="form-footer">
        <button data-confirm-save="تأكيد توريد النقدية" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التوريد</button>
      </div>
    </div>
  );
}
