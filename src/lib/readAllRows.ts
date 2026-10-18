import type { SupabaseClient } from "@supabase/supabase-js";

/** Read the complete RLS-visible result; never turn a transport page into a row limit. */
export async function readAllRows<T>(
  client: SupabaseClient<any>,
  table: string,
  columns = "*",
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(table).select(columns)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
