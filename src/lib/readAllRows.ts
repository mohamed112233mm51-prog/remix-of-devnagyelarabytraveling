import type { SupabaseClient } from "@supabase/supabase-js";

interface DateFilterQuery {
  eq(column: string, value: string): this;
  is(column: string, value: null): this;
  not(column: string, operator: string, value: null): this;
  in(column: string, values: readonly string[]): this;
  abortSignal(signal: AbortSignal): this;
  gte(column: string, value: string): this;
  lt(column: string, value: string): this;
  or(filters: string): this;
}
export type ReadAllRowsFilter = <Query extends DateFilterQuery>(query: Query) => Query;

/** Read the complete RLS-visible result; never turn a transport page into a row limit. */
export async function readAllRows<T>(
  client: SupabaseClient<any>,
  table: string,
  columns = "*",
  filter?: ReadAllRowsFilter,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    // Reapply the same filters before paging, so offsets belong to the
    // filtered result rather than to the table's entire history.
    let query = client.from(table).select(columns);
    if (filter) query = filter(query);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
