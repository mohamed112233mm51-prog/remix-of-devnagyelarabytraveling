-- Financial Scalability Hardening v1.1
-- Coverage gate: proves whether payment_splits fully represents each entity's historical rows.
-- READ-ONLY. Does not update/delete/backfill any financial data.

create or replace function public.financial_entity_coverage_v1(
  p_party_type text,
  p_party_id uuid
)
returns table(
  party_type text,
  party_id uuid,
  parent_table text,
  parent_count bigint,
  linked_parent_count bigint,
  unlinked_parent_count bigint,
  active_split_count bigint,
  coverage_complete boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with parents as (
    select source_table, source_id
    from public.financial_entity_source_ids_v1(p_party_type, p_party_id)
  ), linked as (
    select distinct p.source_table, p.source_id
    from parents p
    join public.payment_splits ps
      on ps.source_table = p.source_table
     and ps.source_id = p.source_id::text
     and ps.cancelled_at is null
  ), split_count as (
    select count(*)::bigint as n
    from public.payment_splits ps
    join parents p
      on ps.source_table = p.source_table
     and ps.source_id = p.source_id::text
    where ps.cancelled_at is null
  )
  select
    p_party_type,
    p_party_id,
    coalesce((select min(source_table) from parents),
      case p_party_type
        when 'agent' then 'transactions'
        when 'company' then 'company_transactions'
        when 'merchant' then 'merchant_cash_collections'
        when 'investor' then 'investor_transactions'
        when 'currency_supplier' then 'currency_supplier_transactions'
        when 'expense' then 'expenses'
        else 'unknown'
      end
    ) as parent_table,
    (select count(*)::bigint from parents) as parent_count,
    (select count(*)::bigint from linked) as linked_parent_count,
    ((select count(*)::bigint from parents) - (select count(*)::bigint from linked)) as unlinked_parent_count,
    (select n from split_count) as active_split_count,
    ((select count(*) from parents) = (select count(*) from linked)) as coverage_complete;
$$;

create or replace function public.financial_system_coverage_v1()
returns table(
  party_type text,
  entity_count bigint,
  parent_count bigint,
  linked_parent_count bigint,
  unlinked_parent_count bigint,
  coverage_complete boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with entities as (
    select 'agent'::text as party_type, id as party_id from public.agents
    union all
    select 'company'::text, id from public.issuing_companies
    union all
    select 'merchant'::text, id from public.merchants
    union all
    select 'investor'::text, id from public.investors
    union all
    select 'currency_supplier'::text, id from public.currency_suppliers
  ), coverage as (
    select e.party_type, c.*
    from entities e
    cross join lateral public.financial_entity_coverage_v1(e.party_type, e.party_id) c
  )
  select
    c.party_type,
    count(*)::bigint as entity_count,
    coalesce(sum(c.parent_count), 0)::bigint as parent_count,
    coalesce(sum(c.linked_parent_count), 0)::bigint as linked_parent_count,
    coalesce(sum(c.unlinked_parent_count), 0)::bigint as unlinked_parent_count,
    bool_and(c.coverage_complete) as coverage_complete
  from coverage c
  group by c.party_type
  order by c.party_type;
$$;

revoke all on function public.financial_entity_coverage_v1(text, uuid) from public;
revoke all on function public.financial_system_coverage_v1() from public;

grant execute on function public.financial_entity_coverage_v1(text, uuid) to authenticated, service_role;
grant execute on function public.financial_system_coverage_v1() to authenticated, service_role;

notify pgrst, 'reload schema';
