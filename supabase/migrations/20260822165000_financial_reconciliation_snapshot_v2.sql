-- Financial Scalability Hardening v2.3 (parallel diagnostics only)
-- System-wide canonical snapshot for reconciliation before any UI cutover.
-- READ ONLY. No historical row is modified.

create or replace function public.financial_reconciliation_snapshot_v2()
returns table(
  party_type text,
  party_id uuid,
  party_name text,
  currency text,
  debit numeric,
  credit numeric,
  balance numeric,
  row_count bigint,
  engine text
)
language sql
stable
security invoker
set search_path = public
as $$
  with entities as (
    select 'agent'::text as party_type, a.id as party_id, a.name::text as party_name
      from public.agents a
    union all
    select 'company'::text, c.id, c.company_name::text
      from public.issuing_companies c
    union all
    select 'merchant'::text, m.id, m.merchant_name::text
      from public.merchants m
    union all
    select 'investor'::text, i.id, i.name::text
      from public.investors i
    union all
    select 'currency_supplier'::text, s.id, s.name::text
      from public.currency_suppliers s
  )
  select
    e.party_type,
    e.party_id,
    e.party_name,
    b.currency,
    b.debit,
    b.credit,
    b.balance,
    b.row_count,
    b.engine
  from entities e
  cross join lateral public.financial_entity_balance_v2(e.party_type, e.party_id) b
  order by e.party_type, e.party_name, e.party_id, b.currency;
$$;

-- Summary count by party type/currency. Useful for quick smoke checks after migration.
create or replace function public.financial_reconciliation_totals_v2()
returns table(
  party_type text,
  currency text,
  entity_count bigint,
  debit numeric,
  credit numeric,
  balance numeric,
  source_row_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.party_type,
    s.currency,
    count(distinct s.party_id)::bigint as entity_count,
    coalesce(sum(s.debit), 0)::numeric as debit,
    coalesce(sum(s.credit), 0)::numeric as credit,
    coalesce(sum(s.balance), 0)::numeric as balance,
    coalesce(sum(s.row_count), 0)::bigint as source_row_count
  from public.financial_reconciliation_snapshot_v2() s
  group by s.party_type, s.currency
  order by s.party_type, s.currency;
$$;

revoke all on function public.financial_reconciliation_snapshot_v2() from public;
revoke all on function public.financial_reconciliation_totals_v2() from public;

grant execute on function public.financial_reconciliation_snapshot_v2() to authenticated, service_role;
grant execute on function public.financial_reconciliation_totals_v2() to authenticated, service_role;

notify pgrst, 'reload schema';
