import { supabase } from "@/integrations/supabase/client";

export type SharedFields = {
  passenger_name: string;
  national_id: string | null;
  passport: string | null;
  dob: string | null;
  destination: string | null;
  agent_id: string | null;
  status: string;
  notes: string | null;
  travel_date?: string | null;
  airline?: string | null;
  authority?: string | null;
  issuing_company?: string | null;
  travel_statement?: string | null;
};

type Table = "flights" | "approvals";

// Columns that exist on each table — used to drop unsupported keys before insert/update.
const FLIGHT_COLS = new Set([
  "passenger_name", "national_id", "passport", "dob", "destination", "agent_id",
  "status", "notes", "travel_date", "airline", "authority", "issuing_company",
  "travel_statement",
]);
const APPROVAL_COLS = new Set([
  "passenger_name", "national_id", "passport", "dob", "destination", "agent_id",
  "status", "notes", "travel_date", "airline", "authority", "issuing_company",
  "travel_statement",
]);

async function findMatch(table: Table, f: SharedFields) {
  const tryFind = async (col: string, val: string) => {
    const { data, error } = await supabase.from(table).select("id").eq(col, val).limit(1);
    if (error) return undefined;
    return data?.[0]?.id as string | undefined;
  };
  if (f.passport) {
    const id = await tryFind("passport", f.passport);
    if (id) return id;
  }
  if (f.national_id) {
    const id = await tryFind("national_id", f.national_id);
    if (id) return id;
  }
  let q = supabase.from(table).select("id").eq("passenger_name", f.passenger_name);
  if (f.agent_id) q = q.eq("agent_id", f.agent_id);
  else q = q.is("agent_id", null);
  const { data, error } = await q.limit(1);
  if (error) return undefined;
  return data?.[0]?.id as string | undefined;
}

function buildPayload(target: Table, fields: SharedFields) {
  const allowed = target === "flights" ? FLIGHT_COLS : APPROVAL_COLS;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

export async function syncCounterpart(source: Table, fields: SharedFields) {
  try {
    const target: Table = source === "flights" ? "approvals" : "flights";
    const payload = buildPayload(target, fields);

    const matchId = await findMatch(target, fields);
    if (matchId) {
      // Skip update if every shared field already matches — prevents loop / no-op writes.
      const { data: current, error } = await supabase
        .from(target)
        .select(Object.keys(payload).join(","))
        .eq("id", matchId)
        .maybeSingle();
      if (!error && current) {
        const cur = current as unknown as Record<string, unknown>;
        const same = Object.entries(payload).every(([k, v]) => cur[k] === v);
        if (same) return;
      }
      await supabase.from(target).update(payload as never).eq("id", matchId);
    } else {
      await supabase.from(target).insert(payload as never);
    }
  } catch (error) {
    console.error("Counterpart sync failed", error);
  }
}
