## Plan: Agent-Specific Service Pricing

### 1. Database
New migration adds:
- Table `agent_service_pricing` (id, agent_id, service_type, company_price, agent_price, company_percentage, company_profit_value, created_at, updated_at)
  - unique(agent_id, service_type)
  - open RLS to match existing tables
- Snapshot columns on `flights`, `approvals` (already has `price`/`company_value`/`count` — add `company_price`, `agent_price`, `company_percentage`, `company_profit_value`)
  - `flights` already has `price` (agent price) + `company_value` + `count`; add the same 4 snapshot fields for explicitness
  - same for `approvals`
  - libyan_investment uses `approvals` table (service_type filter), so same migration covers it

### 2. Types & db.ts
- Add `AgentServicePricing` type
- Add `useAgentPricing(agentId)` hook returning `Map<service_type, pricing>`
- Service type keys: `"تذاكر طيران" | "موافقة أمنية" | "استثمار ليبي"`

### 3. Agent profile UI (src/routes/accounts.tsx or agent edit modal)
Add "تسعير الخدمات" section:
- Table with rows per service type
- Add/Edit/Delete row controls
- Auto-calc on edit of company_price/agent_price → profit + percentage
- Auto-calc on edit of percentage → profit + company_price (from agent_price)
- Save upserts to `agent_service_pricing`

### 4. Service submission auto-fill (src/routes/submit.tsx + FlightForm/ApprovalForm/InvestmentForm)
- When agent + service type selected → fetch pricing, prefill price + company_value
- Show helper: "تم جلب السعر من تسعير الوكيل ويمكن تعديله لهذه الخدمة فقط"
- If missing: warning "لا يوجد تسعير محفوظ لهذه الخدمة لهذا الوكيل" + manual entry allowed
- Fields editable; edits only affect this record

### 5. Snapshot on save
- On insert into flights/approvals, store all 4 pricing fields alongside existing price/company_value
- Existing financial logic (uses `price` and `company_value`) continues unchanged

### 6. Agent statement
- No layout change; existing reads from `price`/`company_value` already represent the snapshot

### Files
- new migration
- `src/lib/db.ts` — types + hook
- agent edit UI (locate current agent edit modal first)
- `src/routes/flights.tsx`, `src/routes/approvals.tsx`, `src/routes/libyan-investment.tsx` — auto-fill in their Forms
