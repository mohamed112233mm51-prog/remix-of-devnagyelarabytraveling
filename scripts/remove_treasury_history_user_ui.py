from pathlib import Path
import re

path = Path('src/routes/reports.tsx')
text = path.read_text(encoding='utf-8')
original = text

# Remove user fields from the treasury history row shape.
text = text.replace(
'''  details: string;\n  performedById: string | null;\n  performedByLabel: string;\n};''',
'''  details: string;\n};''',
1,
)

# Remove actor state and the audit/profile lookup effect. This data is no longer displayed or filtered.
text = text.replace(
'''  const [treasuryActorBySplit, setTreasuryActorBySplit] = useState<Record<string, string | null>>({});\n  const [treasuryUserNameById, setTreasuryUserNameById] = useState<Record<string, string>>({});\n  const [treasuryActorsLoading, setTreasuryActorsLoading] = useState(false);\n''',
'',
1,
)

pattern = re.compile(
    r'''\n  useEffect\(\(\) => \{\n    let cancelled = false;\n    const relevantSplitIds = treasurySplits.*?\n  \}, \[treasurySplits\]\);\n''',
    re.S,
)
text, count = pattern.subn('\n', text, count=1)
assert count == 1, f'expected one treasury actor effect, got {count}'

# Remove actor resolution helper from treasury operation projection.
pattern = re.compile(
    r'''\n    const actorFor = \(splitIds: string\[\]\) => \{.*?\n    \};\n''',
    re.S,
)
text, count = pattern.subn('', text, count=1)
assert count == 1, f'expected one actorFor helper, got {count}'

text = text.replace('      const actor = actorFor(group.map((split) => split.id));\n', '', 1)
text = text.replace('        ...actor,\n', '', 1)
text = text.replace('      const actor = actorFor([split.id]);\n', '', 1)
text = text.replace('        ...actor,\n', '', 1)
text = text.replace(
'  }, [treasurySplits, boxNameById, inRange, treasuryActorBySplit, treasuryUserNameById]);',
'  }, [treasurySplits, boxNameById, inRange]);',
1,
)

# Remove user filter state/options and user-specific filtering/search terms.
text = text.replace('  const [historyUser, setHistoryUser] = useState("");\n', '', 1)
pattern = re.compile(
    r'''  const historyUserOptions = useMemo\(\(\) => \{.*?\n  const hasUnknownHistoryUser = useMemo\(\(\) => treasuryOperations\.some\(\(op\) => !op\.performedById\), \[treasuryOperations\]\);\n''',
    re.S,
)
text, count = pattern.subn('', text, count=1)
assert count == 1, f'expected one history user options block, got {count}'

text = text.replace('      if (historyUser === "__unknown__" && op.performedById) return false;\n', '', 1)
text = text.replace('      if (historyUser && historyUser !== "__unknown__" && op.performedById !== historyUser) return false;\n', '', 1)
text = text.replace(
'        const haystack = [op.type, op.from, op.to, op.details, op.performedByLabel, op.currency, String(op.amount)].join(" ").toLowerCase();',
'        const haystack = [op.type, op.from, op.to, op.details, op.currency, String(op.amount)].join(" ").toLowerCase();',
1,
)
text = text.replace(
'  }, [treasuryOperations, historyType, historyBox, historyUser, historySearch]);',
'  }, [treasuryOperations, historyType, historyBox, historySearch]);',
1,
)
text = text.replace('    setHistoryUser("");\n', '', 1)

# Remove the user select from the filter bar.
pattern = re.compile(
    r'''              <select className="filter-select" value=\{historyUser\} onChange=\{\(e\) => setHistoryUser\(e\.target\.value\)\} aria-label="فلتر المستخدم">.*?              </select>\n''',
    re.S,
)
text, count = pattern.subn('', text, count=1)
assert count == 1, f'expected one user filter select, got {count}'

text = text.replace(
'disabled={!historyType && !historyBox && !historyUser && !historySearch}',
'disabled={!historyType && !historyBox && !historySearch}',
1,
)

# Remove the user table column and actor loading dependency; update colspans from 8 to 7.
text = text.replace('                    <th>المستخدم</th>\n', '', 1)
text = text.replace(
'                  {treasurySplitsLoading || treasuryActorsLoading ? (',
'                  {treasurySplitsLoading ? (',
1,
)
text = text.replace('<EmptyOrLoading loading={true} label="" colSpan={8} />', '<EmptyOrLoading loading={true} label="" colSpan={7} />', 1)
text = text.replace('<EmptyOrLoading loading={false} label="لا توجد تسويات أو تحويلات خزائن مطابقة للفلاتر" colSpan={8} />', '<EmptyOrLoading loading={false} label="لا توجد تسويات أو تحويلات خزائن مطابقة للفلاتر" colSpan={7} />', 1)
text = text.replace('                      <td data-label="المستخدم" className="bold">{op.performedByLabel}</td>\n', '', 1)

# Guardrails: no treasury-history user UI/query symbols should remain.
for forbidden in [
    'treasuryActorBySplit', 'treasuryUserNameById', 'treasuryActorsLoading',
    'historyUser', 'historyUserOptions', 'hasUnknownHistoryUser',
    'performedById', 'performedByLabel', 'فلتر المستخدم', '<th>المستخدم</th>',
    '[Treasury history] could not resolve operation users',
]:
    assert forbidden not in text, f'forbidden treasury user symbol remains: {forbidden}'

assert 'كل أنواع الحركات' in text
assert 'كل الخزائن' in text
assert 'بحث في السجل...' in text
assert text != original, 'no changes were made'

path.write_text(text, encoding='utf-8')
