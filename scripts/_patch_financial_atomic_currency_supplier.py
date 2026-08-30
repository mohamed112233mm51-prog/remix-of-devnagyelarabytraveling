from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx"
text = PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    text = text.replace(old, new, 1)

replace_once(
    'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\n',
    'import type { MovementSplit } from "@/lib/financialEngine";\n',
    "supplier engine import",
)
replace_once(
    'import { confirmFinancialOperation, ensureFinancialChildRows, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    'import { confirmFinancialOperation, deriveFinancialOperationUuid, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\nimport { atomicRow, buildAtomicPaymentSplitRows, executeFinancialAtomic } from "@/lib/financialAtomic";\n',
    "supplier atomic imports",
)

# Replace applyTransaction with an atomic builder+save. Parent, merchant balance
# effects and treasury splits are one SQL transaction.
start = text.find('async function applyTransaction(opts: {')
end = text.find('\n// Reverse a previously-applied transaction', start)
if start < 0 or end < 0:
    raise RuntimeError("applyTransaction block not found")
new_apply = '''async function applyTransaction(opts: {
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
  fingerprint: string;
  parentPayload: Record<string, unknown>;
}): Promise<{ ok: boolean; reused?: boolean; error?: string }> {
  const { kind, txId, txDate, foreignCurrency, foreignAmount, splits, boxes, description, operationId, fingerprint, parentPayload } = opts;
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

  const merchantIds = merchantRows.map((_, index) =>
    deriveFinancialOperationUuid(operationId, `supplier-merchant:${index}`),
  );
  const rows = [
    atomicRow("currency_supplier_transactions", { ...parentPayload, id: txId }),
    ...buildAtomicPaymentSplitRows({
      operationId,
      splits: engineSplits,
      sourceTable: "currency_supplier_transactions",
      sourceId: txId,
    }),
    ...merchantRows.map((row, index) => atomicRow("merchant_cash_collections", { ...row, id: merchantIds[index] })),
  ];

  const saved = await executeFinancialAtomic({
    operationId,
    fingerprint,
    rows,
    result: { transactionId: txId, merchantIds },
  });
  return saved.ok
    ? { ok: true, reused: saved.reused }
    : { ok: false, error: saved.error || "تعذر تسجيل الحركة المالية" };
}
'''
text = text[:start] + new_apply + text[end:]

# Trade: remove standalone parent insert, execute the parent + all effects atomically.
old_trade_parent = '''    const parent = await ensureFinancialParentRow("currency_supplier_transactions", operationId, payload);
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
'''
new_trade_parent = '''    const txId = operationId;
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
      fingerprint,
      parentPayload: payload,
    });
'''
replace_once(old_trade_parent, new_trade_parent, "supplier trade atomic save")
# Audit only after successful financial commit, and do not duplicate on replay.
trade_success_marker = '''    if (!applied.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(applied.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (applied.error || "تعذر تسجيل الحركة المالية"), { id: toastId });
      return;
    }

    // WRITE-SIDE FX LOCK propagation'''
trade_success_repl = '''    if (!applied.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(applied.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (applied.error || "تعذر تسجيل الحركة المالية"), { id: toastId });
      return;
    }
    if (!applied.reused) {
      try { await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind); } catch { /* non-blocking audit */ }
    }

    // WRITE-SIDE FX LOCK propagation'''
replace_once(trade_success_marker, trade_success_repl, "supplier trade audit after commit")

# Cash movement: parent + merchant rows + payment splits in one RPC.
cash_parent_start = text.find('    const parent = await ensureFinancialParentRow("currency_supplier_transactions", operationId, payload);', text.find('function CashMovementModal'))
cash_commit_end = text.find('\n    confirmFinancialOperation(operationId);', cash_parent_start)
if cash_parent_start < 0 or cash_commit_end < 0:
    raise RuntimeError("supplier cash legacy multi-write block not found")
# Rebuild the whole persistence section; validation/payload/fingerprint above stay unchanged.
new_cash = '''    const txId = operationId;
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

    const merchantIds = merchantRows.map((_, index) =>
      deriveFinancialOperationUuid(operationId, `supplier-cash-merchant:${index}`),
    );
    const saved = await executeFinancialAtomic({
      operationId,
      fingerprint,
      rows: [
        atomicRow("currency_supplier_transactions", { ...payload, id: txId }),
        ...buildAtomicPaymentSplitRows({
          operationId,
          splits: engineSplits,
          sourceTable: "currency_supplier_transactions",
          sourceId: txId,
        }),
        ...merchantRows.map((row, index) => atomicRow("merchant_cash_collections", { ...row, id: merchantIds[index] })),
      ],
      result: { transactionId: txId, merchantIds },
    });
    if (!saved.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(saved.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (saved.error || "تعذر تسجيل الحركة المالية"), { id: toastId });
      return;
    }
    if (!saved.reused) {
      try { await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind); } catch { /* non-blocking audit */ }
    }
'''
text = text[:cash_parent_start] + new_cash + text[cash_commit_end:]

PATH.write_text(text, encoding="utf-8")
print("currency supplier financial saves converted to atomic RPC")
