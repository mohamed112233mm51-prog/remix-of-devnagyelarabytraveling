import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  AIRLINES as FALLBACK_AIRLINES,
  AUTHORITIES as FALLBACK_AUTHORITIES,
  DESTINATIONS as FALLBACK_DESTINATIONS,
  SERVICE_TYPES as FALLBACK_SERVICE_TYPES,
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
  "payment_splits",
  "expense_deductions",
  "expenses",
  "investor_transactions",
  "merchant_cash_collections",
  "currency_supplier_transactions",
  "usd_treasury_transactions",
  "company_transactions",
  "transactions",
  "submissions",
  "executions",
  "company_pricing_rules",
  "agents",
  "issuing_companies",
  "merchants",
  "currency_suppliers",
  "investors",
  "activity_logs",
  "import_batches",
] as const;

type DemoTable = (typeof DEMO_TABLES)[number];

const COMPANY_ACCOUNT_REPORT_TABLES = [
  "company_accounts",
  "issuing_company_accounts",
  "company_services",
  "company_balances",
] as const;

const PRODUCTION_DELETE_ORDER: readonly DemoTable[] = [
  "payment_splits",
  "expense_deductions",
  "expenses",
  "investor_transactions",
  "merchant_cash_collections",
  "currency_supplier_transactions",
  "usd_treasury_transactions",
  "company_transactions",
  "transactions",
  "submissions",
  "executions",
  "company_pricing_rules",
  "investors",
  "merchants",
  "currency_suppliers",
  "issuing_companies",
  "agents",
  "activity_logs",
  "import_batches",
];

type CleanupErrors = Record<string, string>;

function isMissingTableError(error: any) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("could not find the table") || msg.includes("does not exist") || msg.includes("pgrst205");
}

async function countAllRows(sb: ReturnType<typeof admin>, table: string, errors?: CleanupErrors) {
  const { count, error } = await sb
    .from(table as any)
    .select("*", { count: "exact", head: true });
  if (error) {
    if (errors) errors[table] = error.message;
    console.error(`[Reset Verification] failed to count ${table}:`, error.message);
    return 0;
  }
  return count ?? 0;
}

async function countRowsWithValue(sb: ReturnType<typeof admin>, table: string, column: string, errors?: CleanupErrors) {
  const { count, error } = await sb
    .from(table as any)
    .select("*", { count: "exact", head: true })
    .not(column, "is", null);
  if (error) {
    if (errors) errors[`${table}.${column}`] = error.message;
    console.error(`[Reset Verification] failed to count ${table}.${column}:`, error.message);
    return 0;
  }
  return count ?? 0;
}

async function deleteAllRows(sb: ReturnType<typeof admin>, table: string, summary: Record<string, number>, errors: CleanupErrors) {
  const { count, error } = await sb
    .from(table as any)
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (error) {
    summary[table] = 0;
    errors[table] = error.message;
    console.error(`[productionCleanup] failed to wipe ${table}:`, error.message);
    return 0;
  }
  summary[table] = count ?? 0;
  return count ?? 0;
}

async function countOptionalRows(sb: ReturnType<typeof admin>, table: string, errors?: CleanupErrors) {
  const { count, error } = await sb
    .from(table as any)
    .select("*", { count: "exact", head: true });
  if (error) {
    if (!isMissingTableError(error) && errors) errors[table] = error.message;
    return 0;
  }
  return count ?? 0;
}

async function deleteOptionalRows(sb: ReturnType<typeof admin>, table: string, summary: Record<string, number>, errors: CleanupErrors) {
  const { count, error } = await sb
    .from(table as any)
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (error) {
    summary[table] = 0;
    if (!isMissingTableError(error)) {
      errors[table] = error.message;
      console.error(`[productionCleanup] failed to wipe ${table}:`, error.message);
    }
    return 0;
  }
  summary[table] = count ?? 0;
  return count ?? 0;
}

async function buildResetVerification(sb: ReturnType<typeof admin>, errors: CleanupErrors = {}) {
  const issuingCompanies = await countAllRows(sb, "issuing_companies", errors);
  const companyTransactions = await countAllRows(sb, "company_transactions", errors);
  const usdTreasuryCompanyRefs = await countRowsWithValue(sb, "usd_treasury_transactions", "company_id", errors);
  const submissionCompanyRefs = await countRowsWithValue(sb, "submissions", "approval_company_id", errors);
  const executionCompanyRefs = await countRowsWithValue(sb, "executions", "approval_company_id", errors);
  const companyAccountCounts: Record<string, number> = {};
  for (const t of COMPANY_ACCOUNT_REPORT_TABLES) companyAccountCounts[t] = await countOptionalRows(sb, t, errors);

  return {
    issuing_companies: issuingCompanies,
    company_transactions: companyTransactions,
    company_accounts: companyAccountCounts.company_accounts,
    issuing_company_accounts: companyAccountCounts.issuing_company_accounts,
    company_services: companyAccountCounts.company_services,
    company_balances: companyAccountCounts.company_balances,
    usd_treasury_company_refs: usdTreasuryCompanyRefs,
    submissions_company_refs: submissionCompanyRefs,
    executions_company_refs: executionCompanyRefs,
    company_accounts_total: Object.values(companyAccountCounts).reduce((s, n) => s + n, 0),
    company_related_total: issuingCompanies + companyTransactions + usdTreasuryCompanyRefs + submissionCompanyRefs + executionCompanyRefs,
  };
}

function companyAccountsDeleted(summary: Record<string, number>) {
  return COMPANY_ACCOUNT_REPORT_TABLES.reduce((sum, table) => sum + (summary[table] ?? 0), 0);
}

export const resetVerification = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const errors: CleanupErrors = {};
    const verification = await buildResetVerification(sb, errors);
    console.info("[Reset Verification]", { verification, errors });
    return { verification, errors, ok: verification.issuing_companies === 0 && verification.company_related_total === 0 };
  });

export const checkDemoData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const counts: Record<string, number> = {};
    let total = 0;
    for (const t of DEMO_TABLES) {
      // Count ALL rows — production cleanup wipes everything in these tables
      // (regardless of is_demo flag), so the UI must reflect real totals.
      const { count } = await sb
        .from(t)
        .select("*", { count: "exact", head: true });
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

    // Flights/approvals demo seeding removed — tables no longer exist.
    summary.flights = 0;
    summary.approvals = 0;

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
          travel_statement: null,
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
    const order = [
      "expense_deductions",
      "expenses",
      "investor_transactions",
      "merchant_cash_collections",
      "company_transactions",
      "transactions",
      "investors",
      "merchants",
      "issuing_companies",
      "agents",
    ] as const;
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
// - Deletes ALL operational rows regardless of is_demo.
// - Never touches: profiles, user_roles, app_settings, system_dropdown_options,
//   backup_logs, storage buckets, or admin users.
// ============================================================
export const productionCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { createBackup?: boolean } | undefined) => ({
    createBackup: d?.createBackup !== false,
  }))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();

    // Legacy entry point kept for old UI code, but routed through the same
    // atomic DB reset as ProductionWizardCard. Backup failure aborts before
    // touching data.
    let backup: { ok: boolean; path?: string; error?: string } = { ok: false };
    if (data.createBackup) {
      try {
        const mod = await import("./backups.server");
        const res = await mod.runBackupWithRetry("emergency", context.userId, 1);
        backup = { ok: true, path: (res as any)?.path };
      } catch (e: any) {
        backup = { ok: false, error: e?.message || "backup failed" };
        throw new Error(
          "فشل إنشاء النسخة الاحتياطية الطارئة — تم إلغاء التهيئة قبل حذف أي بيانات. " +
            (backup.error ?? ""),
        );
      }
    }

    const { data: rpcData, error: rpcErr } = await sb.rpc(
      "reset_production_business_data" as any,
      { p_confirm: "تهيئة الإنتاج نهائياً", p_user_id: context.userId } as any,
    );
    if (rpcErr) throw new Error(`فشل تنفيذ التهيئة الذرّية: ${rpcErr.message}`);

    const rpcResult: any = rpcData ?? {};
    const summary: Record<string, number> = rpcResult.deleted ?? {};
    const errors: CleanupErrors = {};
    let totalDeleted = 0;
    for (const [k, v] of Object.entries(summary)) {
      if (k === "cash_boxes_reset") continue;
      totalDeleted += Number(v) || 0;
    }

    const verification = await buildResetVerification(sb, errors);
    let remaining = 0;
    for (const t of PRODUCTION_DELETE_ORDER) {
      remaining += await countAllRows(sb, t, errors);
    }
    const clean = remaining === 0 && verification.issuing_companies === 0 && verification.company_related_total === 0;
    console.info("[Reset Verification] production cleanup result", { verification, summary, errors, remaining });

    return {
      backup,
      summary,
      errors,
      verification,
      companyAccountsDeleted: companyAccountsDeleted(summary),
      totalDeleted,
      usersDeleted: 0, // admins / real users are intentionally preserved
      remaining,
      status: clean ? "clean" : "partial",
    };
  });

// ============================================================
// Production Wizard — FULL atomic wipe of all business/operational data.
// Runs inside a single SECURITY DEFINER Postgres function so the DB
// either wipes everything or nothing (no partial state).
// Preserves: profiles, user_roles, app_settings, system_dropdown_options,
// backup_logs, cash_boxes (as entities — balances reset to 0),
// and all auth users.
// ============================================================
export type WipeCategory = "all";

// Tables the RPC wipes — mirror of reset_production_business_data() body.
// Used ONLY for the preflight preview and the post-wipe verification.
export const RESET_WIPE_TABLES = [
  "payment_splits",
  "financial_audit_log",
  "expense_deductions",
  "expenses",
  "investor_transactions",
  "merchant_cash_collections",
  "currency_supplier_transactions",
  "usd_treasury_transactions",
  "company_transactions",
  "transactions",
  "submissions",
  "executions",
  "company_pricing_rules",
  "activity_logs",
  "import_batches",
  "investors",
  "merchants",
  "currency_suppliers",
  "issuing_companies",
  "agents",
] as const;

const PRESERVED_TABLES = [
  "profiles",
  "user_roles",
  "app_settings",
  "system_dropdown_options",
  "backup_logs",
  "cash_boxes",
] as const;

export const previewProductionReset = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const willDelete: Record<string, number> = {};
    const preserved: Record<string, number> = {};
    let total = 0;
    for (const t of RESET_WIPE_TABLES) {
      const { count } = await sb.from(t as any).select("*", { count: "exact", head: true });
      willDelete[t] = count ?? 0;
      total += count ?? 0;
    }
    for (const t of PRESERVED_TABLES) {
      const { count } = await sb.from(t as any).select("*", { count: "exact", head: true });
      preserved[t] = count ?? 0;
    }
    return { willDelete, preserved, total };
  });

const CONFIRM_PHRASE = "تهيئة الإنتاج نهائياً";

export const productionWipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { confirm: string; createBackup?: boolean }) => {
    if (d?.confirm !== CONFIRM_PHRASE) {
      throw new Error("عبارة التأكيد غير مطابقة");
    }
    return { confirm: d.confirm, createBackup: d.createBackup !== false };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();

    // 1) Mandatory backup. If backup requested and fails → abort without
    // touching data (spec §9: never start the wipe on a failed backup).
    let backup: { ok: boolean; path?: string; error?: string } = { ok: false };
    if (data.createBackup) {
      try {
        const mod = await import("./backups.server");
        const res = await mod.runBackupWithRetry("emergency", context.userId, 1);
        backup = { ok: true, path: (res as any)?.path };
      } catch (e: any) {
        backup = { ok: false, error: e?.message || "backup failed" };
        throw new Error(
          "فشل إنشاء النسخة الاحتياطية الطارئة — تم إلغاء التهيئة قبل حذف أي بيانات. " +
            (backup.error ?? ""),
        );
      }
    }

    // 2) Atomic wipe. The RPC runs in a single transaction inside Postgres,
    // disables cash-box guards + payment_split triggers, deletes children
    // → parents, resets cash-box balances, then re-enables triggers. On any
    // error Postgres rolls the whole function back.
    // Call through the trusted backend client only: direct browser execution is
    // revoked at DB level, while the RPC still verifies the admin user id.
    const { data: rpcData, error: rpcErr } = await sb.rpc(
      "reset_production_business_data" as any,
      { p_confirm: data.confirm, p_user_id: context.userId } as any,
    );
    if (rpcErr) {
      throw new Error(`فشل تنفيذ التهيئة الذرّية: ${rpcErr.message}`);
    }
    const rpcResult: any = rpcData ?? {};
    const summary: Record<string, number> = rpcResult.deleted ?? rpcResult ?? {};

    // 3) Post-wipe verification — every business table must be at 0.
    const verification: Record<string, number> = {};
    let remainingTotal = 0;
    for (const t of RESET_WIPE_TABLES) {
      const { count } = await sb.from(t as any).select("*", { count: "exact", head: true });
      verification[t] = count ?? 0;
      remainingTotal += count ?? 0;
    }

    // 4) Preserved-side sanity: the executing admin, their profile + role,
    // and dropdown/settings rows must still exist.
    const preserved: Record<string, number> = {};
    for (const t of PRESERVED_TABLES) {
      const { count } = await sb.from(t as any).select("*", { count: "exact", head: true });
      preserved[t] = count ?? 0;
    }
    const { data: meRole } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    const adminStillPresent = !!meRole;

    let totalDeleted = 0;
    for (const [k, v] of Object.entries(summary)) {
      if (k === "cash_boxes_reset") continue;
      totalDeleted += Number(v) || 0;
    }

    const status: "clean" | "partial" = remainingTotal === 0 && adminStillPresent ? "clean" : "partial";

    return {
      backup,
      summary,
      totalDeleted,
      usersDeleted: 0,
      remaining: verification,
      remainingTotal,
      preserved,
      adminStillPresent,
      resetProof: {
        remaining: rpcResult.remaining ?? null,
        computed: rpcResult.computed ?? null,
        agentRelatedTables: rpcResult.agent_related_tables ?? [],
      },
      status,
    };
  });


// ============================================================
// Prepare System for Launch (Super Admin only)
// Wipes operational/transactional data while preserving:
// users, roles, settings, dropdowns, entities (agents/companies/
// merchants/investors/currency suppliers), cash boxes, branding,
// pricing config and backup history.
// ============================================================
async function ensureSuperAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (!data?.is_super_admin) throw new Response("Forbidden: Super Admin only", { status: 403 });
}

// Tables wiped fully (children before parents to avoid FK issues).
const LAUNCH_WIPE_ORDER: readonly string[] = [
  "payment_splits",
  "expense_deductions",
  "expenses",
  "transactions",
  "company_transactions",
  "merchant_cash_collections",
  "investor_transactions",
  "currency_supplier_transactions",
  "usd_treasury_transactions",
  "submissions",
  "executions",
  "activity_logs",
  "import_batches",
];

// Core entities (wiped only when wipeCoreEntities=true).
const CORE_ENTITY_DEPENDENTS: readonly string[] = [
  "company_pricing_rules",
];
const CORE_ENTITIES: readonly string[] = [
  "agents",
  "issuing_companies",
  "merchants",
  "currency_suppliers",
];

export const prepareForLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { confirm?: string; wipeCoreEntities?: boolean } | undefined) => ({
    confirm: d?.confirm ?? "",
    wipeCoreEntities: d?.wipeCoreEntities === true,
  }))
  .handler(async ({ data, context }) => {
    await ensureSuperAdmin(context.supabase, context.userId);
    if (data.confirm !== "PREPARE") {
      throw new Error("Confirmation phrase required");
    }
    const sb = admin();

    const summary: Record<string, number> = {};
    let totalDeleted = 0;

    for (const t of LAUNCH_WIPE_ORDER) {
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

    if (data.wipeCoreEntities) {
      for (const t of [...CORE_ENTITY_DEPENDENTS, ...CORE_ENTITIES]) {
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
    }

    // Reset cash box balances to zero (entities preserved).
    const { count: boxesReset } = await sb
      .from("cash_boxes")
      .update({ balance: 0 } as any, { count: "exact" })
      .not("id", "is", null);
    summary["cash_boxes_reset"] = boxesReset ?? 0;

    return {
      summary,
      totalDeleted,
      cashBoxesReset: boxesReset ?? 0,
      status: "clean" as const,
    };
  });
