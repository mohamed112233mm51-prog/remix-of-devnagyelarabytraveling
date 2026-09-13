from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"Architecture preflight failed in {path}: expected {expected} occurrence(s), found {count}: {old[:160]!r}")
    write(path, text.replace(old, new, expected))


# Shared Source of Truth for the three allowed direct-transfer methods.
write("src/lib/directTransferPaymentMethod.ts", '''export type DirectTransferPaymentMethod =
  | "direct_instapay"
  | "direct_vodafone_cash"
  | "direct_cash";

export const DIRECT_TRANSFER_PAYMENT_METHODS: Array<{
  key: DirectTransferPaymentMethod;
  label: string;
}> = [
  { key: "direct_instapay", label: "إنستا" },
  { key: "direct_vodafone_cash", label: "فودافون كاش" },
  { key: "direct_cash", label: "نقدي" },
];

export function isDirectTransferPaymentMethod(value: unknown): value is DirectTransferPaymentMethod {
  return DIRECT_TRANSFER_PAYMENT_METHODS.some((option) => option.key === value);
}

export function directTransferPaymentLabel(method: DirectTransferPaymentMethod): string {
  return DIRECT_TRANSFER_PAYMENT_METHODS.find((option) => option.key === method)?.label || "دفع مباشر";
}

export function directTransferPaymentAmounts(method: DirectTransferPaymentMethod, amount: number) {
  const value = Number(amount) || 0;
  return {
    instapayAmount: method === "direct_instapay" ? value : 0,
    cashAmount: method === "direct_cash" ? value : 0,
    mobileCashAmount: method === "direct_vodafone_cash" ? value : 0,
    mobileCashNetAmount: method === "direct_vodafone_cash" ? value : 0,
  };
}

export function directTransferPaymentLabelFromRow(row: {
  instapay_amount?: number | string | null;
  cash_amount?: number | string | null;
  mobile_cash_amount?: number | string | null;
}): string | null {
  if (Math.abs(Number(row.instapay_amount || 0)) > 0) return "إنستا";
  if (Math.abs(Number(row.mobile_cash_amount || 0)) > 0) return "فودافون كاش";
  if (Math.abs(Number(row.cash_amount || 0)) > 0) return "نقدي";
  return null;
}
''')

# The existing atomic helper remains the only Create path for direct transfers.
replace_exact(
    "src/lib/agentCompanyDirectTransfer.ts",
    'import { deriveFinancialOperationUuid } from "@/lib/financialIdempotency";\n',
    'import { deriveFinancialOperationUuid } from "@/lib/financialIdempotency";\nimport { directTransferPaymentAmounts, directTransferPaymentLabel, isDirectTransferPaymentMethod, type DirectTransferPaymentMethod } from "@/lib/directTransferPaymentMethod";\n',
)
replace_exact(
    "src/lib/agentCompanyDirectTransfer.ts",
    '  amount: number;\n  destination?: string | null;',
    '  amount: number;\n  paymentMethod: DirectTransferPaymentMethod;\n  destination?: string | null;',
)
replace_exact(
    "src/lib/agentCompanyDirectTransfer.ts",
    '  if (!args.operationId || !args.fingerprint || !args.companyId || !args.agentId || !args.date || !args.currency || !(amount > 0)) {\n    return { ok: false as const, error: "بيانات التحويل المباشر بين الوكيل والشركة غير مكتملة" };\n  }\n\n  const companyTransactionId = args.operationId;',
    '  if (!args.operationId || !args.fingerprint || !args.companyId || !args.agentId || !args.date || !args.currency || !(amount > 0)) {\n    return { ok: false as const, error: "بيانات التحويل المباشر بين الوكيل والشركة غير مكتملة" };\n  }\n  if (!isDirectTransferPaymentMethod(args.paymentMethod)) {\n    return { ok: false as const, error: "اختر وسيلة الدفع للتحويل المباشر" };\n  }\n\n  const companyTransactionId = args.operationId;',
)
replace_exact(
    "src/lib/agentCompanyDirectTransfer.ts",
    '  const agentTransactionId = deriveFinancialOperationUuid(args.operationId, "agent-company-direct:agent");\n  const common = {',
    '  const agentTransactionId = deriveFinancialOperationUuid(args.operationId, "agent-company-direct:agent");\n  const paymentAmounts = directTransferPaymentAmounts(args.paymentMethod, amount);\n  const paymentMethodLabel = directTransferPaymentLabel(args.paymentMethod);\n  const common = {',
)
replace_exact(
    "src/lib/agentCompanyDirectTransfer.ts",
    '    instapay_amount: 0,\n    cash_amount: 0,\n    mobile_cash_amount: 0,\n    mobile_cash_net_amount: 0,',
    '    instapay_amount: paymentAmounts.instapayAmount,\n    cash_amount: paymentAmounts.cashAmount,\n    mobile_cash_amount: paymentAmounts.mobileCashAmount,\n    mobile_cash_net_amount: paymentAmounts.mobileCashNetAmount,',
    expected=2,
)
replace_exact(
    "src/lib/agentCompanyDirectTransfer.ts",
    '    payment_method: "دفع مباشر للشركة",',
    '    payment_method: paymentMethodLabel,',
)

# Company-side UI: agent remains an opt-in source, but method is now explicit.
replace_exact(
    "src/components/PaymentSplits.tsx",
    'import type { Agent, Merchant } from "@/lib/db";\n',
    'import type { Agent, Merchant } from "@/lib/db";\nimport { DIRECT_TRANSFER_PAYMENT_METHODS } from "@/lib/directTransferPaymentMethod";\n',
)
replace_exact(
    "src/components/PaymentSplits.tsx",
    '  if (String((row as any).source) === "agent") return [{ key: "agent_direct", label: "دفع مباشر من الوكيل" }];',
    '  if (String((row as any).source) === "agent") return DIRECT_TRANSFER_PAYMENT_METHODS;',
)
replace_exact(
    "src/components/PaymentSplits.tsx",
    '                        method: source === "company" ? "company_cash" : source === "agent" ? "agent_direct" : "",',
    '                        method: source === "company" ? "company_cash" : "",',
)
replace_exact(
    "src/components/PaymentSplits.tsx",
    '                  <select value={row.agent_id} onChange={(e) => update(row.uid, { agent_id: e.target.value, method: "agent_direct" })}>',
    '                  <select value={row.agent_id} onChange={(e) => update(row.uid, { agent_id: e.target.value })}>',
)
replace_exact(
    "src/components/PaymentSplits.tsx",
    '                <select value={row.method} onChange={(e) => update(row.uid, { method: e.target.value })} disabled={String((row as any).source) === "agent"}>',
    '                <select value={row.method} onChange={(e) => update(row.uid, { method: e.target.value })}>',
)

# Company create flow: validate and forward the selected method into the same atomic helper.
replace_exact(
    "src/features/companies/LegacyCompaniesRoute.tsx",
    'import { postAgentCompanyDirectTransfer } from "@/lib/agentCompanyDirectTransfer";\n',
    'import { postAgentCompanyDirectTransfer } from "@/lib/agentCompanyDirectTransfer";\nimport { isDirectTransferPaymentMethod } from "@/lib/directTransferPaymentMethod";\n',
)
replace_exact(
    "src/features/companies/LegacyCompaniesRoute.tsx",
    '      const direct = directRows[0];\n      const amount = Number(direct.amount) || 0;',
    '      const direct = directRows[0];\n      if (!isDirectTransferPaymentMethod(direct.method)) return toast.error("اختر وسيلة الدفع للتحويل المباشر");\n      const amount = Number(direct.amount) || 0;',
)
replace_exact(
    "src/features/companies/LegacyCompaniesRoute.tsx",
    '        currency: selectedCurrency,\n        amount,\n        destination: form.destination || null,',
    '        currency: selectedCurrency,\n        amount,\n        paymentMethod: direct.method,\n        destination: form.destination || null,',
    expected=2,
)

# Agent-side form: add issuing company as a source, but route direct rows to the SAME atomic helper.
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    'import { useLive, useDropdownOptions, type Agent, type Merchant } from "@/lib/db";',
    'import { useLive, useDropdownOptions, type Agent, type Merchant, type IssuingCompany } from "@/lib/db";',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    'import { confirmFinancialOperation, financialOperationFingerprint, getOrCreateFinancialOperationId, isLikelyNetworkError } from "@/lib/financialIdempotency";',
    'import { confirmFinancialOperation, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    'import { resolveCompanyCashBoxForSplit } from "@/lib/balanceGuard";\n',
    'import { resolveCompanyCashBoxForSplit } from "@/lib/balanceGuard";\nimport { postAgentCompanyDirectTransfer } from "@/lib/agentCompanyDirectTransfer";\nimport { usePerm } from "@/hooks/usePerm";\nimport { DIRECT_TRANSFER_PAYMENT_METHODS, isDirectTransferPaymentMethod } from "@/lib/directTransferPaymentMethod";\n',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    'type Source = "company" | "merchant";',
    'type Source = "company" | "merchant" | "issuing_company";',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '  merchant_id: string;\n  method: string;',
    '  merchant_id: string;\n  issuing_company_id: string;\n  method: string;',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '  merchant_id: "",\n  method: "company_cash",',
    '  merchant_id: "",\n  issuing_company_id: "",\n  method: "company_cash",',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");\n  const SERVICE_TYPES = useDropdownOptions("service_type");',
    '  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");\n  const { rows: issuingCompanies } = useLive<IssuingCompany>("issuing_companies");\n  const companyPerm = usePerm("companies");\n  const SERVICE_TYPES = useDropdownOptions("service_type");',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '  const methodsForSplit = (row: SplitRow): { key: string; label: string }[] => {\n    if (row.source === "company") return COMPANY_METHODS;\n    const m = merchants.find((x) => x.id === row.merchant_id);',
    '  const methodsForSplit = (row: SplitRow): { key: string; label: string }[] => {\n    if (row.source === "company") return COMPANY_METHODS;\n    if (row.source === "issuing_company") return DIRECT_TRANSFER_PAYMENT_METHODS;\n    const m = merchants.find((x) => x.id === row.merchant_id);',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '      if (r.source === "merchant" && !r.merchant_id) return toast.error("اختر التاجر لكل سطر تاجر");\n      if (!r.method) return toast.error("اختر وسيلة الدفع لكل سطر");',
    '      if (r.source === "merchant" && !r.merchant_id) return toast.error("اختر التاجر لكل سطر تاجر");\n      if (r.source === "issuing_company" && !r.issuing_company_id) return toast.error("اختر الشركة الصادرة للدفع المباشر");\n      if (!r.method) return toast.error("اختر وسيلة الدفع لكل سطر");',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '    // Company-funded rows must resolve to a real company cash box BEFORE any\n',
    '''    const directRows = validSplits.filter((r) => r.source === "issuing_company");
    if (directRows.length > 0) {
      if (directRows.length !== 1 || validSplits.length !== 1) {
        return toast.error("الدفع المباشر للشركة الصادرة يجب أن يكون في حركة مستقلة بدون خلطه بخزنة الشركة أو التاجر");
      }
      if (tripValueNum > 0) {
        return toast.error("الدفع المباشر للشركة الصادرة تسوية مالية فقط؛ اترك العدد والسعر فارغين");
      }
      const direct = directRows[0];
      if (!isDirectTransferPaymentMethod(direct.method)) return toast.error("اختر وسيلة الدفع للتحويل المباشر");
      const amount = Number(direct.amount) || 0;
      const fingerprint = financialOperationFingerprint({
        type: "agent_company_direct",
        companyId: direct.issuing_company_id,
        agentId: form.agent_id,
        date: form.date,
        currency: selectedCurrency,
        amount,
        paymentMethod: direct.method,
        destination: form.destination || null,
        serviceType: form.service_type || null,
        statement: form.statement.trim() || null,
        note: form.note.trim() || null,
      });
      const operationId = getOrCreateFinancialOperationId("agent-company-direct", fingerprint);
      const toastId = financialConfirmationToastId(operationId);
      setSaving(true);
      toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

      const directRes = await postAgentCompanyDirectTransfer({
        operationId,
        fingerprint,
        companyId: direct.issuing_company_id,
        agentId: form.agent_id,
        date: form.date,
        currency: selectedCurrency,
        amount,
        paymentMethod: direct.method,
        destination: form.destination || null,
        serviceType: form.service_type || null,
        statement: form.statement.trim() || null,
        note: form.note.trim() || null,
      });
      if (!directRes.ok) {
        setSaving(false);
        toast.error(
          isLikelyNetworkError(directRes.error)
            ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
            : (directRes.error || "تعذر حفظ التحويل المباشر"),
          { id: toastId },
        );
        return;
      }

      try { await logCreate("company_transactions", directRes.companyTransactionId, directRes.companyRow, "دفع مباشر من وكيل"); } catch { /* non-blocking audit */ }
      try { await logCreate("transactions", directRes.agentTransactionId, directRes.agentRow, "دفع مباشر للشركة"); } catch { /* non-blocking audit */ }

      confirmFinancialOperation(operationId);
      setSaving(false);
      toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
      resetDraft();
      onDone();
      return;
    }

    // Company-funded rows must resolve to a real company cash box BEFORE any
''',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '                  onChange={(v) => updateSplit(row.uid, { source: v as Source, merchant_id: "", method: v === "company" ? "company_cash" : "" })}\n                  options={[{ value: "company", label: "الشركة" }, { value: "merchant", label: "تاجر" }]}',
    '                  onChange={(v) => updateSplit(row.uid, { source: v as Source, merchant_id: "", issuing_company_id: "", method: v === "company" ? "company_cash" : "" })}\n                  options={[{ value: "company", label: "الشركة" }, { value: "merchant", label: "تاجر" }, ...(companyPerm.create ? [{ value: "issuing_company", label: "شركة صادرة" }] : [])]}',
)
replace_exact(
    "src/components/AgentPaymentForm.tsx",
    '              <div className="form-group"><label>وسيلة الدفع</label>\n',
    '''              {row.source === "issuing_company" && (
                <div className="form-group"><label>الشركة الصادرة</label>
                  <SearchableSelect
                    value={row.issuing_company_id}
                    onChange={(v) => updateSplit(row.uid, { issuing_company_id: v })}
                    options={activeOptions(issuingCompanies, row.issuing_company_id, (c) => c.company_name)}
                    placeholder="اختر..."
                  />
                </div>
              )}
              <div className="form-group"><label>وسيلة الدفع</label>
''',
)

# Ledger display reads the method from the same direct-transfer row columns.
replace_exact(
    "src/lib/financialSummary.ts",
    'import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";\n',
    'import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";\nimport { directTransferPaymentLabelFromRow } from "@/lib/directTransferPaymentMethod";\n',
)
replace_exact(
    "src/lib/financialSummary.ts",
    'paymentMethod: credit > 0 ? ((t as any).source_service_type === "agent_direct_to_company" ? "دفع مباشر للشركة" : paymentMethodLabel(t)) : "—",',
    'paymentMethod: credit > 0 ? ((t as any).source_service_type === "agent_direct_to_company" ? (directTransferPaymentLabelFromRow(t as any) || "دفع مباشر للشركة") : paymentMethodLabel(t)) : "—",',
)
replace_exact(
    "src/lib/financialSummary.ts",
    'paymentMethod: payment > 0 ? ((t as any).source_service_type === "agent_direct_to_company" ? "دفع مباشر من وكيل" : paymentMethodLabel(t)) : "—",',
    'paymentMethod: payment > 0 ? ((t as any).source_service_type === "agent_direct_to_company" ? (directTransferPaymentLabelFromRow(t as any) || "دفع مباشر من وكيل") : paymentMethodLabel(t)) : "—",',
)

# Upgrade the existing regression test so both follow-up rules are permanent.
write("scripts/test-agent-company-direct.mjs", '''import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(path, "utf8");
const has = (text, needle, label) => assert.ok(text.includes(needle), label);
const lacks = (text, needle, label) => assert.ok(!text.includes(needle), label);

const direct = read("src/lib/agentCompanyDirectTransfer.ts");
has(direct, 'AGENT_COMPANY_DIRECT_SOURCE = "agent_direct_to_company"', "direct source marker missing");
has(direct, 'paymentMethod: DirectTransferPaymentMethod', "direct method must be an explicit input");
has(direct, 'isDirectTransferPaymentMethod(args.paymentMethod)', "direct method validation missing");
has(direct, 'directTransferPaymentAmounts(args.paymentMethod, amount)', "method amount mapping missing");
has(direct, 'atomicRow("company_transactions", companyRow)', "company leg must be atomic");
has(direct, 'atomicRow("transactions", agentRow)', "agent leg must be atomic");
has(direct, 'source_service_id: agentTransactionId', "company leg must link to agent leg");
has(direct, 'source_service_id: companyTransactionId', "agent leg must link to company leg");
lacks(direct, 'atomicRow("payment_splits"', "direct transfer must not create payment_splits");
lacks(direct, 'cash_box_id', "direct transfer must not touch a cash box");

const methods = read("src/lib/directTransferPaymentMethod.ts");
has(methods, '"direct_instapay"', "Instapay direct method missing");
has(methods, '"direct_vodafone_cash"', "Vodafone Cash direct method missing");
has(methods, '"direct_cash"', "cash direct method missing");
has(methods, 'mobileCashNetAmount', "Vodafone Cash row mapping missing");

const route = read("src/features/companies/LegacyCompaniesRoute.tsx");
has(route, 'directRows.length !== 1 || validSplits.length !== 1', "company-side direct settlement must be isolated");
has(route, 'isDirectTransferPaymentMethod(direct.method)', "company-side method validation missing");
has(route, 'paymentMethod: direct.method', "company-side method must reach the atomic helper");
has(route, 'postAgentCompanyDirectTransfer({', "company create flow must use the shared atomic helper");
has(route, 'agents={agents} allowAgentSource', "company payment UI must expose the agent source only in this flow");

const splits = read("src/components/PaymentSplits.tsx");
has(splits, 'DIRECT_TRANSFER_PAYMENT_METHODS', "company-side direct method choices missing");
has(splits, '<option value="agent">وكيل</option>', "agent source option missing");
has(splits, 'اختر الوكيل للدفع المباشر', "agent selection validation missing");
lacks(splits, 'disabled={String((row as any).source) === "agent"}', "company-side direct method must be selectable");

const agentForm = read("src/components/AgentPaymentForm.tsx");
has(agentForm, 'type Source = "company" | "merchant" | "issuing_company"', "agent-side issuing-company source missing");
has(agentForm, 'companyPerm.create ? [{ value: "issuing_company", label: "شركة صادرة" }]', "agent-side company source must respect company create permission");
has(agentForm, 'directRows.length !== 1 || validSplits.length !== 1', "agent-side direct settlement must be isolated");
has(agentForm, 'isDirectTransferPaymentMethod(direct.method)', "agent-side method validation missing");
has(agentForm, 'paymentMethod: direct.method', "agent-side method must reach the atomic helper");
has(agentForm, 'postAgentCompanyDirectTransfer({', "agent-side flow must reuse the same atomic helper");

const update = read("src/lib/financialEngine.update.ts");
has(update, 'source_service_type === "agent_direct_to_company"', "edit guard missing");
has(update, 'لا يمكن تعديل التحويل المباشر بين الوكيل والشركة من طرف واحد', "single-leg edit must remain rejected");

const cancel = read("src/lib/financialEngine.cancel.ts");
has(cancel, 'set_agent_company_direct_cancel_state_atomic', "paired cancel RPC routing missing");
has(cancel, 'data.counterpart_before', "counterpart audit handling missing");

const summary = read("src/lib/financialSummary.ts");
has(summary, 'directTransferPaymentLabelFromRow', "ledger direct-method resolver missing");
has(summary, 'const payment = Math.round(Number((t as any).total_paid || 0));', "company ledger total_paid source-of-truth must remain intact");

const migration = read("supabase/migrations/20260907183000_agent_company_direct_transfer_cancel.sql");
has(migration, 'set_agent_company_direct_cancel_state_atomic', "paired cancel DB function missing");
has(migration, "source_service_type = 'agent_direct_to_company'", "direct insert policy missing");
lacks(migration, 'INSERT INTO public.payment_splits', "direct transfer migration must not create treasury movement");

console.log("agent-company direct transfer follow-up regression checks passed");
''')

print("Guarded follow-up patch applied. Run regression test, TypeScript, and build before committing.")
