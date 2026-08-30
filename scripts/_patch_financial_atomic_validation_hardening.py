from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} match(es), found {count} for {old!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")
    print(f"patched {path}: {count} replacement(s)")


# Financial engine model: explicitly tell the DB which splits MUST be attached
# to a real cash box. Merchant-wallet/merchant-ledger splits may remain null.
replace_exact(
    "src/lib/financialEngine.ts",
    '  cashBoxId: string | null;       // null للمحافظ (تاجر) — لا يوجد صف في cash_boxes\n  amount: number;',
    '  cashBoxId: string | null;       // null للمحافظ (تاجر) — لا يوجد صف في cash_boxes\n  requiresCashBox?: boolean;           // true = DB must reject the whole operation if cashBoxId is null\n  amount: number;',
)
replace_exact(
    "src/lib/financialEngine.ts",
    '        cashBoxId: args.fromCashBoxId,\n        amount: args.amount,',
    '        cashBoxId: args.fromCashBoxId,\n        requiresCashBox: true,\n        amount: args.amount,',
)
replace_exact(
    "src/lib/financialEngine.ts",
    '        cashBoxId: args.toCashBoxId,\n        amount: args.amount,',
    '        cashBoxId: args.toCashBoxId,\n        requiresCashBox: true,\n        amount: args.amount,',
)

# Agent payment: company-funded rows must always land in a company cash box.
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '        cashBoxId,\n        amount: b.net,',
    '        cashBoxId,\n        requiresCashBox: r.source === "company",\n        amount: b.net,',
)

# Shared cash movement forms (agent cash-out / merchant cash-out / company supply).
replace_exact(
    "src/components/CashMovementForms.tsx",
    '      cashBoxId,\n      amount: a,',
    '      cashBoxId,\n      requiresCashBox: r.source === "company",\n      amount: a,',
)

# Expenses: only company-funded splits become payment_splits here, therefore a
# real company cash box is mandatory.
replace_exact(
    "src/features/expenses/LegacyExpensesRoute.tsx",
    '          cashBoxId: box?.id || null,\n          amount: a,',
    '          cashBoxId: box?.id || null,\n          requiresCashBox: true,\n          amount: a,',
)

# Currency supplier: foreign treasury leg always requires its currency box;
# EGP company legs require a company box while merchant legs intentionally do not.
replace_exact(
    "src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx",
    '      cashBoxId: foreignBox.id,\n      amount: foreignAmount,',
    '      cashBoxId: foreignBox.id,\n      requiresCashBox: true,\n      amount: foreignAmount,',
)
replace_exact(
    "src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx",
    '      cashBoxId,\n      amount: amt,',
    '      cashBoxId,\n      requiresCashBox: s.source === "company",\n      amount: amt,',
)

# Investor movements always target an explicitly selected treasury box.
replace_exact(
    "src/routes/investors.tsx",
    '        cashBoxId: selectedBox.id,\n        amount,',
    '        cashBoxId: selectedBox.id,\n        requiresCashBox: true,\n        amount,',
)

# Financial Excel import currently supports company cash / company InstaPay cash
# boxes for payment splits; those must never degrade to cash_box_id = null.
replace_exact(
    "src/lib/dataImport/specialImport.ts",
    '    splits.push({ method, currency, cashBoxId, amount, direction });',
    '    splits.push({ method, currency, cashBoxId, requiresCashBox: true, amount, direction });',
)

print("financial atomic validation hardening patch complete")
