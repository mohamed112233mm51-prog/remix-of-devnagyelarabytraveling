from pathlib import Path
import re

RISKY_TABLES = (
    'transactions',
    'company_transactions',
    'merchant_cash_collections',
    'payment_splits',
    'investor_transactions',
    'currency_supplier_transactions',
    'expense_deductions',
    'expenses',
    'usd_treasury_transactions',
    'executions',
    'submissions',
)

IMPORT_LINE = 'import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";\n'
changed_files = []

for path in Path('src').rglob('*'):
    if path.suffix not in {'.ts', '.tsx'}:
        continue

    text = path.read_text(encoding='utf-8')
    original = text

    for table in RISKY_TABLES:
        # Generic calls, kept to one source line to avoid crossing unrelated syntax.
        text = re.sub(
            rf'useLive<([^\n]*?)>\("{re.escape(table)}"\)',
            rf'useCompleteFinancialTable<\1>("{table}")',
            text,
        )
        # Non-generic calls.
        text = text.replace(
            f'useLive("{table}")',
            f'useCompleteFinancialTable("{table}")',
        )

    if text == original:
        continue

    if 'useCompleteFinancialTable' in text and '@/hooks/useCompleteFinancialTables' not in text:
        if text.startswith('"use client";\n') or text.startswith("'use client';\n"):
            first_nl = text.find('\n') + 1
            text = text[:first_nl] + IMPORT_LINE + text[first_nl:]
        else:
            text = IMPORT_LINE + text

    path.write_text(text, encoding='utf-8')
    changed_files.append(str(path))

if not changed_files:
    raise SystemExit('No direct useLive calls on risky tables were found to migrate')

print('Migrated direct useLive calls on large tables in:')
for file in changed_files:
    print(f' - {file}')
