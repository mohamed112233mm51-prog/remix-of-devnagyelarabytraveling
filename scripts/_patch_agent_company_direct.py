from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATCH = ROOT / "scripts" / "agent_company_direct.patch"
SUMMARY_PATH = ROOT / "src" / "lib" / "financialSummary.ts"


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def run_git_apply(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "apply", *args, str(PATCH)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        fail(f"Architecture preflight failed for {label}: expected exactly one current-architecture match, found {count}")
    return text.replace(old, new, 1)


def patch_current_financial_summary() -> None:
    text = SUMMARY_PATH.read_text(encoding="utf-8")

    anchor = '''function txnSaleAndPaid(t: Partial<Transaction>): { sale: number; paid: number } {
  return {
    sale: tripValue(t as any),
    paid: txnTotalPaid(t),
  };
}
'''
    helper = anchor + '''
function companySettlementAmount(t: Partial<CompanyTransaction>): number {
  const collected = txnCollectedAmount(t);
  if (collected > 0) return collected;
  if ((t as any).source_service_type === "agent_direct_to_company") {
    return Math.round(Number((t as any).total_paid || 0));
  }
  return collected;
}
'''
    text = replace_once(text, anchor, helper, "company settlement source-of-truth helper")
    text = replace_once(
        text,
        "    companyOutgoingNet += txnCollectedAmount(t);",
        "    companyOutgoingNet += companySettlementAmount(t);",
        "dashboard company direct settlement",
    )
    text = replace_once(
        text,
        '        paymentMethod: credit > 0 ? paymentMethodLabel(t) : "—",',
        '        paymentMethod: credit > 0 ? ((t as any).source_service_type === "agent_direct_to_company" ? "دفع مباشر للشركة" : paymentMethodLabel(t)) : "—",',
        "agent ledger direct-transfer label",
    )
    text = replace_once(
        text,
        '      paymentMethod: payment > 0 ? paymentMethodLabel(t) : "—",',
        '      paymentMethod: payment > 0 ? ((t as any).source_service_type === "agent_direct_to_company" ? "دفع مباشر من وكيل" : paymentMethodLabel(t)) : "—",',
        "company ledger direct-transfer label",
    )

    SUMMARY_PATH.write_text(text, encoding="utf-8")


def apply_reviewed_change() -> None:
    if not PATCH.exists():
        fail(f"Reviewed patch is missing: {PATCH.relative_to(ROOT)}")

    # financialSummary.ts evolved on the main development branch after the client
    # implementation. Apply all unchanged reviewed hunks normally, then adapt only
    # the direct-settlement semantics to the newer ledger source-of-truth below.
    exclude_summary = "--exclude=src/lib/financialSummary.ts"
    check = run_git_apply("--check", exclude_summary)
    if check.returncode != 0:
        fail(
            "Architecture preflight failed; one or more reviewed hunks no longer match the current devo branch.\n"
            + (check.stderr or check.stdout)
        )

    applied = run_git_apply(exclude_summary)
    if applied.returncode != 0:
        fail("Reviewed patch could not be applied after preflight.\n" + (applied.stderr or applied.stdout))

    patch_current_financial_summary()


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
has(summary, 'const payment = Math.round(Number((t as any).total_paid || 0));', "current company ledger total_paid source-of-truth must remain intact");

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
    package.setdefault("scripts", {})["test:agent-company-direct"] = "node scripts/test-agent-company-direct.mjs"
    package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    print("Preflight: checking reviewed hunks against current devo architecture...")
    apply_reviewed_change()
    print("Reviewed hunks applied; current financialSummary source-of-truth preserved and extended.")
    add_regression_test()
    print("Patch complete. Run npm run test:agent-company-direct, npx tsc --noEmit, and npm run build.")


if __name__ == "__main__":
    main()
