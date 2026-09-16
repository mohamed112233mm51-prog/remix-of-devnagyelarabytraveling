from pathlib import Path

path = Path("src/lib/financialSummary.ts")
text = path.read_text(encoding="utf-8")
old = '''  const incomingTxns = txns.filter((t) => {
    if (!t.merchant_id) return false;
    const { net } = merchantIncomingAmounts(t, merchantInstapayByTxnId);
    return net > 0;
  });'''
new = '''  const incomingTxns = txns.filter((t) => {
    if (!t.merchant_id) return false;
    // Merchant counterpart rows are outflows created to mirror a payment to a
    // company/agent. Their payment_splits can look like merchant-funded incoming
    // money (especially InstaPay), so they must never enter the "وارد من وكيل"
    // bucket. They are rendered exactly once through cashMoveTxns below.
    if (
      t.source_service_type === "merchant_cash_out" ||
      t.source_service_type === "merchant_cash_out_to_company" ||
      t.source_service_type === "merchant_cash_out_to_agent"
    ) return false;
    const { net } = merchantIncomingAmounts(t, merchantInstapayByTxnId);
    return net > 0;
  });'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"Expected exactly one incomingTxns block, found {count}")
path.write_text(text.replace(old, new), encoding="utf-8")
