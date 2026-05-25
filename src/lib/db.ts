import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export type Agent = {
  id: string;
  name: string;
  national_id: string | null;
  phone: string | null;
  whatsapp: string | null;
  governorate: string | null;
  status: string;
  created_at: string;
};

export const GOVERNORATES = [
  "القاهرة","الجيزة","الإسكندرية","الدقهلية","الشرقية","القليوبية","المنوفية","الغربية","كفر الشيخ","البحيرة","دمياط","بورسعيد","الإسماعيلية","السويس","شمال سيناء","جنوب سيناء","الفيوم","بني سويف","المنيا","أسيوط","سوهاج","قنا","الأقصر","أسوان","البحر الأحمر","الوادي الجديد","مطروح",
] as const;

export type Flight = {
  id: string;
  passenger_name: string;
  national_id: string | null;
  passport: string | null;
  dob: string | null;
  airline: string | null;
  destination: string | null;
  authority: string | null;
  travel_date: string | null;
  travel_statement: string | null;
  issuing_company: string | null;
  agent_id: string | null;
  status: string;
  notes: string | null;
  count: number;
  price: number;
  company_value: number;
  created_at: string;
};

export type Approval = {
  id: string;
  passenger_name: string;
  national_id: string | null;
  passport: string | null;
  dob: string | null;
  destination: string | null;
  authority: string | null;
  issuing_company: string | null;
  issuing_company_id: string | null;
  travel_statement: string | null;
  travel_date: string | null;
  airline: string | null;
  agent_id: string | null;
  submit_date: string | null;
  issue_date: string | null;
  status: string;
  government_fee: number;
  notes: string | null;
  service_type: string | null;
  count: number;
  price: number;
  company_value: number;
  created_at: string;
};

export type Transaction = {
  id: string;
  agent_id: string;
  date: string;
  destination: string | null;
  travel_statement: string | null;
  count: number;
  price: number;
  paid: number;
  payment_method: string | null;
  instapay_amount: number;
  cash_amount: number;
  mobile_cash_amount: number;
  mobile_cash_net_amount: number;
  arabic_tourism_cash_amount: number;
  arabic_tourism_cash_net_amount: number;
  merchant_cash_amount: number;
  merchant_cash_net_amount: number;
  merchant_cash_physical_amount: number;
  service_type: string | null;
  total_paid: number;
  note: string | null;
  merchant_id: string | null;
  source_service_id?: string | null;
  source_service_type?: string | null;
  created_at: string;
};

export const merchantCashGross = (t: Partial<Transaction> & Partial<CompanyTransaction>) =>
  Number(t.merchant_cash_amount || 0);
export const merchantCashNet = (t: Partial<Transaction> & Partial<CompanyTransaction>) => {
  const stored = Number(t.merchant_cash_net_amount || 0);
  if (stored > 0) return Math.round(stored);
  const gross = Number(t.merchant_cash_amount || 0);
  return Math.round(gross - gross * 0.01);
};
export const merchantCashPhysical = (t: Partial<Transaction> & Partial<CompanyTransaction>) =>
  Math.round(Number(t.merchant_cash_physical_amount || 0));

export const txnTotalPaid = (t: Partial<Transaction>) => {
  const computed =
    Number(t.instapay_amount || 0) +
    Number(t.cash_amount || 0) +
    merchantCashNet(t) +
    Number(t.merchant_cash_physical_amount || 0);
  if (computed > 0) return Math.round(computed);
  if (Number(t.total_paid || 0) > 0) return Math.round(Number(t.total_paid || 0));
  return Math.round(Number(t.paid || 0));
};

export const merchantCashNetAmount = (amount: number) => Math.round(amount - amount * 0.01);

// Fallback constants (kept for backwards-compat). Active values come from system_dropdown_options.
export const DESTINATIONS = ["بنغازي", "مصراته", "طرابلس"] as const;
export const AUTHORITIES = ["مطار برج العرب", "مطار القاهرة", "جمرك بري"] as const;
export const AIRLINES = ["برنيق", "بنغازي", "البرج"] as const;
export const SERVICE_TYPES = ["تذاكر طيران", "موافقة أمنية", "استثمار عسكري"] as const;

export type DropdownCategory =
  | "authority" | "destination" | "airline" | "service_type"
  | "execution_status" | "submission_status" | "departure_from" | "service_kind"
  | "submission_notes" | "airport";

export const VALID_DROPDOWN_CATEGORIES: DropdownCategory[] = [
  "authority", "destination", "airline", "service_type",
  "execution_status", "submission_status", "departure_from", "service_kind",
  "submission_notes", "airport",
];

const DROPDOWN_FALLBACKS: Record<DropdownCategory, readonly string[]> = {
  authority: AUTHORITIES,
  destination: ["بنغازي", "طرابلس", "مصراته", "سبها"],
  airline: ["العراق", "البرنيق", "الليبية", "إير كايرو", "تاج", "مصر للطيران", "الإفريقية"],
  service_type: SERVICE_TYPES,
  execution_status: ["بطيء", "سريع", "رفض أمني"],
  submission_status: ["بطيء", "سريع", "رفض أمني"],
  departure_from: ["برج العرب", "القاهرة"],
  service_kind: [
    "موافقة أمنية","تذكرة","استثمار","استثمار بري","تذكرة واستثمار",
    "بنغازي شغل كامل","طرابلس شغل كامل","مصراته شغل كامل","سبها شغل كامل","بري شغل كامل",
    "نقل بري (طبرق واجدابيا)","نقل طرابلس","نقل مصراته","نقل ........",
    "موافقة واستثمار بري","تأشيرة طرابلس","مصراته تنسيق","خدمات أخرى","نقل عن طريق سبها",
  ],
  submission_notes: ["سيدات", "رضيع", "طفل تحت 8", "طفل تحت 12"],
  airport: ["برج العرب", "القاهرة"],
};

function fallbackDropdownOptions(category: DropdownCategory): string[] {
  return [...(DROPDOWN_FALLBACKS[category] ?? [])];
}

export function normalizeDropdownValue(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function sanitizeDropdownOptions(rows: unknown, category: DropdownCategory): string[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const row of rows as { value?: unknown; category?: unknown; is_active?: unknown }[]) {
    const value = normalizeDropdownValue(row?.value);
    if (!value || row?.category !== category || row?.is_active !== true || seen.has(value)) continue;
    seen.add(value);
    options.push(value);
  }
  return options;
}

export function useDropdownOptions(category: DropdownCategory) {
  const [values, setValues] = useState<string[]>(() => fallbackDropdownOptions(category));
  const safeCategory = VALID_DROPDOWN_CATEGORIES.includes(category) ? category : "authority";
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("system_dropdown_options")
          .select("category,value,is_active")
          .eq("category", safeCategory)
          .eq("is_active", true)
          .order("value", { ascending: true });
        if (error) {
          if (mounted) setValues(fallbackDropdownOptions(safeCategory));
          toast.error("تعذر تحميل القوائم، تم استخدام القيم الافتراضية");
          return;
        }
        const next = sanitizeDropdownOptions(data, safeCategory);
        if (mounted) setValues(next.length ? next : fallbackDropdownOptions(safeCategory));
      } catch (error: any) {
        if (mounted) setValues(fallbackDropdownOptions(safeCategory));
        toast.error(error?.message || "تعذر تحميل القوائم، تم استخدام القيم الافتراضية");
      }
    };
    load();
    const channelName = `live-dropdown-${safeCategory}-${Math.random().toString(36).slice(2)}`;
    const ch = supabase.channel(channelName);
    ch.on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "system_dropdown_options", filter: `category=eq.${safeCategory}` },
      () => load(),
    ).subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [safeCategory]);
  return useMemo(() => sanitizeDropdownOptions(values.map((value) => ({ category: safeCategory, value, is_active: true })), safeCategory), [values, safeCategory]);
}

/** Merge the current saved value into the option list so editing legacy records still shows it. */
export function withSelected(options: readonly string[] | null | undefined, selected?: string | null): string[] {
  const seen = new Set<string>();
  const safeOptions = Array.isArray(options)
    ? options.map(normalizeDropdownValue).filter((v) => {
      if (!v || seen.has(v)) return false;
      seen.add(v);
      return true;
    })
    : [];
  const current = normalizeDropdownValue(selected);
  if (!current) return safeOptions;
  return seen.has(current) ? safeOptions : [current, ...safeOptions];
}

export const buildTravelStatement = (
  destination?: string | null,
  travelDate?: string | null,
  airline?: string | null,
) => {
  const parts = [destination, travelDate, airline].filter((p) => p && String(p).trim());
  return parts.length ? parts.join(" - ") : "";
};

export type AgentServicePricing = {
  id: string;
  agent_id: string;
  service_type: string;
  company_price: number;
  agent_price: number;
  company_percentage: number;
  company_profit_value: number;
  created_at: string;
  updated_at: string;
};

export const PRICING_SERVICE_TYPES = ["تذاكر طيران", "موافقة أمنية", "استثمار ليبي"] as const;
export type PricingServiceType = typeof PRICING_SERVICE_TYPES[number];

/** Fetch all pricing rows for an agent, keyed by service_type. */
export function useAgentPricingMap(agentId: string | null | undefined) {
  const [map, setMap] = useState<Record<string, AgentServicePricing>>({});
  useEffect(() => {
    if (!agentId) { setMap({}); return; }
    let mounted = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("agent_service_pricing")
        .select("*")
        .eq("agent_id", agentId);
      if (!mounted) return;
      if (error) { setMap({}); return; }
      const out: Record<string, AgentServicePricing> = {};
      for (const r of (data || []) as AgentServicePricing[]) out[r.service_type] = r;
      setMap(out);
    };
    load();
    const ch = supabase
      .channel(`agent-pricing-${agentId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "agent_service_pricing", filter: `agent_id=eq.${agentId}` }, () => load())
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [agentId]);
  return map;
}

export type IssuingCompany = {
  id: string;
  company_name: string;
  phone: string | null;
  whatsapp: string | null;
  service_type: string | null;
  status: string;
  created_at: string;
};

export type CompanyTransaction = {
  id: string;
  company_id: string;
  date: string;
  destination: string | null;
  count: number;
  price: number;
  trip_value: number;
  instapay_amount: number;
  cash_amount: number;
  mobile_cash_amount: number;
  mobile_cash_net_amount: number;
  arabic_tourism_cash_amount: number;
  arabic_tourism_cash_net_amount: number;
  merchant_cash_amount: number;
  merchant_cash_net_amount: number;
  merchant_cash_physical_amount: number;
  service_type: string | null;
  total_paid: number;
  note: string | null;
  merchant_id: string | null;
  source_service_id?: string | null;
  source_service_type?: string | null;
  usd_amount?: number;
  exchange_rate_used?: number | null;
  payment_currency?: string | null;
  created_at: string;
};

export type Merchant = {
  id: string;
  merchant_name: string;
  phone: string | null;
  whatsapp: string | null;
  status: string;
  supports_instapay: boolean;
  supports_cash_wallet: boolean;
  supports_physical_cash: boolean;
  created_at: string;
};

export type MerchantCashCollection = {
  id: string;
  merchant_id: string;
  date: string;
  amount: number;
  note: string | null;
  created_at: string;
};

export type Investor = {
  id: string;
  investor_name: string;
  phone: string | null;
  whatsapp: string | null;
  created_at: string;
};

export type InvestorTransaction = {
  id: string;
  investor_id: string;
  transaction_type: string;
  date: string;
  amount: number;
  payment_method: string | null;
  note: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  expense_name: string;
  expense_type: string;
  amount: number;
  date: string;
  payment_method: string;
  notes: string | null;
  auto_deduct_enabled: boolean;
  auto_deduct_day: number | null;
  funding_source: string | null;
  merchant_id: string | null;
  currency: string;
  usd_amount: number;
  exchange_rate: number | null;
  created_at: string;
};

export type ExpenseDeduction = {
  id: string;
  expense_id: string;
  deduction_date: string;
  amount: number;
  status: string;
  funding_source: string | null;
  merchant_id: string | null;
  currency: string;
  usd_amount: number;
  exchange_rate: number | null;
  created_at: string;
};

export type UsdTreasuryTransaction = {
  id: string;
  date: string;
  type: string; // 'conversion' | 'company_payment' | 'adjustment'
  egp_amount: number;
  usd_amount: number;
  exchange_rate: number | null;
  company_id: string | null;
  note: string | null;
  source_type: string | null; // 'insta_company' | 'cash_company' | 'merchant_wallet' | 'merchant_physical'
  merchant_id: string | null;
  created_at: string;
};

export type ExecutionServiceItem = {
  service_type: string;
  company_id?: string | null;
  count?: number;
  agent_price?: number;
  company_price?: number;
  company_value?: number;
  // Payment linkage (optional). When provided, postExecutionFinancials
  // writes paid_amount into the matching bucket on the agent transaction row.
  payment_method?: string | null;     // 'نقدي' | 'إنستاباي' | 'محفظة' | 'تاجر إنستاباي' | 'تاجر محفظة' | 'تاجر نقدي'
  paid_amount?: number;
  merchant_id?: string | null;
};

export type Submission = {
  id: string;
  services: string[];
  passenger_name: string;
  national_id: string | null;
  dob: string | null;
  passport: string | null;
  birth_place: string | null;
  agent_id: string | null;
  status: string;
  departure_from: string | null;
  submit_date: string | null;
  issue_date: string | null;
  approval_authority: string | null;
  notes: string | null;
  executed_at: string | null;
  execution_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Execution = {
  id: string;
  submission_id: string | null;
  passenger_name: string;
  national_id: string | null;
  dob: string | null;
  passport: string | null;
  birth_place: string | null;
  agent_id: string | null;
  status: string;
  departure_from: string | null;
  destination: string | null;
  airline: string | null;
  travel_date: string | null;
  notes: string | null;
  services: ExecutionServiceItem[];
  created_at: string;
  updated_at: string;
};

type LiveTable =
  | "agents" | "flights" | "approvals" | "transactions" | "issuing_companies"
  | "company_transactions" | "merchants" | "merchant_cash_collections"
  | "investors" | "investor_transactions" | "expenses" | "expense_deductions"
  | "usd_treasury_transactions" | "submissions" | "executions";

type LiveStore = {
  rows: any[];
  loading: boolean;
  error: string | null;
  subscribers: Set<() => void>;
  refCount: number;
  channel: any;
  loaded: boolean;
};

// Module-level shared cache: one fetch + one realtime channel per table,
// shared across every component instance. Realtime payloads are applied
// in-memory (no refetch), so updates are O(1) and propagate to all
// subscribers instantly.
const liveStores: Map<LiveTable, LiveStore> = new Map();

function getStore(table: LiveTable): LiveStore {
  let s = liveStores.get(table);
  if (!s) {
    s = { rows: [], loading: true, error: null, subscribers: new Set(), refCount: 0, channel: null, loaded: false };
    liveStores.set(table, s);
  }
  return s;
}

function notify(store: LiveStore) {
  store.subscribers.forEach((fn) => fn());
}

async function loadStore(table: LiveTable, store: LiveStore) {
  try {
    const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false });
    if (error) {
      store.rows = [];
      store.error = error.message;
      toast.error(error.message || "تعذر تحميل البيانات");
    } else {
      store.rows = Array.isArray(data) ? data : [];
      store.error = null;
    }
  } catch (err: any) {
    store.rows = [];
    store.error = err?.message || "تعذر تحميل البيانات";
    toast.error(store.error!);
  } finally {
    store.loading = false;
    store.loaded = true;
    notify(store);
  }
}

function applyChange(store: LiveStore, payload: any) {
  const { eventType, new: newRow, old: oldRow } = payload;
  if (eventType === "INSERT" && newRow) {
    if (!store.rows.some((r) => r.id === newRow.id)) {
      store.rows = [newRow, ...store.rows];
    }
  } else if (eventType === "UPDATE" && newRow) {
    store.rows = store.rows.map((r) => (r.id === newRow.id ? { ...r, ...newRow } : r));
  } else if (eventType === "DELETE" && oldRow) {
    store.rows = store.rows.filter((r) => r.id !== oldRow.id);
  }
  notify(store);
}

function subscribe(table: LiveTable, cb: () => void): () => void {
  const store = getStore(table);
  store.subscribers.add(cb);
  store.refCount += 1;
  if (store.refCount === 1) {
    loadStore(table, store);
    const channel = supabase
      .channel(`live-${table}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table }, (payload: any) => applyChange(store, payload))
      .subscribe();
    store.channel = channel;
  }
  return () => {
    store.subscribers.delete(cb);
    store.refCount -= 1;
    if (store.refCount === 0 && store.channel) {
      supabase.removeChannel(store.channel);
      store.channel = null;
      store.loaded = false;
      store.loading = true;
    }
  };
}

export function useLive<T>(table: LiveTable) {
  const [, force] = useState(0);
  useEffect(() => subscribe(table, () => force((n) => n + 1)), [table]);
  const store = getStore(table);
  return { rows: store.rows as T[], loading: store.loading, error: store.error };
}

/** Optimistic helper: mutate the local cache for a table immediately. */
export function patchLive(table: LiveTable, change: { type: "insert" | "update" | "delete"; row: any }) {
  const store = liveStores.get(table);
  if (!store) return;
  if (change.type === "insert") applyChange(store, { eventType: "INSERT", new: change.row });
  else if (change.type === "update") applyChange(store, { eventType: "UPDATE", new: change.row });
  else applyChange(store, { eventType: "DELETE", old: change.row });
}

/** Read a row snapshot from the live cache (for optimistic rollback). */
export function getLiveRow(table: LiveTable, id: string): any | undefined {
  const store = liveStores.get(table);
  return store?.rows.find((r) => r.id === id);
}

/**
 * Run a server mutation with optimistic local-state updates + auto rollback.
 * - update: patches the cached row immediately, rolls back to snapshot on error.
 * - delete: removes the row immediately, restores snapshot on error.
 * - insert: adds an optimistic row with a temp id, removes it on completion
 *   (Realtime delivers the real row, deduped by server id).
 */
export async function applyOptimistic<T = any>(opts: {
  table: LiveTable;
  type: "update" | "delete" | "insert";
  id: string;
  patch?: Record<string, any>;
  run: () => Promise<any>;
  errorMessage?: string;
}): Promise<{ ok: boolean; data?: T; error?: string }> {
  const { table, type, id, patch, run, errorMessage } = opts;
  const snapshot = getLiveRow(table, id);

  if (type === "update" && snapshot) {
    patchLive(table, { type: "update", row: { ...snapshot, ...patch, id } });
  } else if (type === "delete" && snapshot) {
    patchLive(table, { type: "delete", row: { id } });
  } else if (type === "insert") {
    patchLive(table, { type: "insert", row: { id, ...(patch || {}) } });
  }

  try {
    const result: any = await run();
    if (result?.error) throw new Error(result.error.message || "تعذر إتمام العملية");
    if (type === "insert") {
      patchLive(table, { type: "delete", row: { id } });
    }
    return { ok: true, data: result?.data ?? result };
  } catch (e: any) {
    if (type === "update" && snapshot) {
      patchLive(table, { type: "update", row: snapshot });
    } else if (type === "delete" && snapshot) {
      patchLive(table, { type: "insert", row: snapshot });
    } else if (type === "insert") {
      patchLive(table, { type: "delete", row: { id } });
    }
    const msg = e?.message || errorMessage || "تعذر إتمام العملية";
    toast.error(msg);
    return { ok: false, error: msg };
  }
}

export const fmtNum = (n: number) =>
  new Intl.NumberFormat("ar-LY", { maximumFractionDigits: 0 }).format(n || 0);

export const CURRENCY = "EGP";
export const CURRENCY_LABEL = "ج.م";
export const CURRENCY_NAME = "جنيه مصري";
export const fmtDL = (n: number) => `${fmtNum(n)} ${CURRENCY_LABEL}`;
export const fmtMoney = fmtDL;
export const fmtUSD = (n: number) =>
  `${new Intl.NumberFormat("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)} $`;

export const tripValue = (t: Pick<Transaction, "count" | "price">) =>
  Number(t.count || 0) * Number(t.price || 0);

/** Compute live EGP and USD treasury balances by aggregating across all relevant tables. */
export function useTreasuryBalances() {
  const { rows: agentTxns } = useLive<Transaction>("transactions");
  const { rows: companyTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: investorTxns } = useLive<InvestorTransaction>("investor_transactions");
  const { rows: deductions } = useLive<ExpenseDeduction>("expense_deductions");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");

  return useMemo(() => {
    const egpIn = agentTxns.reduce(
      (s, t) =>
        s +
        Number(t.instapay_amount || 0) +
        Number(t.cash_amount || 0) +
        merchantCashNet(t) +
        Number(t.merchant_cash_physical_amount || 0),
      0,
    );
    const investorIn = investorTxns
      .filter((t) => t.transaction_type === "توريد نقدية")
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const investorOut = investorTxns
      .filter((t) => t.transaction_type === "صرف نقدية")
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const companyOut = companyTxns.reduce((s, t) => s + Number(t.total_paid || 0), 0);
    const expensesOut = deductions.reduce((s, d) => s + Number(d.amount || 0), 0);
    const usdConversionsEgp = usdRows
      .filter((r) => r.type === "conversion")
      .reduce((s, r) => s + Number(r.egp_amount || 0), 0);

    const egp = Math.round(egpIn + investorIn - investorOut - companyOut - expensesOut - usdConversionsEgp);

    const usd = usdRows.reduce((s, r) => {
      const amt = Number(r.usd_amount || 0);
      return r.type === "company_payment" ? s - amt : s + amt;
    }, 0);

    return { egp, usd: Math.round(usd * 100) / 100 };
  }, [agentTxns, companyTxns, investorTxns, deductions, usdRows]);
}

export const badgeFor = (status: string) => {
  switch (status) {
    case "سافر":
    case "موافق":
    case "نشط":
    case "سريعة":
      return "badge-green";
    case "محجوز":
    case "معلق":
    case "بطيئة":
      return "badge-orange";
    case "ملغي":
    case "مرفوض":
    case "غير نشط":
    case "رفض أمني":
      return "badge-red";
    case "لم يسافر":
      return "badge-gold";
    default:
      return "badge-blue";
  }
};
