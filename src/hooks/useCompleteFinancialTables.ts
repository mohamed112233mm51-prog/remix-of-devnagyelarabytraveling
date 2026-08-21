import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LiveTable } from "@/lib/db";

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(table: LiveTable): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const page = (Array.isArray(data) ? data : []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export function useCompleteFinancialTable<T>(table: LiveTable) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        if (mounted) setLoading(true);
        const data = await fetchAllRows<T>(table);
        if (!mounted) return;
        setRows(data);
        setError(null);
      } catch (err: any) {
        if (!mounted) return;
        setRows([]);
        setError(err?.message || "تعذر تحميل البيانات كاملة");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel(`complete-${table}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table }, () => load())
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [table]);

  return useMemo(() => ({ rows, loading, error }), [rows, loading, error]);
}
