-- Financial Scalability Hardening v1
-- Safe parallel read model. Does not mutate historical financial rows and is not wired to UI yet.

create index if not exists idx_payment_splits_source_active_currency_created
  on public.payment_splits (source_table, source_id, currency, created_at)
  where cancelled_at is null;

create index if not exists idx_transactions_agent_created
  on public.transactions (agent_id, created_at)
  where agent_id is not null;

create index if not exists idx_company_transactions_company_created
  on public.company_transactions (company_id, created_at)
  where company_id is not null;

create index if not exists idx_merchant_cash_collections_merchant_created
  on public.merchant_cash_collections (merchant_id, created_at)
  where merchant_id is not null;

create index if not exists idx_investor_transactions_investor_created
  on public.investor_transactions (investor_id, created_at)
  where investor_id is not null;

create index if not exists idx_currency_supplier_transactions_supplier_created
  on public.currency_supplier_transactions (supplier_id, created_at)
  where supplier_id is not null;

create or replace function public.financial_entity_source_ids_v1(
  p_party_type text,
  p_party_id uuid
)
returns table(source_table text, source_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select 'transactions'::text, t.id
    from public.transactions t
   where p_party_type = 'agent' and t.agent_id = p_party_id
  union all
  select 'company_transactions'::text, c.id
    from public.company_transactions c
   where p_party_type = 'company' and c.company_id = p_party_id
  union all
  select 'merchant_cash_collections'::text, m.id
    from public.merchant_cash_collections m
   where p_party_type = 'merchant' and m.merchant_id = p_party_id
  union all
  select 'investor_transactions'::text, i.id
    from public.investor_transactions i
   where p_party_type = 'investor' and i.investor_id = p_party_id
  union all
  select 'currency_supplier_transactions'::text, s.id
    from public.currency_supplier_transactions s
   where p_party_type = 'currency_supplier' and s.supplier_id = p_party_id
  union all
  select 'expenses'::text, e.id
    from public.expenses e
   where p_party_type = 'expense' and e.id = p_party_id;
$$;

create or replace function public.financial_entity_balance_v1(
  p_party_type text,
  p_party_id uuid
)
returns table(
  currency text,
  debit numeric,
  credit numeric,
  balance numeric,
  split_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ids as (
    select * from public.financial_entity_source_ids_v1(p_party_type, p_party_id)
  ), active_splits as (
    select
      upper(coalesce(nullif(trim(ps.currency), ''), 'EGP')) as currency,
      coalesce(ps.amount, 0)::numeric as amount,
      ps.direction
    from public.payment_splits ps
    join ids on ids.source_table = ps.source_table and ids.source_id::text = ps.source_id
    where ps.cancelled_at is null
  )
  select
    currency,
    coalesce(sum(case when direction = 'out' then amount else 0 end), 0)::numeric as debit,
    coalesce(sum(case when direction = 'in' then amount else 0 end), 0)::numeric as credit,
    coalesce(sum(case when direction = 'out' then amount else -amount end), 0)::numeric as balance,
    count(*)::bigint as split_count
  from active_splits
  group by currency
  order by currency;
$$;

create or replace function public.financial_entity_ledger_page_v1(
  p_party_type text,
  p_party_id uuid,
  p_currency text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  id uuid,
  transaction_id uuid,
  method text,
  currency text,
  cash_box_id uuid,
  amount numeric,
  direction text,
  source_table text,
  source_id text,
  created_at timestamptz,
  running_balance numeric,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ids as (
    select * from public.financial_entity_source_ids_v1(p_party_type, p_party_id)
  ), filtered as (
    select
      ps.id,
      ps.transaction_id,
      ps.method,
      upper(coalesce(nullif(trim(ps.currency), ''), 'EGP')) as currency,
      ps.cash_box_id,
      coalesce(ps.amount, 0)::numeric as amount,
      ps.direction::text as direction,
      ps.source_table,
      ps.source_id,
      ps.created_at,
      case when ps.direction = 'out' then coalesce(ps.amount, 0)::numeric else -coalesce(ps.amount, 0)::numeric end as delta
    from public.payment_splits ps
    join ids on ids.source_table = ps.source_table and ids.source_id::text = ps.source_id
    where ps.cancelled_at is null
      and (p_currency is null or upper(coalesce(nullif(trim(ps.currency), ''), 'EGP')) = upper(trim(p_currency)))
      and (p_from is null or ps.created_at >= p_from)
      and (p_to is null or ps.created_at <= p_to)
  ), enriched as (
    select
      f.*,
      sum(f.delta) over (partition by f.currency order by f.created_at, f.id rows between unbounded preceding and current row) as running_balance,
      count(*) over () as total_count
    from filtered f
  )
  select
    e.id,
    e.transaction_id,
    e.method,
    e.currency,
    e.cash_box_id,
    e.amount,
    e.direction,
    e.source_table,
    e.source_id,
    e.created_at,
    e.running_balance,
    e.total_count
  from enriched e
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.financial_entity_source_ids_v1(text, uuid) from public;
revoke all on function public.financial_entity_balance_v1(text, uuid) from public;
revoke all on function public.financial_entity_ledger_page_v1(text, uuid, text, timestamptz, timestamptz, integer, integer) from public;

grant execute on function public.financial_entity_source_ids_v1(text, uuid) to authenticated, service_role;
grant execute on function public.financial_entity_balance_v1(text, uuid) to authenticated, service_role;
grant execute on function public.financial_entity_ledger_page_v1(text, uuid, text, timestamptz, timestamptz, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
