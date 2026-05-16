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

export type DropdownCategory = "authority" | "destination" | "airline" | "service_type";

export const VALID_DROPDOWN_CATEGORIES: DropdownCategory[] = ["authority", "destination", "airline", "service_type"];

const DROPDOWN_FALLBACKS: Record<DropdownCategory, readonly string[]> = {
  authority: AUTHORITIES,
  destination: DESTINATIONS,
  airline: AIRLINES,
  service_type: SERVICE_TYPES,
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
  created_at: string;
};

export type ExpenseDeduction = {
  id: string;
  expense_id: string;
  deduction_date: string;
  amount: number;
  status: string;
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
  created_at: string;
};

export function useLive<T>(table: "agents" | "flights" | "approvals" | "transactions" | "issuing_companies" | "company_transactions" | "merchants" | "merchant_cash_collections" | "investors" | "investor_transactions" | "expenses" | "expense_deductions" | "usd_treasury_transactions") {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const { data, error: queryError } = await supabase.from(table).select("*").order("created_at", { ascending: false });
        if (!mounted) return;
        if (queryError) {
          setRows([]);
          setError(queryError.message);
          toast.error(queryError.message || "تعذر تحميل البيانات");
          return;
        }
        setRows(Array.isArray(data) ? (data as T[]) : []);
        setError(null);
      } catch (err: any) {
        if (!mounted) return;
        setRows([]);
        setError(err?.message || "تعذر تحميل البيانات");
        toast.error(err?.message || "تعذر تحميل البيانات");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    const channelName = `live-${table}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => load())
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [table]);

  return { rows, loading, error };
}

export const fmtNum = (n: number) =>
  new Intl.NumberFormat("ar-LY", { maximumFractionDigits: 0 }).format(n || 0);

export const CURRENCY = "EGP";
export const CURRENCY_LABEL = "ج.م";
export const CURRENCY_NAME = "جنيه مصري";
export const fmtDL = (n: number) => `${fmtNum(n)} ${CURRENCY_LABEL}`;
export const fmtMoney = fmtDL;

export const tripValue = (t: Pick<Transaction, "count" | "price">) =>
  Number(t.count || 0) * Number(t.price || 0);

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
