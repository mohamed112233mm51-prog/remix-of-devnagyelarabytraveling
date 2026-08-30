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


def patch_cash_movement_forms() -> None:
    path = ROOT / "src/components/CashMovementForms.tsx"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\n',
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "cash forms import",
    )

    agent_new = '''    const companyBoxError = valid.find((r) =>
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

    const res = await postMovement({
      partyType: "agent",
      partyId: agentId,
      kind: "payment",
      date,
      note: note.trim() ? note.trim() : undefined,
      statement: statement.trim() ? statement.trim() : undefined,
      splits: engineSplits,
      operationId,
    });

    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر حفظ الحركة"), { id: toastId });
      return;
    }

    if (res.transactionId) {
      const merchantRes = await postMerchantCashOutToAgentCounterparts({
        splits: valid,
        agentTransactionId: res.transactionId,
        date,
        statement: statement.trim() || "صرف نقدية لوكيل",
        note: note.trim() || undefined,
      });
      if (!merchantRes.ok) {
        setSaving(false);
        toast.error(isLikelyNetworkError(merchantRes.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (merchantRes.error || "تعذر حفظ قيد تاجر الكاش"), { id: toastId });
        return;
      }
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    resetDraft();
    onDone?.();
'''
    text = replace_between_after(
        text,
        "export function AgentCashOutForm",
        "    setSaving(true);\n    const engineSplits = mapSplitsForEngine(valid, cashBoxes, \"out\");",
        "    onDone?.();\n",
        agent_new,
        "agent cash out",
    )

    merchant_new = '''    const companyBoxError = valid.find((r) =>
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
'''
    text = replace_between_after(
        text,
        "export function MerchantCashOutForm",
        "    setSaving(true);\n    const engineSplits = mapSplitsForEngine(valid, cashBoxes, \"out\");",
        "    onDone?.();\n",
        merchant_new,
        "merchant cash out",
    )

    company_new = '''    const companyBoxError = valid.find((r) =>
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
    const txn = await ensureFinancialParentRow("company_transactions", operationId, parentPayload);
    if (txn.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(txn.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : txn.error, { id: toastId });
      return;
    }

    const res = await postMovement({
      partyType: "company",
      partyId: companyId,
      kind: "receipt",
      date,
      note: note.trim() ? note.trim() : undefined,
      statement: statement.trim() ? statement.trim() : undefined,
      splits: engineSplits,
      sourceTable: "company_transactions",
      sourceId: txn.id,
      operationId,
    });
    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر حفظ سطور الدفع"), { id: toastId });
      return;
    }

    const merchantRes = await postMerchantCashOutToCompanyCounterparts({
      splits: valid,
      companyTransactionId: txn.id,
      date,
      statement: statement.trim() || "صادر لشركة",
      note: note.trim() || undefined,
    });
    if (!merchantRes.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(merchantRes.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (merchantRes.error || "تعذر حفظ قيد تاجر الكاش"), { id: toastId });
      return;
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    resetDraft();
    onDone?.();
'''
    text = replace_between_after(
        text,
        "export function CompanySupplyForm",
        "    setSaving(true);\n    // 1) Metadata parent row on company_transactions (negative = cash inflow).",
        "    onDone?.();\n",
        company_new,
        "company supply",
    )

    path.write_text(text, encoding="utf-8")


def patch_companies() -> None:
    path = ROOT / "src/features/companies/LegacyCompaniesRoute.tsx"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\n',
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "companies import",
    )

    new_core = '''    const missingCompanyBox = validSplits.find((r) =>
      r.source === "company" && !resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method)
    );
    if (missingCompanyBox) return toast.error(`لا توجد خزنة شركة مطابقة لوسيلة الدفع المختارة بعملة ${missingCompanyBox.currency}`);

    const engineSplits: MovementSplit[] = validSplits.map((r) => {
      const a = Number(r.amount) || 0;
      let methodLabel = "نقدي";
      let cashBoxId: string | null = null;
      if (r.method === "company_instapay") {
        methodLabel = "إنستاباي";
        cashBoxId = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method)?.id || null;
      } else if (r.method === "company_cash") {
        methodLabel = "نقدي";
        cashBoxId = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method)?.id || null;
      } else if (r.method === "merchant_instapay") methodLabel = "انستا";
      else if (r.method === "merchant_wallet") methodLabel = "فودافون كاش";
      else if (r.method === "merchant_physical") methodLabel = "نقدي";
      return {
        method: methodLabel,
        currency: r.currency as any,
        cashBoxId,
        amount: a,
        direction: "out",
        grossAmount: a,
        commissionRate: 0,
        commissionAmount: 0,
        netAmount: a,
        exchangeRate: 1,
        egpEquivalent: r.currency === "EGP" ? a : 0,
      };
    });

    const fingerprint = financialOperationFingerprint({
      companyId: form.company_id,
      date: form.date,
      destination: form.destination || null,
      serviceType: form.service_type || null,
      count: Number(form.count) || 0,
      price: Number(form.price) || 0,
      splits: validSplits.map((r) => ({ source: r.source, merchantId: r.merchant_id || null, method: r.method, currency: r.currency, amount: Number(r.amount) || 0 })),
    });
    const operationId = getOrCreateFinancialOperationId("company-payment", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const txnRow = await ensureFinancialParentRow("company_transactions", operationId, payload);
    if (txnRow.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(txnRow.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : txnRow.error, { id: toastId });
      return;
    }
    if (!txnRow.reused) {
      try { await logCreate("company_transactions", txnRow.id, { ...payload, id: txnRow.id }, "حركة شركة"); } catch { /* non-blocking audit */ }
    }

    const engineRes = await postMovement({
      partyType: "company",
      partyId: form.company_id,
      kind: "payment",
      date: form.date,
      note: form.note.trim() ? form.note.trim() : undefined,
      statement: form.statement.trim() ? form.statement.trim() : undefined,
      splits: engineSplits,
      sourceTable: "company_transactions",
      sourceId: txnRow.id,
      operationId,
    });
    if (!engineRes.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(engineRes.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (engineRes.error || "تعذر حفظ سطور الدفع"), { id: toastId });
      return;
    }

    const merchantRes = await postMerchantCashOutToCompanyCounterparts({
      splits: validSplits,
      companyTransactionId: txnRow.id,
      date: form.date,
      statement: form.statement.trim() || "صادر لشركة",
      note: form.note.trim() || undefined,
    });
    if (!merchantRes.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(merchantRes.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (merchantRes.error || "تعذر حفظ قيد تاجر الكاش"), { id: toastId });
      return;
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    onDone();
'''
    text = replace_between_after(
        text,
        "function CompanyTxnForm",
        "    setSaving(true);\n    const { data: txnRow, error: txnErr } = await supabase",
        "    onDone();\n",
        new_core,
        "company transaction",
    )
    path.write_text(text, encoding="utf-8")


def patch_merchants() -> None:
    path = ROOT / "src/features/merchants/LegacyMerchantsRoute.tsx"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\n',
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, deriveFinancialOperationUuid, ensureFinancialChildRows, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "merchants import",
    )
    text = replace_once(
        text,
        '  const [rows, setRows] = useState<CollectRow[]>(() => [newCollectRow()]);\n',
        '  const [rows, setRows] = useState<CollectRow[]>(() => [newCollectRow()]);\n  const [saving, setSaving] = useState(false);\n',
        "merchant collect saving state",
    )

    save_new = '''  const save = async () => {
    const valid = rows.filter((r) => Number(r.amount) > 0);
    if (valid.length === 0) return toast.error("أضف سطر تحصيل واحد على الأقل بمبلغ");
    for (const r of valid) {
      if (!r.merchant_id) return toast.error("اختر التاجر لكل سطر");
      if (!r.cash_box_id) return toast.error("اختر خزينة استقبال الشركة لكل سطر");
      const box = companyBoxes.find((b) => b.id === r.cash_box_id);
      if (!box) return toast.error("خزينة الشركة المختارة غير متاحة");
    }

    const enriched = valid.map((r) => {
      const box = companyBoxes.find((b) => b.id === r.cash_box_id)!;
      return { r, box, currency: normalizeCurrency(box.currency) as "EGP" | "USD" | "LYD" };
    });
    const fingerprint = financialOperationFingerprint({
      date,
      rows: enriched.map(({ r, box, currency }) => ({ merchantId: r.merchant_id, cashBoxId: box.id, currency, amount: Number(r.amount) || 0 })),
    });
    const operationId = getOrCreateFinancialOperationId("merchant-cash-collection", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const insertRows = enriched.map(({ r }) => ({
      merchant_id: r.merchant_id,
      date,
      amount: Number(r.amount || 0),
      note: note.trim() ? note.trim() : null,
      statement: statement.trim() ? statement.trim() : null,
    }));
    const childRows = await ensureFinancialChildRows("merchant_cash_collections", operationId, "collection", insertRows);
    if (childRows.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(childRows.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : childRows.error, { id: toastId });
      return;
    }

    for (let i = 0; i < enriched.length; i++) {
      const { r, box, currency } = enriched[i];
      const amt = Number(r.amount || 0);
      const rowOperationId = deriveFinancialOperationUuid(operationId, `collection-movement:${i}`);
      const engineSplits: MovementSplit[] = [{
        method: methodLabelForBox(box),
        currency,
        cashBoxId: box.id,
        amount: amt,
        direction: "in",
        grossAmount: amt,
        netAmount: amt,
        exchangeRate: 1,
        egpEquivalent: currency === "EGP" ? amt : 0,
      }];
      const res = await postMovement({
        partyType: "merchant",
        partyId: r.merchant_id,
        kind: "receipt",
        date,
        statement: statement.trim() || undefined,
        note: note.trim() || undefined,
        splits: engineSplits,
        sourceTable: "merchant_cash_collections",
        sourceId: childRows.ids[i],
        operationId: rowOperationId,
      });
      if (!res.ok) {
        setSaving(false);
        toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر تسجيل الحركة في السجل المالي"), { id: toastId });
        return;
      }
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
    setRows([newCollectRow()]);
    setNote("");
    setStatement("");
  };
'''
    text = replace_between_after(
        text,
        "function CollectForm",
        "  const save = async () => {\n",
        "  };\n\n  const hasAnyCompanyBox",
        save_new + "\n  const hasAnyCompanyBox",
        "merchant collection save",
    )
    text = replace_once(
        text,
        '<div className="form-footer"><button data-confirm-save="تأكيد حفظ التحصيل" className="btn btn-gold" onClick={save} disabled={!hasAnyCompanyBox}>💾 حفظ التحصيل</button></div>',
        '<div className="form-footer"><button data-confirm-save="تأكيد حفظ التحصيل" className="btn btn-gold" onClick={save} disabled={!hasAnyCompanyBox || saving}>{saving ? "جارٍ التأكيد..." : "💾 حفظ التحصيل"}</button></div>',
        "merchant collection button",
    )
    path.write_text(text, encoding="utf-8")


def patch_investors() -> None:
    path = ROOT / "src/routes/investors.tsx"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { checkOutflowAllowed, postMovement } from "@/lib/financialEngine";\n',
        'import { checkOutflowAllowed, postMovement } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "investors import",
    )
    save_new = '''  const save = async () => {
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
'''
    text = replace_between_after(
        text,
        "function TxnForm",
        "  const save = async () => {\n",
        "  };\n\n  return (",
        save_new + "\n  return (",
        "investor save",
    )
    path.write_text(text, encoding="utf-8")


def patch_reports() -> None:
    path = ROOT / "src/routes/reports.tsx"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { checkOutflowAllowed, postCashBoxTransfer, postMovement } from "@/lib/financialEngine";\n',
        'import { checkOutflowAllowed, postCashBoxTransfer, postMovement } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "reports import",
    )

    transfer_new = '''  const save = async () => {
    if (!fromBox || !toBox) { toast.error("اختر الخزينة المحول منها والخزينة المحول إليها"); return; }
    if (fromBox.id === toBox.id) { toast.error("لا يمكن التحويل إلى نفس الخزينة"); return; }
    if (fromBox.currency !== toBox.currency) { toast.error("التحويل المباشر يجب أن يكون بين خزائن بنفس العملة"); return; }
    if (!validAmount) { toast.error("أدخل مبلغ تحويل صحيح أكبر من صفر"); return; }

    const outflowError = await checkOutflowAllowed(fromBox.id, amountNum, fromBox.name);
    if (outflowError) { toast.error(outflowError); return; }

    const fingerprint = financialOperationFingerprint({ from: fromBox.id, to: toBox.id, currency: fromBox.currency, amount: amountNum });
    const operationId = getOrCreateFinancialOperationId("cash-box-transfer", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });
    try {
      const method = `تحويل بين الخزائن: ${fromBox.name} ← ${toBox.name}`;
      const result = await postCashBoxTransfer({
        fromCashBoxId: fromBox.id,
        toCashBoxId: toBox.id,
        amount: amountNum,
        currency: fromBox.currency as "EGP" | "USD" | "LYD",
        date: new Date().toISOString().slice(0, 10),
        method,
        operationId,
      });
      if (!result.ok) throw new Error(result.error || "فشل التحويل بين الخزائن");
      try { await refetchLiveTables(["cash_boxes", "payment_splits"]); } catch { /* realtime will reconcile */ }
      confirmFinancialOperation(operationId);
      toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
      onClose();
    } catch (e: any) {
      toast.error(isLikelyNetworkError(e) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (e?.message || "فشل التحويل بين الخزائن"), { id: toastId });
    } finally {
      setSaving(false);
    }
  };
'''
    text = replace_between_after(
        text,
        "function CashBoxTransferModal",
        "  const save = async () => {\n",
        "  };\n\n  if (typeof document === \"undefined\") return null;",
        transfer_new + "\n  if (typeof document === \"undefined\") return null;",
        "cash box transfer save",
    )

    reconcile_new = '''  const save = async () => {
    if (!settlementPerm.view) { toast.error("ليس لديك صلاحية تسوية الخزائن"); return; }
    if (!hasPhysical) { toast.error("أدخل الرصيد الفعلي بعد الجرد"); return; }
    if (!reason.trim()) { toast.error("سبب التسوية إجباري"); return; }
    if (diff === 0) { toast.error("لا يوجد فرق لتسويته"); return; }

    const fingerprint = financialOperationFingerprint({ boxId: box.id, physical: physicalNum, currency: box.currency });
    const operationId = getOrCreateFinancialOperationId("cash-box-reconciliation", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });
    try {
      const amount = Math.abs(diff);
      const direction: "in" | "out" = diff > 0 ? "in" : "out";
      const method = diff > 0 ? "تسوية زيادة خزنة" : "تسوية عجز خزنة";
      const statement = `${method} — الرصيد قبل: ${currentBalance} ${box.currency} | الرصيد بعد: ${physicalNum} ${box.currency} | الفرق: ${diff} ${box.currency} | السبب: ${reason.trim()}${note.trim() ? ` | ملاحظات: ${note.trim()}` : ""}`;
      const res = await postMovement({
        partyType: "treasury",
        partyId: null,
        kind: "settlement",
        date: new Date().toISOString().slice(0, 10),
        note: note.trim() || undefined,
        statement,
        operationId,
        splits: [{
          method,
          currency: box.currency as "EGP" | "USD" | "LYD",
          cashBoxId: box.id,
          amount,
          direction,
        }],
      });
      if (!res.ok) throw new Error(res.error || "فشل حفظ التسوية");
      confirmFinancialOperation(operationId);
      toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
      onClose();
    } catch (e: any) {
      toast.error(isLikelyNetworkError(e) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (e?.message || "فشل حفظ التسوية"), { id: toastId });
    } finally { setSaving(false); }
  };
'''
    text = replace_between_after(
        text,
        "function CashBoxReconcileModal",
        "  const save = async () => {\n",
        "  };\n\n  if (typeof document === \"undefined\") return null;",
        reconcile_new + "\n  if (typeof document === \"undefined\") return null;",
        "cash box reconcile save",
    )
    path.write_text(text, encoding="utf-8")


def main() -> None:
    patch_cash_movement_forms()
    patch_companies()
    patch_merchants()
    patch_investors()
    patch_reports()
    print("financial idempotency phase 2a patch applied")


if __name__ == "__main__":
    main()
