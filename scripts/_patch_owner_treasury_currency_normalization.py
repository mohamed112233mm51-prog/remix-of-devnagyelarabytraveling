from pathlib import Path

p = Path('src/routes/investors.tsx')
text = p.read_text(encoding='utf-8')

old_import = 'import { fmtCurrency, refetchLiveTables, useLive, type Investor, type InvestorTransaction } from "@/lib/db";'
new_import = 'import { fmtCurrency, normalizeCurrency, refetchLiveTables, useLive, type Investor, type InvestorTransaction } from "@/lib/db";'
if text.count(old_import) != 1:
    raise SystemExit(f'import anchor count={text.count(old_import)}')
text = text.replace(old_import, new_import, 1)

old_filter = '["EGP", "USD", "LYD"].includes(String(box.currency || "").toUpperCase()),'
new_filter = '["EGP", "USD", "LYD"].includes(normalizeCurrency(box.currency)),'
if text.count(old_filter) != 1:
    raise SystemExit(f'filter anchor count={text.count(old_filter)}')
text = text.replace(old_filter, new_filter, 1)

old_currency = '          currency: String(selectedBox.currency).toUpperCase() as "EGP" | "USD" | "LYD",'
new_currency = '          currency: normalizeCurrency(selectedBox.currency) as "EGP" | "USD" | "LYD",'
if text.count(old_currency) != 1:
    raise SystemExit(f'currency anchor count={text.count(old_currency)}')
text = text.replace(old_currency, new_currency, 1)

p.write_text(text, encoding='utf-8')
