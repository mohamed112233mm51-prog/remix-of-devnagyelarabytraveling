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


def code_only(text: str) -> str:
    """Mask comments while preserving offsets/newlines for useful line numbers."""
    def mask(match: re.Match[str]) -> str:
        value = match.group(0)
        return "".join("\n" if ch == "\n" else " " for ch in value)

    # Good enough for an audit guard: comments are the source of false positives
    # such as documentation containing `from("payment_splits").insert(...)`.
    text = re.sub(r"/\*.*?\*/", mask, text, flags=re.S)
    text = re.sub(r"//[^\n]*", mask, text)
    return text


def iter_sources():
    for path in SRC.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        raw = path.read_text(encoding="utf-8")
        yield path, raw, code_only(raw)


for path, raw_text, text in iter_sources():
    rel = path.relative_to(ROOT)

    # Every postMovement write must carry a stable operationId. postMovement is
    # fail-closed too, but CI catches a forgotten caller before runtime.
    for match in re.finditer(r"\bpostMovement\s*\(\s*\{", text):
        start = match.start()
        tail = text[match.end(): match.end() + 7000]
        close = tail.find("});")
        block = tail if close < 0 else tail[: close + 3]
        if "operationId" not in block:
            HARD_ERRORS.append(f"{rel}:{line_no(raw_text, start)} postMovement without operationId")

    # Direct writes have the mutation method immediately after from(...). Do not
    # span arbitrary code: that previously misread a SELECT followed much later
    # by an unrelated INSERT as a payment_splits write.
    if rel.as_posix() != "src/lib/financialAtomic.ts":
        pattern = r"from\(\s*[\"']payment_splits[\"']\s*\)\s*\.\s*insert\s*\("
        for match in re.finditer(pattern, text):
            HARD_ERRORS.append(f"{rel}:{line_no(raw_text, match.start())} direct payment_splits INSERT")

    if rel.as_posix() != "src/lib/financialIdempotency.ts":
        for token in ("ensureFinancialParentRow(", "ensureFinancialChildRows("):
            for match in re.finditer(re.escape(token), text):
                HARD_ERRORS.append(f"{rel}:{line_no(raw_text, match.start())} legacy multi-request helper {token[:-1]}")

    if rel.as_posix() != "src/lib/merchantCounterparty.ts":
        for token in (
            "postMerchantCashOutToCompanyCounterparts(",
            "postMerchantCashOutToAgentCounterparts(",
        ):
            for match in re.finditer(re.escape(token), text):
                HARD_ERRORS.append(f"{rel}:{line_no(raw_text, match.start())} separate merchant counterpart write")

    # Inventory actual direct parent mutations. These are reviewed separately
    # because some are metadata, demo, opening-balance, or other non-compound
    # operations rather than a live multi-sided money movement.
    for table in FINANCIAL_PARENT_TABLES:
        pattern = rf"from\(\s*[\"']{re.escape(table)}[\"']\s*\)\s*\.\s*(insert|update|delete)\s*\("
        for match in re.finditer(pattern, text):
            op = match.group(1)
            WARNINGS.append(f"{rel}:{line_no(raw_text, match.start())} direct {table} {op}")

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
