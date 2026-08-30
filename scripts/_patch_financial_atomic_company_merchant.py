from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# Company payment: company parent + treasury splits + merchant counterparts
# in one execute_financial_atomic call through postMovement.
# ---------------------------------------------------------------------------
path = ROOT / "src/features/companies/LegacyCompaniesRoute.tsx"
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { confirmFinancialOperation, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    'import { confirmFinancialOperation, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    "company remove legacy parent helper",
)
text = replace_once(
    text,
    'import { postMerchantCashOutToCompanyCounterparts } from "@/lib/merchantCounterparty";\n',
    'import { buildMerchantCashOutToCompanyCounterpartRows } from "@/lib/merchantCounterparty";\n',
    "company counterpart builder import",
)
start = text.find('    const txnRow = await ensureFinancialParentRow("company_transactions", operationId, payload);')
end = text.find('\n    confirmFinancialOperation(operationId);', start)
if start < 0 or end < 0:
    raise RuntimeError("company payment multi-request block not found")
replacement = '''    const counterpartRows = buildMerchantCashOutToCompanyCounterpartRows({
      splits: validSplits,
      companyTransactionId: operationId,
      date: form.date,
      statement: form.statement.trim() || "صادر لشركة",
      note: form.note.trim() || undefined,
    });

    const engineRes = await postMovement({
      partyType: "company",
      partyId: form.company_id,
      kind: "payment",
      date: form.date,
      note: form.note.trim() ? form.note.trim() : undefined,
      statement: form.statement.trim() ? form.statement.trim() : undefined,
      splits: engineSplits,
      operationId,
      atomicFingerprint: fingerprint,
      atomicParent: {
        table: "company_transactions",
        id: operationId,
        payload,
      },
      atomicExtraRows: counterpartRows,
    });
    if (!engineRes.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(engineRes.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (engineRes.error || "تعذر حفظ الحركة المالية"), { id: toastId });
      return;
    }

    try { await logCreate("company_transactions", operationId, { ...payload, id: operationId }, "حركة شركة"); } catch { /* non-blocking audit */ }
'''
text = text[:start] + replacement + text[end:]
path.write_text(text, encoding="utf-8")

# ---------------------------------------------------------------------------
# Merchant collection batch: ALL collection parents + ALL incoming cash-box
# payment_splits commit in one DB transaction for one Save click.
# ---------------------------------------------------------------------------
path = ROOT / "src/features/merchants/LegacyMerchantsRoute.tsx"
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { confirmFinancialOperation, deriveFinancialOperationUuid, ensureFinancialChildRows, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    'import { confirmFinancialOperation, deriveFinancialOperationUuid, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\nimport { atomicRow, buildAtomicPaymentSplitRows, executeFinancialAtomic } from "@/lib/financialAtomic";\n',
    "merchant atomic imports",
)
start = text.find('    const insertRows = enriched.map(({ r }) => ({')
end = text.find('\n    confirmFinancialOperation(operationId);', start)
if start < 0 or end < 0:
    raise RuntimeError("merchant collection multi-request block not found")
replacement = '''    const insertRows = enriched.map(({ r }) => ({
      merchant_id: r.merchant_id,
      date,
      amount: Number(r.amount || 0),
      note: note.trim() ? note.trim() : null,
      statement: statement.trim() ? statement.trim() : null,
    }));
    const collectionIds = insertRows.map((_, index) =>
      deriveFinancialOperationUuid(operationId, `collection:${index}`),
    );
    const atomicRows = insertRows.map((row, index) =>
      atomicRow("merchant_cash_collections", { ...row, id: collectionIds[index] }),
    );

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
      atomicRows.push(...buildAtomicPaymentSplitRows({
        operationId: rowOperationId,
        splits: engineSplits,
        sourceTable: "merchant_cash_collections",
        sourceId: collectionIds[i],
        childPrefix: "split",
      }));
    }

    const saved = await executeFinancialAtomic({
      operationId,
      fingerprint,
      rows: atomicRows,
      result: { collectionIds },
    });
    if (!saved.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(saved.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (saved.error || "تعذر تسجيل التحصيل المالي"), { id: toastId });
      return;
    }
'''
text = text[:start] + replacement + text[end:]
path.write_text(text, encoding="utf-8")

# ---------------------------------------------------------------------------
# Currency-supplier obsolete manual reversal path. Deletion/cancellation is now
# handled by the atomic cancel RPC, so retaining this helper would provide an
# unsafe alternate path for future callers.
# ---------------------------------------------------------------------------
path = ROOT / "src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx"
text = path.read_text(encoding="utf-8")
start = text.find('// Reverse a previously-applied transaction (used on delete).')
end = text.find('\nfunction TxModal(', start)
if start < 0 or end < 0:
    raise RuntimeError("obsolete supplier reverseTransaction block not found")
text = text[:start] + '// Financial cancel/restore is handled by set_financial_cancel_state_atomic.\n' + text[end:]
path.write_text(text, encoding="utf-8")

print("company payment and merchant collections converted to single atomic saves")
