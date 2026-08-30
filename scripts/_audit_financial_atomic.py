from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

HARD_ERRORS: list[str] = []
WARNINGS: list[str] = []

FINANCIAL_PARENT_TABLES = (
    "transactions",
    "company_transactions",
    "currency_supplier_transactions",
    "investor_transactions",
    "expenses",
    "expense_deductions",
    "merchant_cash_collections",
    "cash_transfers",
    "usd_treasury_transactions",
)


def line_no(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def iter_sources():
    for path in SRC.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        yield path, path.read_text(encoding="utf-8")


for path, text in iter_sources():
    rel = path.relative_to(ROOT)

    # Every postMovement write must carry a stable operationId. postMovement is
    # fail-closed too, but CI catches a forgotten caller before runtime.
    for match in re.finditer(r"\bpostMovement\s*\(\s*\{", text):
        start = match.start()
        # Calls in this codebase are small object literals; inspect a generous
        # window through the nearest closing call. This is an audit guard, not a
        # TypeScript parser.
        tail = text[match.end(): match.end() + 7000]
        close = tail.find("});")
        block = tail if close < 0 else tail[: close + 3]
        if "operationId" not in block:
            HARD_ERRORS.append(f"{rel}:{line_no(text, start)} postMovement without operationId")

    # There must be exactly one application-layer way to create payment_splits:
    # build them as rows and send them to an atomic DB RPC. Direct client INSERT
    # can split the treasury side from its parent.
    if rel.as_posix() not in {
        "src/lib/financialAtomic.ts",
    }:
        for match in re.finditer(r"from\(\s*[\"']payment_splits[\"']\s*\).*?\.insert\s*\(", text, re.S):
            HARD_ERRORS.append(f"{rel}:{line_no(text, match.start())} direct payment_splits INSERT")

    if rel.as_posix() != "src/lib/financialIdempotency.ts":
        for token in ("ensureFinancialParentRow(", "ensureFinancialChildRows("):
            for match in re.finditer(re.escape(token), text):
                HARD_ERRORS.append(f"{rel}:{line_no(text, match.start())} legacy multi-request helper {token[:-1]}")

    if rel.as_posix() != "src/lib/merchantCounterparty.ts":
        for token in (
            "postMerchantCashOutToCompanyCounterparts(",
            "postMerchantCashOutToAgentCounterparts(",
        ):
            for match in re.finditer(re.escape(token), text):
                HARD_ERRORS.append(f"{rel}:{line_no(text, match.start())} separate merchant counterpart write")

    # Inventory remaining direct parent writes so they can be reviewed. Some are
    # legitimate metadata/admin paths, therefore these are warnings rather than
    # automatic failures.
    for table in FINANCIAL_PARENT_TABLES:
        pattern = rf"from\(\s*[\"']{re.escape(table)}[\"']\s*(?:as any)?\s*\).*?\.(insert|update|delete)\s*\("
        for match in re.finditer(pattern, text, re.S):
            op = match.group(1)
            WARNINGS.append(f"{rel}:{line_no(text, match.start())} direct {table} {op}")

print("=== Financial atomicity hard guards ===")
if HARD_ERRORS:
    for item in HARD_ERRORS:
        print("ERROR", item)
else:
    print("OK: no hard-guard violations")

print("=== Direct financial-parent write inventory ===")
if WARNINGS:
    for item in sorted(set(WARNINGS)):
        print("REVIEW", item)
else:
    print("OK: no direct parent writes found")

if HARD_ERRORS:
    raise SystemExit(1)
