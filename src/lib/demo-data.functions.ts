import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Response("Forbidden", { status: 403 });
}

const DEMO_TABLES = [
  "agents",
  "issuing_companies",
  "merchants",
  "investors",
  "flights",
  "approvals",
  "transactions",
  "company_transactions",
  "merchant_cash_collections",
  "investor_transactions",
  "expenses",
  "expense_deductions",
] as const;

type DemoTable = (typeof DEMO_TABLES)[number];

export const checkDemoData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const counts: Record<string, number> = {};
    let total = 0;
    for (const t of DEMO_TABLES) {
      const { count } = await sb
        .from(t)
        .select("*", { count: "exact", head: true })
        .eq("is_demo", true);
      counts[t] = count ?? 0;
      total += count ?? 0;
    }
    return { counts, total };
  });

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const FIRST_NAMES = ["أحمد", "محمد", "علي", "حسن", "محمود", "خالد", "إبراهيم", "يوسف", "كريم", "عمر", "مصطفى", "طارق", "سامي", "هاني", "وائل", "أيمن"];
const LAST_NAMES = ["السيد", "عبد الله", "حسين", "النجار", "البحيري", "الشافعي", "المصري", "الجندي", "السعيد", "الزهري", "الخطيب", "العزب"];
const GOVS = ["القاهرة", "الإسكندرية", "الجيزة", "الدقهلية", "الشرقية", "البحيرة", "المنوفية", "أسيوط", "سوهاج"];
const DESTINATIONS = ["السعودية", "الإمارات", "الكويت", "قطر", "تركيا", "الأردن", "ماليزيا"];
const AIRLINES = ["مصر للطيران", "الخطوط السعودية", "طيران الإمارات", "الخطوط القطرية", "الخطوط التركية", "العربية للطيران"];
const AUTHORITIES = ["جوازات", "هجرة", "خارجية"];
const COMPANY_NAMES = ["النيل للسياحة", "الأهرام تورز", "الفيصل ترافيل", "البركة للحج والعمرة", "الشموخ تورز"];
const MERCHANT_NAMES = ["محمد فودافون كاش", "أحمد إنستاباي", "كريم محفظة", "هاني للتحويلات"];
const INVESTOR_NAMES = ["المهندس وليد", "الحاج سعيد", "د. ياسر"];
const EXPENSE_NAMES = ["إيجار المكتب", "كهرباء", "إنترنت", "رواتب", "صيانة", "مواصلات", "ضيافة", "طباعة"];

function fullName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}
function phone() {
  return `01${pick([0, 1, 2, 5])}${rand(10000000, 99999999)}`;
}
function passport() {
  return `A${rand(10000000, 99999999)}`;
}
function nationalId() {
  return `${rand(2, 3)}${rand(80, 99)}${String(rand(1, 12)).padStart(2, "0")}${String(rand(1, 28)).padStart(2, "0")}${rand(10000, 99999)}`;
}

export const generateDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const summary: Record<string, number> = {};

    // Agents
    const agents = Array.from({ length: 6 }, () => ({
      name: fullName(),
      governorate: pick(GOVS),
      whatsapp: phone(),
      phone: phone(),
      national_id: nationalId(),
      status: "نشط",
      is_demo: true,
    }));
    const { data: agentRows } = await sb.from("agents").insert(agents).select("id");
    summary.agents = agentRows?.length ?? 0;
    const agentIds = (agentRows ?? []).map((r: any) => r.id);

    // Issuing companies
    const companies = COMPANY_NAMES.slice(0, 4).map((n) => ({
      company_name: n,
      service_type: pick(["تأشيرات", "موافقات أمنية", "تذاكر طيران"]),
      phone: phone(),
      whatsapp: phone(),
      status: "نشط",
      is_demo: true,
    }));
    const { data: companyRows } = await sb.from("issuing_companies").insert(companies).select("id, company_name");
    summary.issuing_companies = companyRows?.length ?? 0;
    const companyIds = (companyRows ?? []).map((r: any) => r.id);

    // Merchants
    const merchants = MERCHANT_NAMES.map((n) => ({
      merchant_name: n,
      phone: phone(),
      whatsapp: phone(),
      supports_cash_wallet: true,
      supports_physical_cash: true,
      supports_instapay: true,
      status: "نشط",
      is_demo: true,
    }));
    const { data: merchantRows } = await sb.from("merchants").insert(merchants).select("id");
    summary.merchants = merchantRows?.length ?? 0;
    const merchantIds = (merchantRows ?? []).map((r: any) => r.id);

    // Investors
    const investors = INVESTOR_NAMES.map((n) => ({
      investor_name: n,
      phone: phone(),
      whatsapp: phone(),
      is_demo: true,
    }));
    const { data: investorRows } = await sb.from("investors").insert(investors).select("id");
    summary.investors = investorRows?.length ?? 0;
    const investorIds = (investorRows ?? []).map((r: any) => r.id);

    // Flights
    const flights = Array.from({ length: 25 }, () => ({
      passenger_name: fullName(),
      passport: passport(),
      national_id: nationalId(),
      dob: daysAgo(rand(7000, 18000)),
      airline: pick(AIRLINES),
      destination: pick(DESTINATIONS),
      travel_date: daysAgo(rand(-30, 60)),
      agent_id: pick(agentIds),
      status: pick(["محجوز", "مصدر", "ملغي"]),
      issuing_company: pick(COMPANY_NAMES),
      authority: pick(AUTHORITIES),
      travel_statement: pick(["سياحة", "عمل", "زيارة"]),
      notes: "بيانات تجريبية",
      is_demo: true,
    }));
    const { data: flightRows } = await sb.from("flights").insert(flights).select("id");
    summary.flights = flightRows?.length ?? 0;

    // Approvals
    const approvals = Array.from({ length: 20 }, () => ({
      passenger_name: fullName(),
      passport: passport(),
      national_id: nationalId(),
      dob: daysAgo(rand(7000, 18000)),
      destination: pick(DESTINATIONS),
      agent_id: pick(agentIds),
      submit_date: daysAgo(rand(0, 60)),
      issue_date: Math.random() > 0.4 ? daysAgo(rand(0, 30)) : null,
      status: pick(["سريعة", "عادية", "مستعجلة"]),
      government_fee: rand(500, 2500),
      authority: pick(AUTHORITIES),
      airline: pick(AIRLINES),
      travel_date: daysAgo(rand(-30, 30)),
      issuing_company: pick(COMPANY_NAMES),
      issuing_company_id: pick(companyIds),
      travel_statement: pick(["سياحة", "عمل", "زيارة"]),
      notes: "بيانات تجريبية",
      is_demo: true,
    }));
    const { data: approvalRows } = await sb.from("approvals").insert(approvals).select("id");
    summary.approvals = approvalRows?.length ?? 0;

    // Transactions (sales/payments)
    const transactions = Array.from({ length: 30 }, () => {
      const count = rand(1, 4);
      const price = rand(1500, 8000);
      const total = count * price;
      const cash = Math.random() > 0.5 ? Math.floor(total * 0.6) : 0;
      const instapay = total - cash;
      return {
        agent_id: pick(agentIds),
        date: daysAgo(rand(0, 60)),
        destination: pick(DESTINATIONS),
        count,
        price,
        payment_method: pick(["نقدي", "إنستاباي", "محفظة"]),
        paid: total,
        total_paid: total,
        cash_amount: cash,
        instapay_amount: instapay,
        merchant_id: Math.random() > 0.4 ? pick(merchantIds) : null,
        service_type: pick(["تذاكر", "موافقات", "تأشيرات"]),
        travel_statement: pick(["سياحة", "عمل", "زيارة"]),
        note: "بيانات تجريبية",
        is_demo: true,
      };
    });
    const { data: txRows } = await sb.from("transactions").insert(transactions).select("id");
    summary.transactions = txRows?.length ?? 0;

    // Company transactions
    const companyTx = Array.from({ length: 15 }, () => {
      const count = rand(1, 3);
      const price = rand(2000, 6000);
      return {
        company_id: pick(companyIds),
        date: daysAgo(rand(0, 60)),
        destination: pick(DESTINATIONS),
        count,
        price,
        trip_value: count * price,
        total_paid: count * price,
        merchant_id: Math.random() > 0.5 ? pick(merchantIds) : null,
        service_type: pick(["تذاكر", "موافقات"]),
        note: "بيانات تجريبية",
        is_demo: true,
      };
    });
    const { data: ctRows } = await sb.from("company_transactions").insert(companyTx).select("id");
    summary.company_transactions = ctRows?.length ?? 0;

    // Merchant cash collections
    const collections = Array.from({ length: 10 }, () => ({
      merchant_id: pick(merchantIds),
      date: daysAgo(rand(0, 60)),
      amount: rand(500, 5000),
      note: "تحصيل تجريبي",
      is_demo: true,
    }));
    const { data: colRows } = await sb.from("merchant_cash_collections").insert(collections).select("id");
    summary.merchant_cash_collections = colRows?.length ?? 0;

    // Investor transactions
    const invTx = Array.from({ length: 8 }, () => ({
      investor_id: pick(investorIds),
      transaction_type: pick(["إيداع", "سحب"]),
      date: daysAgo(rand(0, 60)),
      amount: rand(5000, 50000),
      payment_method: pick(["نقدي", "تحويل بنكي", "إنستاباي"]),
      note: "حركة تجريبية",
      is_demo: true,
    }));
    const { data: invRows } = await sb.from("investor_transactions").insert(invTx).select("id");
    summary.investor_transactions = invRows?.length ?? 0;

    // Expenses
    const expenses = Array.from({ length: 12 }, () => ({
      date: daysAgo(rand(0, 60)),
      amount: rand(200, 5000),
      expense_type: pick(["متغير", "ثابت"]),
      expense_name: pick(EXPENSE_NAMES),
      payment_method: pick(["نقدي", "إنستاباي", "تحويل بنكي"]),
      notes: "مصروف تجريبي",
      is_demo: true,
    }));
    const { data: expRows } = await sb.from("expenses").insert(expenses).select("id");
    summary.expenses = expRows?.length ?? 0;

    return { summary };
  });

export const deleteDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const summary: Record<string, number> = {};
    // Delete child/dependent tables first to avoid any FK issues
    const order: DemoTable[] = [
      "expense_deductions",
      "expenses",
      "investor_transactions",
      "merchant_cash_collections",
      "company_transactions",
      "transactions",
      "approvals",
      "flights",
      "investors",
      "merchants",
      "issuing_companies",
      "agents",
    ];
    for (const t of order) {
      const { count } = await sb
        .from(t)
        .delete({ count: "exact" })
        .eq("is_demo", true);
      summary[t] = count ?? 0;
    }
    return { summary };
  });
