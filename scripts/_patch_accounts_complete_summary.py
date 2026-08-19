from pathlib import Path

path = Path("src/features/accounts/LegacyAccountsRoute.tsx")
s = path.read_text(encoding="utf-8")

old = 'import { CurrencyMap, formatCurrencyMap, useAgentsSummary } from "@/lib/financialSummary";\nimport { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";'
new = 'import { CurrencyMap, formatCurrencyMap } from "@/lib/financialSummary";\nimport { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";\nimport { useCompleteAgentsSummary } from "@/hooks/useCompleteAgentsSummary";'
if old not in s:
    raise SystemExit("accounts imports pattern not found")
s = s.replace(old, new, 1)

old2 = '  const agentSummaries = useAgentsSummary();'
new2 = '  const agentSummaries = useCompleteAgentsSummary();'
if old2 not in s:
    raise SystemExit("accounts summary hook pattern not found")
s = s.replace(old2, new2, 1)

path.write_text(s, encoding="utf-8")
print("patched", path)
