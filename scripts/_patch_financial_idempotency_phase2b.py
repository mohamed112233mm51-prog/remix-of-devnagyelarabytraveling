from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_between_after(text: str, anchor: str, start: str, end: str, new: str, label: str) -> str:
    a = text.find(anchor)
    if a < 0:
        raise RuntimeError(f"{label}: anchor not found")
    i = text.find(start, a)
    if i < 0:
        raise RuntimeError(f"{label}: start not found")
    j = text.find(end, i)
    if j < 0:
        raise RuntimeError(f"{label}: end not found")
    j += len(end)
    return text[:i] + new + text[j:]


def patch_expenses() -> None:
    path = ROOT / "src/features/expenses/LegacyExpensesRoute.tsx"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\n',
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, ensureFinancialChildRows, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "expenses import",
    )
    text = replace_once(
        text,
        '  const [splits, setSplits] = useState<PaymentSplitRow[]>([newPaymentSplitRow()]);\n',
        '  const [splits, setSplits] = useState<PaymentSplitRow[]>([newPaymentSplitRow()]);\n  const [saving, setSaving] = useState(false);\n',
        "expenses saving state",
    )

    new_insert = '''    for (const r of valid) {
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

    const expenseRow = await ensureFinancialParentRow("expenses", operationId, expensePayload);
    if (expenseRow.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(expenseRow.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : expenseRow.error, { id: toastId });
      return;
    }

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

    const deductions = await ensureFinancialChildRows("expense_deductions", operationId, "deduction", deductionRows);
    if (deductions.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(deductions.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : deductions.error, { id: toastId });
      return;
    }

    if (engineSplits.length) {
      const res = await postMovement({
        partyType: "expense",
        partyId: expenseRow.id,
        kind: "expense",
        date: form.date,
        note: form.notes.trim() ? form.notes.trim() : undefined,
        statement: form.statement.trim() ? form.statement.trim() : undefined,
        splits: engineSplits,
        sourceTable: "expenses",
        sourceId: expenseRow.id,
        operationId,
      });
      if (!res.ok) {
        setSaving(false);
        toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر تحديث رصيد الخزنة"), { id: toastId });
        return;
      }
    }

    const collections = await ensureFinancialChildRows("merchant_cash_collections", operationId, "merchant-collection", collectionRows);
    if (collections.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(collections.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : collections.error, { id: toastId });
      return;
    }

    if (!expenseRow.reused) {
      try { await logCreate("expenses", expenseRow.id, { ...expensePayload, id: expenseRow.id }, "مصروف"); } catch { /* non-blocking audit */ }
    }
    for (let i = 0; i < deductions.ids.length; i += 1) {
      try { await logCreate("expense_deductions", deductions.ids[i], { ...deductionRows[i], id: deductions.ids[i] }, "خصم مصروف"); } catch { /* non-blocking audit */ }
    }
    for (let i = 0; i < collections.ids.length; i += 1) {
      try { await logCreate("merchant_cash_collections", collections.ids[i], { ...collectionRows[i], id: collections.ids[i] }, "خصم رصيد تاجر (مصروف)"); } catch { /* non-blocking audit */ }
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
    onDone?.();'''
    text = replace_between_after(
        text,
        "function ExpenseForm",
        "    const { data: expenseRow, error } = await supabase\n      .from(\"expenses\").insert(expensePayload).select(\"id\").single();",
        "    onDone?.();",
        new_insert,
        "expense insert flow",
    )
    text = replace_once(
        text,
        '<button data-confirm-save={initial ? "تأكيد حفظ تعديلات المصروف" : "تأكيد حفظ المصروف"} className="btn btn-gold" onClick={save}>💾 {initial ? "حفظ التعديلات" : "حفظ المصروف"}</button>',
        '<button data-confirm-save={initial ? "تأكيد حفظ تعديلات المصروف" : "تأكيد حفظ المصروف"} className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ التأكيد..." : `💾 ${initial ? "حفظ التعديلات" : "حفظ المصروف"}`}</button>',
        "expense save button",
    )
    path.write_text(text, encoding="utf-8")


def patch_currency_supplier() -> None:
    path = ROOT / "src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\n',
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, ensureFinancialChildRows, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "currency supplier import",
    )

    apply_new = '''async function applyTransaction(opts: {
  kind: "شراء عملة" | "بيع عملة";
  supplierId: string;
  txId: string;
  txDate: string;
  foreignCurrency: string;
  foreignAmount: number;
  splits: SplitJson[];
  boxes: CashBox[];
  description: string;
  operationId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { kind, supplierId, txId, txDate, foreignCurrency, foreignAmount, splits, boxes, description, operationId } = opts;
  const isBuy = kind === "شراء عملة";
  const foreignBox = resolveForeignBox(boxes, foreignCurrency);
  if (foreignAmount > 0 && !foreignBox) return { ok: false, error: `لا توجد خزينة فعالة للعملة ${foreignCurrency}` };

  const engineSplits: MovementSplit[] = [];
  const merchantRows: Record<string, unknown>[] = [];

  if (foreignBox && foreignAmount > 0) {
    engineSplits.push({
      method: "نقدي",
      currency: foreignCurrency as "EGP" | "USD" | "LYD",
      cashBoxId: foreignBox.id,
      amount: foreignAmount,
      direction: isBuy ? "in" : "out",
      grossAmount: foreignAmount,
      netAmount: foreignAmount,
      exchangeRate: 1,
      egpEquivalent: 0,
    });
  }

  for (const s of splits) {
    const amt = Number(s.amount || 0);
    if (!amt) continue;
    const dir: "in" | "out" = isBuy ? "out" : "in";
    let cashBoxId: string | null = null;
    if (s.source === "company") {
      const companyBox = resolveCompanyEgpBox(boxes, s.method);
      if (!companyBox) return { ok: false, error: `لا توجد خزينة شركة مطابقة لوسيلة الدفع ${methodLabelFor(s)}` };
      cashBoxId = companyBox.id;
    }
    engineSplits.push({
      method: methodLabelFor(s),
      currency: "EGP",
      cashBoxId,
      amount: amt,
      direction: dir,
      grossAmount: amt,
      netAmount: amt,
      exchangeRate: 1,
      egpEquivalent: amt,
    });

    if (s.source === "merchant" && s.merchant_id) {
      merchantRows.push({
        merchant_id: s.merchant_id,
        date: txDate,
        amount: isBuy ? amt : -amt,
        note: null,
        statement: description?.trim() ? description.trim() : null,
      });
    }
  }

  const merchantResult = await ensureFinancialChildRows("merchant_cash_collections", operationId, "supplier-merchant", merchantRows);
  if (merchantResult.error) return { ok: false, error: merchantResult.error };
  if (engineSplits.length === 0) return { ok: true };

  const res = await postMovement({
    partyType: "currency_supplier",
    partyId: supplierId,
    kind: isBuy ? "payment" : "receipt",
    date: txDate,
    statement: description?.trim() || undefined,
    splits: engineSplits,
    sourceTable: "currency_supplier_transactions",
    sourceId: txId,
    operationId,
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error || "تعذر تسجيل الحركة في الخزائن" };
}'''
    text = replace_between_after(
        text,
        "async function applyTransaction(opts:",
        "async function applyTransaction(opts:",
        "}\n\n// Reverse a previously-applied transaction",
        apply_new + "\n\n// Reverse a previously-applied transaction",
        "applyTransaction",
    )

    text = replace_once(
        text,
        '  const [description, setDescription] = useState<string>("");\n',
        '  const [description, setDescription] = useState<string>("");\n  const [saving, setSaving] = useState(false);\n',
        "tx modal saving state",
    )

    tx_parent_old = '''    const { data: inserted, error } = await supabase
      .from("currency_supplier_transactions" as any)
      .insert(payload)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    const txId = (inserted as any)?.id as string;
    await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind);

    await applyTransaction({
      kind,
      supplierId,
      txId,
      txDate,
      foreignCurrency,
      foreignAmount: a,
      splits: splitsJson,
      boxes,
      description: description.trim(),
    });'''
    tx_parent_new = '''    const fingerprint = financialOperationFingerprint({
      supplierId,
      kind,
      txDate,
      foreignCurrency,
      foreignAmount: a,
      rate: r,
      egpAmount: e,
      commission: commissionValue,
      splits: splitsJson,
    });
    const operationId = getOrCreateFinancialOperationId("currency-supplier-trade", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const parent = await ensureFinancialParentRow("currency_supplier_transactions", operationId, payload);
    if (parent.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(parent.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : parent.error, { id: toastId });
      return;
    }
    const txId = parent.id;
    if (!parent.reused) {
      try { await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind); } catch { /* non-blocking audit */ }
    }

    const applied = await applyTransaction({
      kind,
      supplierId,
      txId,
      txDate,
      foreignCurrency,
      foreignAmount: a,
      splits: splitsJson,
      boxes,
      description: description.trim(),
      operationId,
    });
    if (!applied.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(applied.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (applied.error || "تعذر تسجيل الحركة المالية"), { id: toastId });
      return;
    }'''
    text = replace_once(text, tx_parent_old, tx_parent_new, "trade parent flow")
    text = replace_once(
        text,
        '''    toast.success("تم حفظ الحركة");
    onSaved();''',
        '''    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    onSaved();''',
        "trade success",
    )
    text = replace_once(
        text,
        '<button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button>',
        '<button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ التأكيد..." : "💾 حفظ الحركة"}</button>',
        "trade button",
    )

    # Cash movement modal is the second modal, so add a separate saving state after its note state.
    cash_anchor = 'function CashMovementModal({' 
    aidx = text.find(cash_anchor)
    if aidx < 0:
      raise RuntimeError("cash modal anchor missing")
    state_old = '  const [note, setNote] = useState<string>("");\n'
    sidx = text.find(state_old, aidx)
    if sidx < 0:
      raise RuntimeError("cash modal note state missing")
    text = text[:sidx] + state_old + '  const [saving, setSaving] = useState(false);\n' + text[sidx + len(state_old):]

    cash_old = '''    const { data: inserted, error } = await supabase
      .from("currency_supplier_transactions" as any)
      .insert(payload)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    const txId = (inserted as any)?.id as string;
    await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind);

    // ==== Build engine splits + merchant side-effects ====
    const engineSplits: MovementSplit[] = [];
    for (const r of validSplits) {
      const amt = Number(r.amount) || 0;
      if (!amt) continue;
      let cashBoxId: string | null = null;
      if (r.source === "company") {
        cashBoxId = resolveCompanyBoxForSplit(boxes, r.currency, r.method)?.id || null;
      }
      engineSplits.push({
        method: methodLabelForSplit(r.method),
        currency,
        cashBoxId,
        amount: amt,
        direction: isOut ? "out" : "in",
        grossAmount: amt,
        netAmount: amt,
        exchangeRate: 1,
        egpEquivalent: currency === "EGP" ? amt : 0,
      });

      // Merchant balance is aggregated from merchant_cash_collections.
      // Convention (see applyTransaction): "buy"/"pay-out" via merchant → +amount
      // (merchant absorbs the outflow on our behalf); collection/receipt → -amount.
      if (r.source === "merchant" && r.merchant_id) {
        const signed = isOut ? +amt : -amt;
        await supabase.from("merchant_cash_collections").insert({
          merchant_id: r.merchant_id,
          date: txDate,
          amount: signed,
          note: null,
          statement: description.trim() ? description.trim() : null,
        });
      }
    }

    const res = await postMovement({
      partyType: "currency_supplier",
      partyId: supplierId,
      kind: isOut ? "payment" : "receipt",
      date: txDate,
      note: note.trim() || undefined,
      statement: description.trim() || undefined,
      splits: engineSplits,
      sourceTable: "currency_supplier_transactions",
      sourceId: txId,
    });
    if (!res.ok) {
      toast.error(res.error || "تعذر تسجيل الحركة في الخزائن");
      return;
    }

    toast.success(isOut ? "تم صرف المبلغ للمورد" : "تم تسجيل استلام المبلغ من المورد");
    onSaved();'''
    cash_new = '''    for (const r of validSplits) {
      if (r.source !== "company") continue;
      if (!resolveCompanyBoxForSplit(boxes, r.currency, r.method)) {
        return toast.error(`لا توجد خزينة شركة لـ ${methodLabelForSplit(r.method)} بعملة ${r.currency}`);
      }
    }

    const fingerprint = financialOperationFingerprint({
      supplierId,
      kind,
      txDate,
      currency,
      amount: amountNum,
      splits: validSplits.map((r) => ({ source: r.source, merchantId: r.merchant_id || null, method: r.method, currency: r.currency, amount: Number(r.amount) || 0 })),
    });
    const operationId = getOrCreateFinancialOperationId("currency-supplier-cash", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const parent = await ensureFinancialParentRow("currency_supplier_transactions", operationId, payload);
    if (parent.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(parent.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : parent.error, { id: toastId });
      return;
    }
    const txId = parent.id;
    if (!parent.reused) {
      try { await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind); } catch { /* non-blocking audit */ }
    }

    const engineSplits: MovementSplit[] = [];
    const merchantRows: Record<string, unknown>[] = [];
    for (const r of validSplits) {
      const amt = Number(r.amount) || 0;
      if (!amt) continue;
      let cashBoxId: string | null = null;
      if (r.source === "company") cashBoxId = resolveCompanyBoxForSplit(boxes, r.currency, r.method)?.id || null;
      engineSplits.push({
        method: methodLabelForSplit(r.method),
        currency,
        cashBoxId,
        amount: amt,
        direction: isOut ? "out" : "in",
        grossAmount: amt,
        netAmount: amt,
        exchangeRate: 1,
        egpEquivalent: currency === "EGP" ? amt : 0,
      });
      if (r.source === "merchant" && r.merchant_id) {
        merchantRows.push({
          merchant_id: r.merchant_id,
          date: txDate,
          amount: isOut ? +amt : -amt,
          note: null,
          statement: description.trim() ? description.trim() : null,
        });
      }
    }

    const merchantResult = await ensureFinancialChildRows("merchant_cash_collections", operationId, "supplier-cash-merchant", merchantRows);
    if (merchantResult.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(merchantResult.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : merchantResult.error, { id: toastId });
      return;
    }

    const res = await postMovement({
      partyType: "currency_supplier",
      partyId: supplierId,
      kind: isOut ? "payment" : "receipt",
      date: txDate,
      note: note.trim() || undefined,
      statement: description.trim() || undefined,
      splits: engineSplits,
      sourceTable: "currency_supplier_transactions",
      sourceId: txId,
      operationId,
    });
    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر تسجيل الحركة في الخزائن"), { id: toastId });
      return;
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    onSaved();'''
    text = replace_once(text, cash_old, cash_new, "supplier cash flow")

    # Replace the remaining cash-modal save button (the trade button was already changed above).
    button_old = '<button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button>'
    if text.count(button_old) != 1:
      raise RuntimeError(f"cash button expected one remaining match, found {text.count(button_old)}")
    text = text.replace(button_old, '<button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ التأكيد..." : "💾 حفظ الحركة"}</button>', 1)

    path.write_text(text, encoding="utf-8")


def main() -> None:
    patch_expenses()
    patch_currency_supplier()
    print("financial idempotency phase 2b patch applied")


if __name__ == "__main__":
    main()
