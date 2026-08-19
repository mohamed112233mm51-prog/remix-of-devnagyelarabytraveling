import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLive, type Agent, type Transaction } from "@/lib/db";
import { resolveSplitCurrencyByRef, summarizeAgent, type EntitySummary } from "@/lib/financialSummary";
import { toast } from "sonner";

type SplitCurrencyRow = {
  source_table?: string | null;
  source_id?: string | null;
  transaction_id?: string | null;
  currency?: string | null;
};

const PAGE_SIZE = 1000;

async function loadAllRows<T>(table: "transactions" | "payment_splits", orderColumn: string): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = Array.isArray(data) ? (data as T[]) : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export function useCompleteAgentsSummary(): Map<string, EntitySummary> {
  const { rows: agents } = useLive<Agent>("agents");
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [splits, setSplits] = useState<SplitCurrencyRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    const reload = async () => {
      try {
        const [allTxns, allSplits] = await Promise.all([
          loadAllRows<Transaction>("transactions", "created_at"),
          loadAllRows<SplitCurrencyRow>("payment_splits", "created_at"),
        ]);
        if (!cancelled) {
          setTxns(allTxns);
          setSplits(allSplits);
        }
      } catch (error: any) {
        if (!cancelled) toast.error(error?.message || "تعذر تحميل أرصدة الوكلاء كاملة");
      }
    };

    reload();

    const txChannel = supabase
      .channel(`complete-agent-summaries-tx-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "transactions" }, reload)
      .subscribe();

    const splitChannel = supabase
      .channel(`complete-agent-summaries-splits-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "payment_splits" }, reload)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(txChannel);
      supabase.removeChannel(splitChannel);
    };
  }, []);

  return useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    for (const a of agents) grouped.set(a.id, []);
    for (const t of txns) {
      if (!t.agent_id) continue;
      const list = grouped.get(t.agent_id);
      if (list) list.push(t);
    }

    const curMap = resolveSplitCurrencyByRef(splits as any, "transactions");
    const out = new Map<string, EntitySummary>();
    for (const [id, list] of grouped) out.set(id, summarizeAgent(list, curMap));
    return out;
  }, [agents, txns, splits]);
}
