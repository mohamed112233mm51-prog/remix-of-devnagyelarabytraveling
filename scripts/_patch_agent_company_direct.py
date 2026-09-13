from __future__ import annotations

import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_REPO = "mohamed112233mm51-prog/develsayad"
BASE_REF = "e0e5f53dae65541078f9a8fc9a47cac64da45ad1"
POST_REF = "271270287d5d6dcc34a53e86b5e1c1ff45d92d3f"

EXISTING_FILES = [
    "src/components/PaymentSplits.tsx",
    "src/features/companies/LegacyCompaniesRoute.tsx",
    "src/lib/dashboardCollections.ts",
    "src/lib/financialEngine.cancel.ts",
    "src/lib/financialEngine.update.ts",
    "src/lib/financialSummary.ts",
]

NEW_FILES = [
    "src/lib/agentCompanyDirectTransfer.ts",
    "supabase/migrations/20260907183000_agent_company_direct_transfer_cancel.sql",
]


def raw_url(ref: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{SOURCE_REPO}/{ref}/{path}"


def download(ref: str, path: str) -> bytes:
    req = urllib.request.Request(raw_url(ref, path), headers={"User-Agent": "agent-company-direct-patch"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def assert_base_matches() -> None:
    mismatches: list[str] = []
    for rel in EXISTING_FILES:
        current_path = ROOT / rel
        if not current_path.exists():
            mismatches.append(f"{rel}: missing in target repo")
            continue
        expected = download(BASE_REF, rel)
        actual = current_path.read_bytes()
        if actual != expected:
            mismatches.append(f"{rel}: target no longer matches reviewed base")
    if mismatches:
        fail(
            "Architecture preflight failed; refusing to overwrite divergent files:\n- "
            + "\n- ".join(mismatches)
        )


def copy_reviewed_change() -> None:
    for rel in EXISTING_FILES + NEW_FILES:
        target = ROOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(download(POST_REF, rel))
        print(f"updated {rel}")


def add_regression_test() -> None:
    test_path = ROOT / "scripts" / "test-agent-company-direct.mjs"
    test_path.write_text(
        r'''import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(path, "utf8");
const has = (text, needle, label) => assert.ok(text.includes(needle), label);
const lacks = (text, needle, label) => assert.ok(!text.includes(needle), label);

const direct = read("src/lib/agentCompanyDirectTransfer.ts");
has(direct, 'AGENT_COMPANY_DIRECT_SOURCE = "agent_direct_to_company"', "direct source marker missing");
has(direct, 'atomicRow("company_transactions", companyRow)', "company leg must be atomic");
has(direct, 'atomicRow("transactions", agentRow)', "agent leg must be atomic");
has(direct, 'source_service_id: agentTransactionId', "company leg must link to agent leg");
has(direct, 'source_service_id: companyTransactionId', "agent leg must link to company leg");
lacks(direct, 'atomicRow("payment_splits"', "direct transfer must not create payment_splits");
lacks(direct, 'cash_box_id', "direct transfer must not touch a cash box");

const route = read("src/features/companies/LegacyCompaniesRoute.tsx");
has(route, 'directRows.length !== 1 || validSplits.length !== 1', "direct settlement must be isolated from company/merchant splits");
has(route, 'if (tripValueNum > 0)', "direct settlement must not carry service sale value");
has(route, 'postAgentCompanyDirectTransfer({', "company create flow must use reviewed atomic direct-transfer helper");
has(route, 'agents={agents} allowAgentSource', "company payment UI must expose the agent source only in this flow");

const splits = read("src/components/PaymentSplits.tsx");
has(splits, '<option value="agent">وكيل</option>', "agent payment source option missing");
has(splits, 'agent_direct', "agent direct payment method missing");
has(splits, 'اختر الوكيل للدفع المباشر', "agent selection validation missing");

const update = read("src/lib/financialEngine.update.ts");
has(update, 'source_service_type === "agent_direct_to_company"', "edit guard missing");
has(update, 'لا يمكن تعديل التحويل المباشر بين الوكيل والشركة من طرف واحد', "single-leg edit must be rejected");

const cancel = read("src/lib/financialEngine.cancel.ts");
has(cancel, 'set_agent_company_direct_cancel_state_atomic', "paired cancel RPC routing missing");
has(cancel, 'data.counterpart_before', "counterpart audit handling missing");

const summary = read("src/lib/financialSummary.ts");
has(summary, 'function companySettlementAmount', "company direct-settlement amount fallback missing");
has(summary, 'دفع مباشر للشركة', "agent ledger label missing");
has(summary, 'دفع مباشر من وكيل', "company ledger label missing");

const dashboardCollections = read("src/lib/dashboardCollections.ts");
has(dashboardCollections, 'function agentCollectionAmount', "agent collection fallback missing");
has(dashboardCollections, 'source_service_type === "agent_direct_to_company"', "agent direct collection source handling missing");

const migration = read("supabase/migrations/20260907183000_agent_company_direct_transfer_cancel.sql");
has(migration, 'set_agent_company_direct_cancel_state_atomic', "paired cancel DB function missing");
has(migration, "source_service_type = 'agent_direct_to_company'", "direct insert policy missing");
has(migration, "v_counterpart_id", "paired cancel counterpart lock/update missing");
lacks(migration, 'INSERT INTO public.payment_splits', "migration must not create treasury/payment split movement");

console.log("agent-company direct transfer regression checks passed");
''',
        encoding="utf-8",
    )

    package_path = ROOT / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    scripts = package.setdefault("scripts", {})
    scripts["test:agent-company-direct"] = "node scripts/test-agent-company-direct.mjs"
    package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    print("Preflight: verifying reviewed architecture base...")
    assert_base_matches()
    print("Base matches. Applying reviewed client change...")
    copy_reviewed_change()
    add_regression_test()
    print("Patch complete. Run npm run test:agent-company-direct, npx tsc --noEmit, and npm run build.")


if __name__ == "__main__":
    main()
