from pathlib import Path

path = Path('src/lib/financialEngine.ts')
text = path.read_text(encoding='utf-8')
original = text

old = '''  const { rows: splits } = useLive<RawSplit & { source_table: string | null; source_id: string | null }>(
    "payment_splits",
  );'''
new = '''  const { rows: splits } = useCompleteFinancialTable<RawSplit & { source_table: string | null; source_id: string | null }>(
    "payment_splits",
  );'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('neither old nor migrated payment_splits pattern found')

old_dynamic = '  const { rows: parents } = useLive<any>(parentTable as any);'
new_dynamic = '  const { rows: parents } = useCompleteFinancialTable<any>(parentTable as any);'
count_old = text.count(old_dynamic)
count_new = text.count(new_dynamic)
if count_old:
    if count_old != 2:
        raise SystemExit(f'expected 2 dynamic parent useLive calls, found {count_old}')
    text = text.replace(old_dynamic, new_dynamic)
elif count_new != 2:
    raise SystemExit(f'expected 2 migrated dynamic parent calls, found {count_new}')

if text != original:
    path.write_text(text, encoding='utf-8')
    print('financialEngine dynamic large-table reads migrated to complete loader')
else:
    print('financialEngine dynamic reads already migrated; no patch needed')
