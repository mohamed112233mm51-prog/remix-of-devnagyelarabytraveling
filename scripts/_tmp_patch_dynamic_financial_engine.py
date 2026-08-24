from pathlib import Path

path = Path('src/lib/financialEngine.ts')
text = path.read_text(encoding='utf-8')

old = '''  const { rows: splits } = useLive<RawSplit & { source_table: string | null; source_id: string | null }>(
    "payment_splits",
  );'''
new = '''  const { rows: splits } = useCompleteFinancialTable<RawSplit & { source_table: string | null; source_id: string | null }>(
    "payment_splits",
  );'''
if old not in text:
    raise SystemExit('multiline payment_splits useLive pattern not found')
text = text.replace(old, new, 1)

old_dynamic = '  const { rows: parents } = useLive<any>(parentTable as any);'
count = text.count(old_dynamic)
if count != 2:
    raise SystemExit(f'expected 2 dynamic parent useLive calls, found {count}')
text = text.replace(old_dynamic, '  const { rows: parents } = useCompleteFinancialTable<any>(parentTable as any);')

path.write_text(text, encoding='utf-8')
print('financialEngine dynamic large-table reads migrated to complete loader')
