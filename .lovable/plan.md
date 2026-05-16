## Add USD Treasury to Company Financial System

Introduce a parallel USD treasury alongside the existing EGP treasury, support EGP→USD conversions, and allow paying issuing companies in EGP, USD, or both — without touching existing EGP balances, agent flows, or reports.

### 1. Database (migration)

New table `usd_treasury_transactions`:
- `id`, `created_at`, `is_demo`
- `date` (default today)
- `type` text — `conversion` | `company_payment` | `adjustment`
- `egp_amount` numeric (0 for direct USD entries)
- `usd_amount` numeric
- `exchange_rate` numeric (nullable for non-conversion entries)
- `company_id` uuid nullable (set when type=`company_payment`)
- `note` text nullable

Extend `company_transactions` (company payment movement) with:
- `usd_amount` numeric NOT NULL DEFAULT 0
- `exchange_rate_used` numeric NULL
- `payment_currency` text NULL — `EGP` | `USD` | `MIXED`

RLS: `open_all` policy (matches existing tables in this project).

Realtime: enable on `usd_treasury_transactions`.

No changes to existing EGP columns. All defaults keep historical rows behaving identically.

### 2. Lib / shared

`src/lib/db.ts`:
- Add `UsdTreasuryTransaction` type.
- Add `useLive<UsdTreasuryTransaction>("usd_treasury_transactions")` support (extend union).
- Add `fmtUSD(n)` formatter (`$ 1,234.00`, 2 decimals).
- Extend `CompanyTransaction` type with new fields.

`src/lib/reportsData.ts`:
- Add `usdTreasury` rows + loading.

### 3. Accounts page (`src/routes/accounts.tsx`)

Add a new KPI card next to existing treasury cards:
- **رصيد الخزينة بالدولار** — sum of all `usd_treasury_transactions` (conversions + adjustments − company_payments).
- Keep existing EGP treasury card unchanged.

Add toolbar action button **تحويل إلى الخزينة الدولارية** opening a modal:
- Fields: المبلغ بالجنيه، سعر الصرف، المبلغ بالدولار (auto, readonly), التاريخ, ملاحظات.
- Live calc: `usd = egp / rate` (rounded to 2 decimals).
- On save: insert one row into `usd_treasury_transactions` with `type='conversion'` and a parallel debit row into `company_transactions`-equivalent EGP outflow? **No** — per spec we only move EGP into USD treasury, so we also insert a matching EGP treasury withdrawal entry by inserting a `company_transactions` row with `note='تحويل إلى الخزينة الدولارية'` and negative `instapay_amount`/`cash_amount`? 

  Cleanest approach that does not disturb existing reports: store the EGP outflow inside `usd_treasury_transactions` itself (it already has `egp_amount`), and have the EGP treasury card subtract `SUM(egp_amount)` of conversion rows. That way existing `company_transactions` aggregations stay untouched.

### 4. Companies page (`src/routes/companies.tsx`) — pay issuing company

In the existing **صرف حركة مالية للشركة** form add a **عملة الدفع** segmented control: EGP / USD / كلاهما.

- **EGP** (default): current UI/logic, unchanged.
- **USD**: hide EGP payment-method block, show single `المبلغ بالدولار` field. On save insert a `company_transactions` row with new `usd_amount`, `payment_currency='USD'`, EGP fields = 0, and a matching `usd_treasury_transactions` row `type='company_payment'` (negative effect on USD balance).
- **MIXED**: show both EGP block AND USD field + exchange rate (optional, info only). Save as one `company_transactions` row carrying both `total_paid` (EGP) and `usd_amount`, plus the USD treasury debit row.

Company statement layout stays visually unchanged; just render a small `+ $X` next to the EGP amount when `usd_amount > 0`.

### 5. Reports (`src/routes/reports.tsx`)

- Add USD treasury balance to the treasury summary section (new line, doesn't replace EGP).
- New small table "حركات الخزينة الدولارية" (conversions + payments) — optional but useful for reconciliation.
- Existing EGP reports/exports untouched.

### 6. Guardrails

- Number formatting: EGP uses `fmtDL`, USD uses new `fmtUSD`.
- Validation: rate > 0, egp > 0, usd auto-derived, usd ≥ 0 on direct entries.
- All existing tests of EGP flows (agent payments, EGP-only company payments, merchant logic, accounting totals) remain byte-identical because we only **add** columns/tables and read paths.

### Files touched

- `supabase/migrations/*` (new)
- `src/lib/db.ts`
- `src/lib/reportsData.ts`
- `src/routes/accounts.tsx` — USD card + conversion modal
- `src/routes/companies.tsx` — currency selector in company payment form
- `src/routes/reports.tsx` — USD balance line

### What stays untouched

- EGP treasury math, agent accounts, merchant commission, existing company statement visuals, existing exports, RLS model, auth, dropdown system.
