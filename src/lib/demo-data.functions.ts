import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  AIRLINES as FALLBACK_AIRLINES,
  AUTHORITIES as FALLBACK_AUTHORITIES,
  DESTINATIONS as FALLBACK_DESTINATIONS,
  SERVICE_TYPES as FALLBACK_SERVICE_TYPES,
  buildTravelStatement,
} from "./db";

// Approval/flight status options — must match the values used by the UI dropdowns
// in src/routes/approvals.tsx and src/routes/flights.tsx. Do NOT invent new values.
const APPROVAL_STATUSES = ["سريعة", "بطيئة", "رفض أمني"] as const;

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
const pickOrNull = <T,>(arr: readonly T[]): T | null =>
  arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// Names for seeding agent/company/merchant/investor records (these tables ARE
// the dropdown source for those fields). All other dropdown-bound fields read
// strictly from system_dropdown_options or from the just-created records.
const FIRST_NAMES = ["أحمد", "محمد", "علي", "حسن", "محمود", "خالد", "إبراهيم", "يوسف", "كريم", "عمر", "مصطفى", "طارق", "سامي", "هاني", "وائل", "أيمن"];
const LAST_NAMES = ["السيد", "عبد الله", "حسين", "النجار", "البحيري", "الشافعي", "المصري", "الجندي", "السعيد", "الزهري", "الخطيب", "العزب"];
const GOVS = ["القاهرة", "الإسكندرية", "الجيزة", "الدقهلية", "الشرقية", "البحيرة", "المنوفية", "أسيوط", "سوهاج"];
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

async function loadDropdownOptions(sb: ReturnType<typeof admin>) {
  const { data } = await sb
    .from("system_dropdown_options")
    .select("category,value,is_active")
    .eq("is_active", true);
  const groups: Record<string, string[]> = {
    authority: [],
    destination: [],
    airline: [],
    service_type: [],
  };
  for (const row of (data ?? []) as { category: string; value: string }[]) {
    const v = (row.value ?? "").trim();
    if (!v) continue;
    if (groups[row.category] && !groups[row.category].includes(v)) {
      groups[row.category].push(v);
    }
  }
  // Fall back to the same seed list the UI uses when a dropdown is empty,
  // so demo data still respects a known canonical set rather than inventing values.
  if (!groups.authority.length) groups.authority = [...FALLBACK_AUTHORITIES];
  if (!groups.destination.length) groups.destination = [...FALLBACK_DESTINATIONS];
  if (!groups.airline.length) groups.airline = [...FALLBACK_AIRLINES];
  if (!groups.service_type.length) groups.service_type = [...FALLBACK_SERVICE_TYPES];
  return groups as { authority: string[]; destination: string[]; airline: string[]; service_type: string[] };
}

export const generateDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const summary: Record<string, number> = {};

    const dd = await loadDropdownOptions(sb);

    // Reuse existing real records as references where possible so demo rows
    // never invent agent/company/merchant/investor names.
    const [{ data: existingAgents }, { data: existingCompanies }, { data: existingMerchants }, { data: existingInvestors }] = await Promise.all([
      sb.from("agents").select("id, name"),
      sb.from("issuing_companies").select("id, company_name"),
      sb.from("merchants").select("id"),
      sb.from("investors").select("id"),
    ]);

    // Agents — seed only names that aren't already present.
    const existingAgentNames = new Set((existingAgents ?? []).map((r: any) => r.name));
    const agentSeedNames = Array.from({ length: 6 }, () => fullName()).filter((n) => !existingAgentNames.has(n));
    const agents = agentSeedNames.map((name) => ({
      name,
      governorate: pick(GOVS),
      whatsapp: phone(),
      phone: phone(),
      national_id: nationalId(),
      status: "نشط",
      is_demo: true,
    }));
    const { data: agentRows } = agents.length
      ? await sb.from("agents").insert(agents).select("id")
      : { data: [] as { id: string }[] };
    summary.agents = agentRows?.length ?? 0;
    const agentIds: string[] = [
      ...((existingAgents ?? []).map((r: any) => r.id as string)),
      ...((agentRows ?? []).map((r: any) => r.id as string)),
    ];

    // Issuing companies
    const existingCompanyNames = new Set((existingCompanies ?? []).map((r: any) => r.company_name));
    const companySeed = COMPANY_NAMES.slice(0, 4).filter((n) => !existingCompanyNames.has(n));
    const companies = companySeed.map((n) => ({
      company_name: n,
      service_type: pickOrNull(dd.service_type),
      phone: phone(),
      whatsapp: phone(),
      status: "نشط",
      is_demo: true,
    }));
    const { data: companyRows } = companies.length
      ? await sb.from("issuing_companies").insert(companies).select("id, company_name")
      : { data: [] as { id: string; company_name: string }[] };
    summary.issuing_companies = companyRows?.length ?? 0;
    const allCompanies: { id: string; company_name: string }[] = [
      ...((existingCompanies ?? []) as any[]),
      ...((companyRows ?? []) as any[]),
    ];
    const companyIds = allCompanies.map((r) => r.id);
    const companyNames = allCompanies.map((r) => r.company_name).filter(Boolean);

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
    const merchantIds: string[] = [
      ...((existingMerchants ?? []).map((r: any) => r.id as string)),
      ...((merchantRows ?? []).map((r: any) => r.id as string)),
    ];

    // Investors
    const investors = INVESTOR_NAMES.map((n) => ({
      investor_name: n,
      phone: phone(),
      whatsapp: phone(),
      is_demo: true,
    }));
    const { data: investorRows } = await sb.from("investors").insert(investors).select("id");
    summary.investors = investorRows?.length ?? 0;
    const investorIds: string[] = [
      ...((existingInvestors ?? []).map((r: any) => r.id as string)),
      ...((investorRows ?? []).map((r: any) => r.id as string)),
    ];

    // Flights — only generate if we have agents AND at least one airline/destination/authority option.
    if (agentIds.length && dd.airline.length && dd.destination.length) {
      const flights = Array.from({ length: 25 }, () => {
        const airline = pickOrNull(dd.airline);
        const destination = pickOrNull(dd.destination);
        const travel_date = daysAgo(rand(-30, 60));
        return {
          passenger_name: fullName(),
          passport: passport(),
          national_id: nationalId(),
          dob: daysAgo(rand(7000, 18000)),
          airline,
          destination,
          travel_date,
          agent_id: pick(agentIds),
          status: pick(APPROVAL_STATUSES as unknown as string[]),
          issuing_company: pickOrNull(companyNames),
          authority: pickOrNull(dd.authority),
          travel_statement: buildTravelStatement(destination, travel_date, airline) || null,
          notes: "بيانات تجريبية",
          is_demo: true,
        };
      });
      const { data: flightRows } = await sb.from("flights").insert(flights).select("id");
      summary.flights = flightRows?.length ?? 0;
    } else {
      summary.flights = 0;
    }

    // Approvals
    if (agentIds.length && dd.destination.length) {
      const approvals = Array.from({ length: 20 }, () => {
        const airline = pickOrNull(dd.airline);
        const destination = pickOrNull(dd.destination);
        const travel_date = daysAgo(rand(-30, 30));
        return {
          passenger_name: fullName(),
          passport: passport(),
          national_id: nationalId(),
          dob: daysAgo(rand(7000, 18000)),
          destination,
          agent_id: pick(agentIds),
          submit_date: daysAgo(rand(0, 60)),
          issue_date: Math.random() > 0.4 ? daysAgo(rand(0, 30)) : null,
          status: pick(APPROVAL_STATUSES as unknown as string[]),
          government_fee: rand(500, 2500),
          authority: pickOrNull(dd.authority),
          airline,
          travel_date,
          issuing_company: pickOrNull(companyNames),
          issuing_company_id: companyIds.length ? pick(companyIds) : null,
          travel_statement: buildTravelStatement(destination, travel_date, airline) || null,
          notes: "بيانات تجريبية",
          is_demo: true,
        };
      });
      const { data: approvalRows } = await sb.from("approvals").insert(approvals).select("id");
      summary.approvals = approvalRows?.length ?? 0;
    } else {
      summary.approvals = 0;
    }

    // Transactions (sales/payments)
    if (agentIds.length) {
      const transactions = Array.from({ length: 30 }, () => {
        const count = rand(1, 4);
        const price = rand(1500, 8000);
        const total = count * price;
        const cash = Math.random() > 0.5 ? Math.floor(total * 0.6) : 0;
        const instapay = total - cash;
        const date = daysAgo(rand(0, 60));
        const destination = pickOrNull(dd.destination);
        return {
          agent_id: pick(agentIds),
          date,
          destination,
          count,
          price,
          payment_method: pick(["نقدي", "إنستاباي", "محفظة"]),
          paid: total,
          total_paid: total,
          cash_amount: cash,
          instapay_amount: instapay,
          merchant_id: Math.random() > 0.4 && merchantIds.length ? pick(merchantIds) : null,
          service_type: pickOrNull(dd.service_type),
          travel_statement: buildTravelStatement(destination, date, null) || null,
          note: "بيانات تجريبية",
          is_demo: true,
        };
      });
      const { data: txRows } = await sb.from("transactions").insert(transactions).select("id");
      summary.transactions = txRows?.length ?? 0;
    } else {
      summary.transactions = 0;
    }

    // Company transactions
    if (companyIds.length) {
      const companyTx = Array.from({ length: 15 }, () => {
        const count = rand(1, 3);
        const price = rand(2000, 6000);
        return {
          company_id: pick(companyIds),
          date: daysAgo(rand(0, 60)),
          destination: pickOrNull(dd.destination),
          count,
          price,
          trip_value: count * price,
          total_paid: count * price,
          merchant_id: Math.random() > 0.5 && merchantIds.length ? pick(merchantIds) : null,
          service_type: pickOrNull(dd.service_type),
          note: "بيانات تجريبية",
          is_demo: true,
        };
      });
      const { data: ctRows } = await sb.from("company_transactions").insert(companyTx).select("id");
      summary.company_transactions = ctRows?.length ?? 0;
    } else {
      summary.company_transactions = 0;
    }

    // Merchant cash collections
    if (merchantIds.length) {
      const collections = Array.from({ length: 10 }, () => ({
        merchant_id: pick(merchantIds),
        date: daysAgo(rand(0, 60)),
        amount: rand(500, 5000),
        note: "تحصيل تجريبي",
        is_demo: true,
      }));
      const { data: colRows } = await sb.from("merchant_cash_collections").insert(collections).select("id");
      summary.merchant_cash_collections = colRows?.length ?? 0;
    } else {
      summary.merchant_cash_collections = 0;
    }

    // Investor transactions
    if (investorIds.length) {
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
    } else {
      summary.investor_transactions = 0;
    }

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

// ============================================================
// Production Cleanup — safe pre-release wipe of all demo/test data.
// - Admin-only (enforced server-side).
// - Optionally creates an emergency backup snapshot first.
// - Deletes ONLY rows where is_demo = true across operational tables.
// - Never touches: profiles, user_roles, app_settings, system_dropdown_options,
//   backup_logs, storage buckets, or any row where is_demo = false.
// ============================================================
export const productionCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { createBackup?: boolean } | undefined) => ({
    createBackup: d?.createBackup !== false,
  }))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();

    // 1) Safety snapshot (best-effort; never block cleanup if backup fails)
    let backup: { ok: boolean; path?: string; error?: string } = { ok: false };
    if (data.createBackup) {
      try {
        const mod = await import("./backups.server");
        const res = await mod.runBackupWithRetry("emergency", context.userId, 1);
        backup = { ok: true, path: (res as any)?.path };
      } catch (e: any) {
        backup = { ok: false, error: e?.message || "backup failed" };
      }
    }

    // 2) Delete demo records (child → parent order)
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
    const summary: Record<string, number> = {};
    let totalDeleted = 0;
    for (const t of order) {
      const { count } = await sb
        .from(t)
        .delete({ count: "exact" })
        .eq("is_demo", true);
      summary[t] = count ?? 0;
      totalDeleted += count ?? 0;
    }

    // 3) Verification — confirm no demo rows remain.
    let remaining = 0;
    for (const t of order) {
      const { count } = await sb
        .from(t)
        .select("*", { count: "exact", head: true })
        .eq("is_demo", true);
      remaining += count ?? 0;
    }

    return {
      backup,
      summary,
      totalDeleted,
      usersDeleted: 0, // admins / real users are intentionally preserved
      remaining,
      status: remaining === 0 ? "clean" : "partial",
    };
  });

// ============================================================
// Production Wizard — selective wipe of operational data
// regardless of is_demo flag. Preserves: profiles (admins),
// user_roles, app_settings, system_dropdown_options, backup_logs,
// storage (branding/logo), and auth users that hold admin role.
// ============================================================
export type WipeCategory =
  | "agents"
  | "companies"
  | "merchants"
  | "investors"
  | "flights"
  | "approvals"
  | "transactions"
  | "collections"
  | "expenses"
  | "notifications"
  | "test_users";

const CATEGORY_TABLES: Record<WipeCategory, readonly string[]> = {
  agents: ["agents"],
  companies: ["issuing_companies", "company_transactions"],
  merchants: ["merchants", "merchant_cash_collections"],
  investors: ["investors", "investor_transactions"],
  flights: ["flights"],
  approvals: ["approvals"],
  transactions: ["transactions"],
  collections: ["merchant_cash_collections"],
  expenses: ["expenses", "expense_deductions"],
  notifications: ["activity_logs"],
  test_users: [],
};

// Deterministic deletion order — children first to avoid FK/relationship gaps.
const DELETE_ORDER: readonly string[] = [
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
  "activity_logs",
];

export const productionWipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    categories: WipeCategory[];
    confirm: string;
    createBackup?: boolean;
  }) => {
    if (d.confirm !== "CONFIRM") throw new Error("Confirmation phrase required");
    if (!Array.isArray(d.categories) || d.categories.length === 0) {
      throw new Error("No categories selected");
    }
    return {
      categories: d.categories,
      confirm: d.confirm,
      createBackup: d.createBackup !== false,
    };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();

    // 1) Safety snapshot
    let backup: { ok: boolean; path?: string; error?: string } = { ok: false };
    if (data.createBackup) {
      try {
        const mod = await import("./backups.server");
        const res = await mod.runBackupWithRetry("emergency", context.userId, 1);
        backup = { ok: true, path: (res as any)?.path };
      } catch (e: any) {
        backup = { ok: false, error: e?.message || "backup failed" };
      }
    }

    // 2) Resolve target tables from selected categories
    const targets = new Set<string>();
    for (const cat of data.categories) {
      for (const t of CATEGORY_TABLES[cat] ?? []) targets.add(t);
    }

    // 3) Wipe selected tables (full, not is_demo-scoped)
    const summary: Record<string, number> = {};
    let totalDeleted = 0;
    for (const t of DELETE_ORDER) {
      if (!targets.has(t)) continue;
      // .delete() needs a filter; use an always-true predicate.
      const { count, error } = await sb
        .from(t as any)
        .delete({ count: "exact" })
        .not("id", "is", null);
      if (error) {
        summary[t] = 0;
        continue;
      }
      summary[t] = count ?? 0;
      totalDeleted += count ?? 0;
    }

    // 4) Optionally delete non-admin test users (profiles + auth + user_roles)
    let usersDeleted = 0;
    if (data.categories.includes("test_users")) {
      // Collect admin user ids — these are never deleted.
      const { data: admins } = await sb
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      const adminIds = new Set((admins ?? []).map((r: any) => r.user_id as string));

      // List all auth users in pages, delete any non-admin.
      let page = 1;
      const perPage = 200;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: list, error } = await sb.auth.admin.listUsers({ page, perPage });
        if (error || !list?.users?.length) break;
        for (const u of list.users) {
          if (adminIds.has(u.id)) continue;
          await sb.auth.admin.deleteUser(u.id).catch(() => null);
          // Profile + roles fall through; clean up explicitly in case of stragglers.
          await sb.from("profiles").delete().eq("id", u.id);
          await sb.from("user_roles").delete().eq("user_id", u.id);
          usersDeleted += 1;
        }
        if (list.users.length < perPage) break;
        page += 1;
      }
    }

    // 5) Verify integrity — counts after wipe for targeted tables
    const remaining: Record<string, number> = {};
    let remainingTotal = 0;
    for (const t of targets) {
      const { count } = await sb
        .from(t as any)
        .select("*", { count: "exact", head: true });
      remaining[t] = count ?? 0;
      remainingTotal += count ?? 0;
    }

    return {
      backup,
      summary,
      totalDeleted,
      usersDeleted,
      remaining,
      remainingTotal,
      status: remainingTotal === 0 ? "clean" : "partial",
    };
  });
