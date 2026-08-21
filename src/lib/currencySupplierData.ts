import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 1000;

/**
 * Load the complete transaction history for one currency supplier.
 * Supabase/PostgREST responses can be capped, so a single select must not be
 * treated as a complete financial ledger.
 */
export async function fetchAllCurrencySupplierTransactions<T = any>(
  supplierId: string,
): Promise<T[]> {
  if (!supplierId) return [];

  const out: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("currency_supplier_transactions" as any)
      .select("*")
      .eq("supplier_id", supplierId)
      .order("tx_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const page = ((data as any) || []) as T[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return out;
}
