from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "src/lib/executionPosting.ts"
text = path.read_text(encoding="utf-8")

patterns = [
    (
        '        companyRows.push({\n        id: deriveFinancialOperationUuid(operationId, `company:${i}`),\n          id: deriveFinancialOperationUuid(operationId, `company:${i}`),\n',
        '        companyRows.push({\n          id: deriveFinancialOperationUuid(operationId, `company:${i}`),\n',
    ),
    (
        '        agentRows.push({\n        id: deriveFinancialOperationUuid(operationId, `agent:${i}`),\n          id: deriveFinancialOperationUuid(operationId, `agent:${i}`),\n',
        '        agentRows.push({\n          id: deriveFinancialOperationUuid(operationId, `agent:${i}`),\n',
    ),
]

changed = 0
for old, new in patterns:
    count = text.count(old)
    if count > 1:
        raise RuntimeError(f"unexpected duplicate pattern count: {count}")
    if count == 1:
        text = text.replace(old, new, 1)
        changed += 1

if changed != 2:
    raise RuntimeError(f"expected to clean 2 duplicate id blocks, cleaned {changed}")

path.write_text(text, encoding="utf-8")
print("cleaned duplicate deterministic execution IDs")
