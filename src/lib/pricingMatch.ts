import { supabase } from "@/integrations/supabase/client";

export type PricingRule = {
  id: string;
  company_id: string;
  service_type: string;
  agent_tier: string;
  departure_from: string | null;
  destination: string | null;
  airline: string | null;
  approval_company_id: string | null;
  status: string | null;
  passenger_type: string | null;
  company_price: number;
  commission_type: "percentage" | "fixed";
  commission_value: number;
  agent_price: number;
};

export type ResolveContext = {
  company_id: string;
  service_type: string;
  agent_tier: string;
  departure_from?: string | null;
  destination?: string | null;
  airline?: string | null;
  approval_company_id?: string | null;
  status?: string | null;
  passenger_type?: string | null;
};

const OPTIONAL_FIELDS: (keyof ResolveContext)[] = [
  "departure_from", "destination", "airline",
  "approval_company_id", "status", "passenger_type",
];

/** Score: count of non-null rule-fields that match. Mismatch on a non-null rule-field disqualifies. */
function scoreRule(rule: PricingRule, ctx: ResolveContext): number | null {
  let score = 0;
  for (const f of OPTIONAL_FIELDS) {
    const rv = (rule as any)[f];
    if (rv == null || rv === "") continue;
    const cv = ctx[f];
    if (cv == null || cv === "") return null;
    if (String(rv) !== String(cv)) return null;
    score++;
  }
  return score;
}

/** Resolve the most specific matching pricing rule for the given context. */
export async function resolveAgentPrice(ctx: ResolveContext): Promise<{
  rule: PricingRule | null;
  agentPrice: number | null;
  reason?: string;
}> {
  if (!ctx.company_id || !ctx.service_type || !ctx.agent_tier) {
    return { rule: null, agentPrice: null, reason: "بيانات ناقصة (الشركة/الخدمة/شريحة الوكيل)" };
  }
  const { data, error } = await supabase
    .from("company_pricing_rules" as any)
    .select("*")
    .eq("company_id", ctx.company_id)
    .eq("service_type", ctx.service_type)
    .eq("agent_tier", ctx.agent_tier);
  if (error) return { rule: null, agentPrice: null, reason: error.message };

  const rules = (data || []) as unknown as PricingRule[];
  let best: { rule: PricingRule; score: number } | null = null;
  for (const r of rules) {
    const s = scoreRule(r, ctx);
    if (s == null) continue;
    if (!best || s > best.score) best = { rule: r, score: s };
  }
  if (!best) return { rule: null, agentPrice: null, reason: "لا يوجد سعر مطابق في ملف تسعير الشركة" };
  return { rule: best.rule, agentPrice: Number(best.rule.agent_price) || 0 };
}
