import { supabase } from "@/integrations/supabase/client";
import { patchLive } from "@/lib/db";
import type { ImportSpec } from "./specs";
import type { Lookups } from "./validate";

const norm = (s: any) =>
  String(s ?? "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim().toLowerCase();

type LookupKind = "agent" | "company" | "merchant" | "investor";

const TABLE: Record<LookupKind, { table: string; nameCol: string; live: any }> = {
  agent:    { table: "agents",            nameCol: "name",          live: "agents" },
  company:  { table: "issuing_companies", nameCol: "company_name",  live: "issuing_companies" },
  merchant: { table: "merchants",         nameCol: "merchant_name", live: "merchants" },
  investor: { table: "investors",         nameCol: "investor_name", live: "investors" },
};

/**
 * Scan raw rows for lookup fields; create any missing entity automatically
 * (agents, issuing_companies, merchants, investors), then return updated lookups.
 *
 * Returns the count of newly-created entities per kind so the UI can report it.
 */
export async function autoCreateMissingLookups(
  spec: ImportSpec,
  rawRows: Record<string, any>[],
  mapping: Record<string, string | null>,
  lookups: Lookups,
): Promise<{ lookups: Lookups; created: Record<string, number> }> {
  const created: Record<string, number> = {};
  // Collect missing names per kind
  const missing: Record<LookupKind, Map<string, string>> = {
    agent: new Map(), company: new Map(), merchant: new Map(), investor: new Map(),
  };

  for (const f of spec.fields) {
    if (f.type !== "lookup" || !f.lookup) continue;
    const header = mapping[f.key];
    if (!header) continue;
    const map = lookups[f.lookup];
    for (const r of rawRows) {
      const raw = r[header];
      if (raw === null || raw === undefined || String(raw).trim() === "") continue;
      const key = norm(raw);
      if (!map.has(key) && !missing[f.lookup].has(key)) {
        missing[f.lookup].set(key, String(raw).trim());
      }
    }
  }

  // Create missing rows
  for (const kind of Object.keys(missing) as LookupKind[]) {
    const m = missing[kind];
    if (!m.size) continue;
    const cfg = TABLE[kind];
    const rowsToInsert = Array.from(m.values()).map((displayName) => ({ [cfg.nameCol]: displayName }));
    const { data, error } = await (supabase.from(cfg.table as any) as any).insert(rowsToInsert).select("*");
    if (error) {
      // fallback: one by one
      let count = 0;
      for (const name of m.values()) {
        const { data: d2 } = await (supabase.from(cfg.table as any) as any)
          .insert({ [cfg.nameCol]: name }).select("*").single();
        if (d2) {
          lookups[kind].set(norm((d2 as any)[cfg.nameCol]), (d2 as any).id);
          patchLive(cfg.live, { type: "insert", row: d2 });
          count++;
        }
      }
      if (count) created[kind] = count;
      continue;
    }
    if (Array.isArray(data)) {
      for (const row of data) {
        lookups[kind].set(norm((row as any)[cfg.nameCol]), (row as any).id);
        patchLive(cfg.live, { type: "insert", row });
      }
      created[kind] = data.length;
    }
  }

  return { lookups, created };
}
