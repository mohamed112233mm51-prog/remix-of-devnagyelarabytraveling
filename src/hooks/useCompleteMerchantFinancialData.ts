import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  CompanyTransaction,
  MerchantCashCollection,
  Transaction,
  UsdTreasuryTransaction,
} from "@/lib/db";

export type MerchantPaymentSplitRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  currency: string | null;
  cancelled_at?: string | null;
  [key: string]: unknown;
};

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(table: string): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table as any)
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data ?? []) as T[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

export function useCompleteMerchantFinancialData() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [companyTransactions, setCompanyTransactions] = useState<CompanyTransaction[]>([]);
  const [collections, setCollections] = useState<MerchantCashCollection[]>([]);
  const [conversions, setConversions] = useState<UsdTreasuryTransaction[]>([]);
  const [paymentSplits, setPaymentSplits] = useState<MerchantPaymentSplitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const channelNameRef = useRef(
    `complete-merchant-financial-data-${Math.random().toString(36).slice(2)}`,
  );

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const [txns, companyTxns, collectionRows, conversionRows, splitRows] = await Promise.all([
        fetchAllRows<Transaction>("transactions"),
        fetchAllRows<CompanyTransaction>("company_transactions"),
        fetchAllRows<MerchantCashCollection>("merchant_cash_collections"),
        fetchAllRows<UsdTreasuryTransaction>("usd_treasury_transactions"),
        fetchAllRows<MerchantPaymentSplitRow>("payment_splits"),
      ]);
      setTransactions(txns);
      setCompanyTransactions(companyTxns);
      setCollections(collectionRows);
      setConversions(conversionRows);
      setPaymentSplits(splitRows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();

    // This hook is used by several merchant widgets on the same page.
    // Supabase channels are keyed by name; reusing one name means the second
    // hook instance can receive an already-subscribed channel and `.on()` then
    // throws: "cannot add postgres_changes callbacks ... after subscribe".
    // Give each mounted hook instance its own stable channel name.
    const channel = supabase
      .channel(channelNameRef.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "company_transactions" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "merchant_cash_collections" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "usd_treasury_transactions" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_splits" }, () => void reload())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [reload]);

  return {
    transactions,
    companyTransactions,
    collections,
    conversions,
    paymentSplits,
    loading,
    error,
    reload,
  };
}
