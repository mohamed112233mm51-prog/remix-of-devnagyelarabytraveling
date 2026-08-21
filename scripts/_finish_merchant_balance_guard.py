from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match in {path}, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def remove_once(path: str, snippet: str, label: str) -> None:
    replace_once(path, snippet, "", label)

# Fix malformed imports left by the interrupted Lovable edit.
replace_once(
    "src/components/CashMovementForms.tsx",
    'import {\nimport { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";\n  PaymentSplits,',
    'import { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";\nimport {\n  PaymentSplits,',
    "fix CashMovementForms merchant guard import",
)
replace_once(
    "src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx",
    'import {\nimport { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";\n  summarizeCurrencySupplierStatement,',
    'import { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";\nimport {\n  summarizeCurrencySupplierStatement,',
    "fix currency supplier merchant guard import",
)

# Agent collection is an incoming movement to the merchant balance. It must not
# be blocked by an outflow guard. The interrupted edit added the check here by
# mistake; remove it and keep the guard only on actual merchant-funded outflows.
remove_once(
    "src/components/AgentPaymentForm.tsx",
    'import { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";\n',
    "remove incoming merchant guard import",
)
remove_once(
    "src/components/AgentPaymentForm.tsx",
    '    const merchantDbErr = await assertMerchantOutflowsAllowed(validSplits);\n    if (merchantDbErr) return toast.error(merchantDbErr);\n\n',
    "remove incoming merchant guard call",
)

# Use the typed RPC now that the generated Supabase types contain the function.
p = Path("src/lib/merchantBalanceGuard.ts")
text = p.read_text(encoding="utf-8")
text = text.replace(
    '  const { data, error } = await supabase.rpc("assert_merchant_balance" as never, {\n'
    '    p_merchant_id: merchantId,\n'
    '    p_currency: normalizeCurrency(String(currency || "EGP")),\n'
    '    p_amount: Number(amount),\n'
    '  } as never);',
    '  const { data, error } = await supabase.rpc("assert_merchant_balance", {\n'
    '    p_merchant_id: merchantId,\n'
    '    p_currency: normalizeCurrency(String(currency || "EGP")),\n'
    '    p_amount: Number(amount),\n'
    '  });',
)
p.write_text(text, encoding="utf-8")

print("Merchant balance guard completion patch applied")
# trigger-v2
