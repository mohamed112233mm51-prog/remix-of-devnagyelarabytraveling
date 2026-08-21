import { useMemo } from "react";
import {
  useLive,
  type CompanyTransaction,
  type InvestorTransaction,
  type MerchantCashCollection,
  type Transaction,
  type UsdTreasuryTransaction,
} from "@/lib/db";
import {
  CurrencyMap,
  buildCurrencySupplierLedgerRows,
  computeMerchantAggregates,
  currencySupplierDelta,
  resolveSplitCurrencyByRef,
  summarizeAgent,
  summarizeCompany,
  type CurrencySupplierTx,
} from "@/lib/financialSummary";
import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";

type CashBoxRow = {
  id: string;
  name: string;
  currency: string;
  balance: number | string | null;
  is_active?: boolean | null;
};

export type FinancialPositionSplit = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  cash_box_id: string | null;
  currency: string | null;
  amount: number | string;
  direction: "in" | "out" | string;
  cancelled_at?: string | null;
};

export type InvestorCapitalSummary = {
  deposit: CurrencyMap;
  withdraw: CurrencyMap;
  balance: CurrencyMap;
  linkedTransactionCount: number;
  legacyTransactionCount: number;
};

export type FinancialPositionSection = {
  key: "agents" | "companies" | "merchants" | "currency_suppliers";
  label: string;
  receivable: CurrencyMap;
  payable: CurrencyMap;
  net: CurrencyMap;
};

export type FinancialPosition = {
  treasury: CurrencyMap;
  receivables: CurrencyMap;
  payables: CurrencyMap;
  totalAssets: CurrencyMap;
  totalLiabilities: CurrencyMap;
  netPosition: CurrencyMap;
  ownerCapital: CurrencyMap;
  operatingFundsExOwner: CurrencyMap;
  sections: FinancialPositionSection[];
  legacyInvestorTransactionCount: number;
};

function splitRowsByInvestorTransaction(
  splits: readonly FinancialPositionSplit[],
): Map<string, FinancialPositionSplit[]> {
  const map = new Map<string, FinancialPositionSplit[]>();
  for (const split of splits) {
    if (split.source_table !== "investor_transactions" || !split.source_id) continue;
    const list = map.get(split.source_id) || [];
    list.push(split);
    map.set(split.source_id, list);
  }
  return map;
}

/**
 * رأس مال المالك/المستثمرين.
 * - الحركات الجديدة المربوطة بـ payment_splits تُقرأ من الخزينة الفعلية وعملتها.
 * - الحركات القديمة غير المربوطة يمكن إبقاؤها في كشف المستثمر كـ EGP للعرض فقط.
 *   ولا تدخل في المركز المالي عند includeLegacy=false حتى لا نحرك/نفترض خزائن بأثر رجعي.
 */
export function buildInvestorCapitalSummary(
  transactions: readonly InvestorTransaction[],
  splits: readonly FinancialPositionSplit[],
  opts: { includeLegacy?: boolean } = {},
): InvestorCapitalSummary {
  const includeLegacy = opts.includeLegacy ?? true;
  const deposit = new CurrencyMap();
  const withdraw = new CurrencyMap();
  const balance = new CurrencyMap();
  const splitMap = splitRowsByInvestorTransaction(splits);
  let linkedTransactionCount = 0;
  let legacyTransactionCount = 0;

  for (const txn of transactions) {
    const allLinked = splitMap.get(txn.id) || [];
    if (allLinked.length > 0) {
      linkedTransactionCount += 1;
      for (const split of allLinked) {
        if (split.cancelled_at) continue;
        const amount = Math.abs(Number(split.amount) || 0);
        if (amount <= 0) continue;
        const currency = String(split.currency || "EGP").toUpperCase();
        if (split.direction === "in") {
          deposit.add(currency, amount);
          balance.add(currency, amount);
        } else if (split.direction === "out") {
          withdraw.add(currency, amount);
          balance.add(currency, -amount);
        }
      }
      continue;
    }

    legacyTransactionCount += 1;
    if (!includeLegacy) continue;
    const amount = Math.abs(Number(txn.amount) || 0);
    if (amount <= 0) continue;
    if (txn.transaction_type === "توريد نقدية") {
      deposit.add("EGP", amount);
      balance.add("EGP", amount);
    } else if (txn.transaction_type === "صرف نقدية") {
      withdraw.add("EGP", amount);
      balance.add("EGP", -amount);
    }
  }

  return { deposit, withdraw, balance, linkedTransactionCount, legacyTransactionCount };
}

export function investorTransactionCurrency(
  transactionId: string,
  splits: readonly FinancialPositionSplit[],
): string {
  const rows = splits.filter(
    (split) => split.source_table === "investor_transactions" && split.source_id === transactionId,
  );
  const active = rows.find((split) => !split.cancelled_at && split.currency);
  const any = rows.find((split) => split.currency);
  return String(active?.currency || any?.currency || "EGP").toUpperCase();
}

function emptySection(
  key: FinancialPositionSection["key"],
  label: string,
): FinancialPositionSection {
  return {
    key,
    label,
    receivable: new CurrencyMap(),
    payable: new CurrencyMap(),
    net: new CurrencyMap(),
  };
}

/**
 * signed > 0 = حق للشركة عند الجهة.
 * signed < 0 = التزام على الشركة للجهة.
 */
function addSigned(section: FinancialPositionSection, currency: string, signed: number) {
  if (!Number.isFinite(signed) || Math.abs(signed) < 0.0001) return;
  section.net.add(currency, signed);
  if (signed > 0) section.receivable.add(currency, signed);
  else section.payable.add(currency, Math.abs(signed));
}

function mergeSignedBalances(
  section: FinancialPositionSection,
  balance: CurrencyMap,
  factor: 1 | -1,
) {
  for (const { currency, amount } of balance.entries({ includeZero: true })) {
    addSigned(section, currency, amount * factor);
  }
}

function groupById<T>(
  rows: readonly T[],
  idOf: (row: T) => string | null | undefined,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = idOf(row);
    if (!id) continue;
    const list = grouped.get(id) || [];
    list.push(row);
    grouped.set(id, list);
  }
  return grouped;
}

function subtractMaps(a: CurrencyMap, b: CurrencyMap): CurrencyMap {
  const out = a.clone();
  for (const { currency, amount } of b.entries({ includeZero: true })) out.add(currency, -amount);
  return out;
}

export function useFinancialPosition(): FinancialPosition {
  const { rows: cashBoxes } = useLive<CashBoxRow>("cash_boxes");
  const { rows: transactions } = useCompleteFinancialTable<Transaction>("transactions");
  const { rows: companyTransactions } = useCompleteFinancialTable<CompanyTransaction>("company_transactions");
  const { rows: merchantCollections } = useCompleteFinancialTable<MerchantCashCollection>("merchant_cash_collections");
  const { rows: usdTreasuryRows } = useCompleteFinancialTable<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: supplierTransactions } = useCompleteFinancialTable<any>("currency_supplier_transactions");
  const { rows: investorTransactions } = useCompleteFinancialTable<InvestorTransaction>("investor_transactions");
  const { rows: paymentSplits } = useCompleteFinancialTable<FinancialPositionSplit>("payment_splits");

  return useMemo(() => {
    const sections: FinancialPositionSection[] = [
      emptySection("agents", "الوكلاء"),
      emptySection("companies", "الشركات الصادرة"),
      emptySection("merchants", "تجار الكاش"),
      emptySection("currency_suppliers", "موردو العملة"),
    ];
    const [agentsSection, companiesSection, merchantsSection, suppliersSection] = sections;

    // مهم: نحدد المدين/الدائن لكل جهة منفردة أولاً، ثم نجمع الأقسام.
    // لا نعمل Netting بين وكيل مدين ووكيل آخر دائن قبل تصنيفهما.

    // الوكلاء: موجب كشف الوكيل = حق للشركة عند هذا الوكيل.
    const agentCurrencyMap = resolveSplitCurrencyByRef(paymentSplits as any, "transactions");
    const agentGroups = groupById(transactions, (row) => row.agent_id);
    for (const rows of agentGroups.values()) {
      mergeSignedBalances(agentsSection, summarizeAgent(rows, agentCurrencyMap).balance, 1);
    }

    // الشركات الصادرة: موجب كشف الشركة = متبقي لهذه الشركة الصادرة (التزام علينا)، لذلك نعكس الإشارة.
    const companyCurrencyMap = resolveSplitCurrencyByRef(paymentSplits as any, "company_transactions");
    const companyGroups = groupById(companyTransactions, (row) => (row as any).company_id);
    for (const rows of companyGroups.values()) {
      mergeSignedBalances(companiesSection, summarizeCompany(rows, companyCurrencyMap).balance, -1);
    }

    // تجار الكاش: computeMerchantAggregates يعيد صافي كل تاجر منفرداً.
    // موجب كشف التاجر = أموال للشركة موجودة لدى هذا التاجر (أصل شبيه بالخزينة).
    // سالب كشف التاجر = التزام على الشركة لصالح هذا التاجر.
    const merchantAggregates = computeMerchantAggregates({
      txns: transactions,
      companyTxns: companyTransactions,
      collections: merchantCollections,
      usdRows: usdTreasuryRows,
      splits: paymentSplits as any,
    });
    for (const aggregate of merchantAggregates.values()) {
      mergeSignedBalances(merchantsSection, aggregate.balance, 1);
    }

    // مورّد العملة: نكوّن صافي كل مورد/عملة أولاً ثم نحدد هل هو أصل أم التزام.
    // currencySupplierDelta موجب = المورد مدين للنظام، سالب = النظام مدين للمورد.
    const supplierBalances = new Map<string, CurrencyMap>();
    for (const row of buildCurrencySupplierLedgerRows(supplierTransactions as CurrencySupplierTx[])) {
      const supplierId = String((row as any).supplier_id || "").trim();
      if (!supplierId) continue;
      const { currency, delta } = currencySupplierDelta(row);
      let map = supplierBalances.get(supplierId);
      if (!map) {
        map = new CurrencyMap();
        supplierBalances.set(supplierId, map);
      }
      map.add(currency, delta);
    }
    for (const balance of supplierBalances.values()) {
      mergeSignedBalances(suppliersSection, balance, 1);
    }

    const treasury = new CurrencyMap();
    const treasuryAssets = new CurrencyMap();
    const treasuryLiabilities = new CurrencyMap();
    for (const box of cashBoxes) {
      if (box.is_active === false) continue;
      const currency = String(box.currency || "EGP").toUpperCase();
      const amount = Number(box.balance) || 0;
      treasury.add(currency, amount);
      if (amount >= 0) treasuryAssets.add(currency, amount);
      else treasuryLiabilities.add(currency, Math.abs(amount));
    }

    // رصيد تاجر الكاش الموجب يعتبر من أموال الشركة المتاحة مثل الخزينة،
    // لذلك نضيفه للخزائن/الأصول ولا نكرره مرة ثانية ضمن المستحقات.
    treasury.merge(merchantsSection.receivable);
    treasuryAssets.merge(merchantsSection.receivable);

    const receivables = new CurrencyMap();
    const payables = new CurrencyMap();
    for (const section of sections) {
      if (section.key !== "merchants") receivables.merge(section.receivable);
      payables.merge(section.payable);
    }

    const totalAssets = treasuryAssets.clone();
    totalAssets.merge(receivables);
    const totalLiabilities = treasuryLiabilities.clone();
    totalLiabilities.merge(payables);
    const netPosition = subtractMaps(totalAssets, totalLiabilities);

    // رأس المال هنا من الحركات المربوطة فعلياً بالخزائن فقط.
    const ownerSummary = buildInvestorCapitalSummary(
      investorTransactions,
      paymentSplits,
      { includeLegacy: false },
    );
    const ownerCapital = ownerSummary.balance;
    const operatingFundsExOwner = subtractMaps(netPosition, ownerCapital);

    return {
      treasury,
      receivables,
      payables,
      totalAssets,
      totalLiabilities,
      netPosition,
      ownerCapital,
      operatingFundsExOwner,
      sections,
      legacyInvestorTransactionCount: ownerSummary.legacyTransactionCount,
    };
  }, [
    cashBoxes,
    transactions,
    companyTransactions,
    merchantCollections,
    usdTreasuryRows,
    supplierTransactions,
    investorTransactions,
    paymentSplits,
  ]);
}
