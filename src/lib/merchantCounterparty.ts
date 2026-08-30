import { normalizeCurrency } from "@/lib/db";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { deriveFinancialOperationUuid } from "@/lib/financialIdempotency";
import { atomicRow, buildAtomicPaymentSplitRows, type FinancialAtomicRow } from "@/lib/financialAtomic";

type MerchantCompanySplit = {
  source?: string;
  merchant_id?: string | null;
  method?: string | null;
  amount?: string | number | null;
  currency?: string | null;
};

type CounterpartArgs = {
  splits: MerchantCompanySplit[];
  parentId: string;
  date: string;
  statement?: string;
  note?: string;
  sourceServiceType: string;
  serviceType: string;
  defaultStatement: string;
};

function methodLabel(method?: string | null): string {
  if (method === "merchant_instapay") return "انستا";
  if (method === "merchant_wallet") return "فودافون كاش";
  if (method === "merchant_physical") return "نقدي";
  return "تاجر الكاش";
}

function counterpartArgsForCompany(args: {
  splits: MerchantCompanySplit[];
  companyTransactionId: string;
  date: string;
  statement?: string;
  note?: string;
}): CounterpartArgs {
  return {
    splits: args.splits,
    parentId: args.companyTransactionId,
    date: args.date,
    statement: args.statement,
    note: args.note,
    sourceServiceType: "merchant_cash_out_to_company",
    serviceType: "صادر لشركة",
    defaultStatement: "صادر لشركة",
  };
}

function counterpartArgsForAgent(args: {
  splits: MerchantCompanySplit[];
  agentTransactionId: string;
  date: string;
  statement?: string;
  note?: string;
}): CounterpartArgs {
  return {
    splits: args.splits,
    parentId: args.agentTransactionId,
    date: args.date,
    statement: args.statement,
    note: args.note,
    sourceServiceType: "merchant_cash_out_to_agent",
    serviceType: "صرف نقدية لوكيل",
    defaultStatement: "صرف نقدية لوكيل",
  };
}

/**
 * Pure builder used by compound financial saves. The returned parent transaction
 * rows + their payment_splits can be appended to the caller's main atomic RPC so
 * a merchant counterpart can never commit separately from its source operation.
 */
function buildCounterpartRows(args: CounterpartArgs): FinancialAtomicRow[] {
  const rows: FinancialAtomicRow[] = [];
  const merchantSplits = args.splits.filter(
    (r) => r.source === "merchant" && r.merchant_id && Number(r.amount || 0) > 0,
  );

  for (let index = 0; index < merchantSplits.length; index += 1) {
    const row = merchantSplits[index];
    const amount = Number(row.amount || 0);
    const currency = normalizeCurrency(row.currency) as "EGP" | "USD" | "LYD";
    const statement = args.statement?.trim() || args.defaultStatement;
    const note = args.note?.trim() || null;
    const method = methodLabel(row.method);
    const counterpartOperationId = deriveFinancialOperationUuid(
      args.parentId,
      `merchant-counterpart:${args.sourceServiceType}:${index}:${row.merchant_id || "none"}`,
    );

    rows.push(atomicRow("transactions", {
      id: counterpartOperationId,
      agent_id: null,
      merchant_id: row.merchant_id,
      date: args.date,
      destination: null,
      travel_statement: null,
      count: 0,
      price: 0,
      paid: -amount,
      total_paid: -amount,
      instapay_amount: 0,
      cash_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
      payment_method: method,
      service_type: args.serviceType,
      statement,
      note,
      currency,
      source_service_type: args.sourceServiceType,
      source_service_id: args.parentId,
    }));

    const split: MovementSplit = {
      method,
      currency,
      cashBoxId: null,
      amount,
      direction: "out",
      grossAmount: amount,
      netAmount: amount,
      exchangeRate: 1,
      egpEquivalent: currency === "EGP" ? amount : 0,
    };

    rows.push(...buildAtomicPaymentSplitRows({
      operationId: counterpartOperationId,
      splits: [split],
      transactionId: counterpartOperationId,
      sourceTable: "transactions",
      sourceId: counterpartOperationId,
      childPrefix: "split",
    }));
  }

  return rows;
}

export function buildMerchantCashOutToCompanyCounterpartRows(args: {
  splits: MerchantCompanySplit[];
  companyTransactionId: string;
  date: string;
  statement?: string;
  note?: string;
}): FinancialAtomicRow[] {
  return buildCounterpartRows(counterpartArgsForCompany(args));
}

export function buildMerchantCashOutToAgentCounterpartRows(args: {
  splits: MerchantCompanySplit[];
  agentTransactionId: string;
  date: string;
  statement?: string;
  note?: string;
}): FinancialAtomicRow[] {
  return buildCounterpartRows(counterpartArgsForAgent(args));
}

// Compatibility helpers for any legacy caller. Each counterpart itself is now
// atomic; compound screens should prefer the pure builders above and include all
// returned rows in their single source-operation RPC.
export async function postMerchantCashOutToCompanyCounterparts(args: {
  splits: MerchantCompanySplit[];
  companyTransactionId: string;
  date: string;
  statement?: string;
  note?: string;
}) {
  return postCounterparts(counterpartArgsForCompany(args));
}

export async function postMerchantCashOutToAgentCounterparts(args: {
  splits: MerchantCompanySplit[];
  agentTransactionId: string;
  date: string;
  statement?: string;
  note?: string;
}) {
  return postCounterparts(counterpartArgsForAgent(args));
}

async function postCounterparts(args: CounterpartArgs) {
  const merchantSplits = args.splits.filter(
    (r) => r.source === "merchant" && r.merchant_id && Number(r.amount || 0) > 0,
  );

  for (let index = 0; index < merchantSplits.length; index += 1) {
    const row = merchantSplits[index];
    const amount = Number(row.amount || 0);
    const currency = normalizeCurrency(row.currency) as "EGP" | "USD" | "LYD";
    const statement = args.statement?.trim() || args.defaultStatement;
    const note = args.note?.trim() || null;
    const method = methodLabel(row.method);
    const counterpartOperationId = deriveFinancialOperationUuid(
      args.parentId,
      `merchant-counterpart:${args.sourceServiceType}:${index}:${row.merchant_id || "none"}`,
    );

    const split: MovementSplit = {
      method,
      currency,
      cashBoxId: null,
      amount,
      direction: "out",
      grossAmount: amount,
      netAmount: amount,
      exchangeRate: 1,
      egpEquivalent: currency === "EGP" ? amount : 0,
    };

    const res = await postMovement({
      partyType: "merchant",
      partyId: row.merchant_id || null,
      kind: "payment",
      date: args.date,
      statement,
      note: note || undefined,
      splits: [split],
      operationId: counterpartOperationId,
      atomicFingerprint: JSON.stringify({
        parentId: args.parentId,
        sourceServiceType: args.sourceServiceType,
        index,
        merchantId: row.merchant_id,
        amount,
        currency,
        method,
      }),
      atomicParent: {
        table: "transactions",
        id: counterpartOperationId,
        payload: {
          agent_id: null,
          merchant_id: row.merchant_id,
          date: args.date,
          destination: null,
          travel_statement: null,
          count: 0,
          price: 0,
          paid: -amount,
          total_paid: -amount,
          instapay_amount: 0,
          cash_amount: 0,
          mobile_cash_amount: 0,
          mobile_cash_net_amount: 0,
          arabic_tourism_cash_amount: 0,
          arabic_tourism_cash_net_amount: 0,
          merchant_cash_amount: 0,
          merchant_cash_net_amount: 0,
          merchant_cash_physical_amount: 0,
          payment_method: method,
          service_type: args.serviceType,
          statement,
          note,
          currency,
          source_service_type: args.sourceServiceType,
          source_service_id: args.parentId,
        },
      },
    });
    if (!res.ok) return { ok: false, error: res.error || "تعذر حفظ قيد تاجر الكاش" };
  }

  return { ok: true };
}
