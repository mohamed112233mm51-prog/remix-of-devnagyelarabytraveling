import { supabase } from "@/integrations/supabase/client";
import { normalizeCurrency } from "@/lib/db";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";

type MerchantCompanySplit = {
  source?: string;
  merchant_id?: string | null;
  method?: string | null;
  amount?: string | number | null;
  currency?: string | null;
};

function methodLabel(method?: string | null): string {
  if (method === "merchant_instapay") return "إنستاباي تاجر";
  if (method === "merchant_wallet") return "تاجر الكاش تاجر";
  if (method === "merchant_physical") return "نقدي تاجر";
  return "تاجر الكاش";
}

export async function postMerchantCashOutToCompanyCounterparts(args: {
  splits: MerchantCompanySplit[];
  companyTransactionId: string;
  date: string;
  statement?: string;
  note?: string;
}) {
  return postCounterparts({
    splits: args.splits,
    parentId: args.companyTransactionId,
    date: args.date,
    statement: args.statement,
    note: args.note,
    sourceServiceType: "merchant_cash_out_to_company",
    serviceType: "صادر لشركة",
    defaultStatement: "صادر لشركة",
  });
}

export async function postMerchantCashOutToAgentCounterparts(args: {
  splits: MerchantCompanySplit[];
  agentTransactionId: string;
  date: string;
  statement?: string;
  note?: string;
}) {
  return postCounterparts({
    splits: args.splits,
    parentId: args.agentTransactionId,
    date: args.date,
    statement: args.statement,
    note: args.note,
    sourceServiceType: "merchant_cash_out_to_agent",
    serviceType: "صرف نقدية لوكيل",
    defaultStatement: "صرف نقدية لوكيل",
  });
}

async function postCounterparts(args: {
  splits: MerchantCompanySplit[];
  parentId: string;
  date: string;
  statement?: string;
  note?: string;
  sourceServiceType: string;
  serviceType: string;
  defaultStatement: string;
}) {
  const merchantSplits = args.splits.filter(
    (r) => r.source === "merchant" && r.merchant_id && Number(r.amount || 0) > 0,
  );

  for (const row of merchantSplits) {
    const amount = Number(row.amount || 0);
    const currency = normalizeCurrency(row.currency) as "EGP" | "USD" | "LYD";
    const statement = args.statement?.trim() || args.defaultStatement;
    const note = args.note?.trim() || null;
    const method = methodLabel(row.method);

    const { data: txn, error: txnErr } = await supabase
      .from("transactions")
      .insert({
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
      })
      .select("id")
      .single();
    if (txnErr || !txn) return { ok: false, error: txnErr?.message || "تعذر حفظ قيد تاجر الكاش" };

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
      sourceTable: "transactions",
      sourceId: txn.id,
      transactionId: txn.id,
    });
    if (!res.ok) return { ok: false, error: res.error || "تعذر حفظ قيد تاجر الكاش" };
  }

  return { ok: true };
}
