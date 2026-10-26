-- Financial Scalability Hardening v2.1 (parallel only)
-- Canonical balances for currency suppliers and investors.
-- Mirrors current frontend accounting rules without modifying historical data.

create or replace function public.financial_currency_supplier_balance_v2(p_supplier_id uuid)
returns table(
  currency text,
  debit numeric,
  credit numeric,
  balance numeric,
  row_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ledger as (
    select
      case
        when t.tx_type in ('شراء عملة', 'بيع عملة') then 'EGP'
        when t.tx_type = 'دفع نقدية' then upper(coalesce(nullif(trim(t.sold_currency), ''), 'EGP'))
        when t.tx_type = 'استلام نقدية' then upper(coalesce(nullif(trim(t.bought_currency), ''), 'EGP'))
        else upper(coalesce(nullif(trim(coalesce(t.opening_currency, t.bought_currency)), ''), 'EGP'))
      end as currency,
      case
        when t.tx_type = 'شراء عملة' then
          coalesce((
            select sum(coalesce((x->>'amount')::numeric, 0))
            from jsonb_array_elements(coalesce(t.payment_splits::jsonb, '[]'::jsonb)) x
          ), 0) - coalesce(t.sold_amount, 0)::numeric
        when t.tx_type = 'بيع عملة' then
          coalesce(t.bought_amount, 0)::numeric - coalesce((
            select sum(coalesce((x->>'amount')::numeric, 0))
            from jsonb_array_elements(coalesce(t.payment_splits::jsonb, '[]'::jsonb)) x
          ), 0)
        when t.tx_type = 'دفع نقدية' then coalesce(t.sold_amount, 0)::numeric
        when t.tx_type = 'استلام نقدية' then -coalesce(t.bought_amount, 0)::numeric
        else coalesce(t.bought_amount, 0)::numeric - coalesce(t.sold_amount, 0)::numeric
      end as delta
    from public.currency_supplier_transactions t
    where t.supplier_id = p_supplier_id
      and t.cancelled_at is null
  )
  select
    currency,
    coalesce(sum(case when delta > 0 then delta else 0 end), 0)::numeric as debit,
    coalesce(sum(case when delta < 0 then -delta else 0 end), 0)::numeric as credit,
    coalesce(sum(delta), 0)::numeric as balance,
    count(*)::bigint as row_count
  from ledger
  group by currency
  order by currency;
$$;

create or replace function public.financial_investor_balance_v2(p_investor_id uuid)
returns table(
  currency text,
  debit numeric,
  credit numeric,
  balance numeric,
  row_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with tx as (
    select t.id, t.transaction_type, coalesce(t.amount, 0)::numeric as amount
    from public.investor_transactions t
    where t.investor_id = p_investor_id
  ), linked as (
    select
      tx.id as txn_id,
      ps.currency,
      ps.amount::numeric as amount,
      ps.direction,
      ps.cancelled_at
    from tx
    join public.payment_splits ps
      on ps.source_table = 'investor_transactions'
     and ps.source_id = tx.id::text
  ), split_tx_ids as (
    -- Important: existence includes cancelled splits, matching buildInvestorCapitalSummary.
    select distinct txn_id from linked
  ), movements as (
    select
      upper(coalesce(nullif(trim(l.currency), ''), 'EGP')) as currency,
      case when l.cancelled_at is null and l.direction = 'in' then abs(coalesce(l.amount, 0)) else 0 end as deposit,
      case when l.cancelled_at is null and l.direction = 'out' then abs(coalesce(l.amount, 0)) else 0 end as withdraw,
      1::bigint as n
    from linked l
    union all
    select
      'EGP'::text as currency,
      case when tx.transaction_type = 'توريد نقدية' then abs(tx.amount) else 0 end as deposit,
      case when tx.transaction_type = 'صرف نقدية' then abs(tx.amount) else 0 end as withdraw,
      1::bigint as n
    from tx
    where not exists (select 1 from split_tx_ids s where s.txn_id = tx.id)
  )
  select
    currency,
    coalesce(sum(withdraw), 0)::numeric as debit,
    coalesce(sum(deposit), 0)::numeric as credit,
    coalesce(sum(deposit - withdraw), 0)::numeric as balance,
    coalesce(sum(n), 0)::bigint as row_count
  from movements
  group by currency
  order by currency;
$$;

-- Replace dispatcher with all canonical v2 party types implemented so far.
create or replace function public.financial_entity_balance_v2(
  p_party_type text,
  p_party_id uuid
)
returns table(
  currency text,
  debit numeric,
  credit numeric,
  balance numeric,
  row_count bigint,
  engine text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_party_type = 'agent' then
    return query select a.currency, a.debit, a.credit, a.balance, a.row_count, 'canonical_agent_v2'::text
      from public.financial_agent_balance_v2(p_party_id) a;
  elsif p_party_type = 'company' then
    return query select c.currency, c.debit, c.credit, c.balance, c.row_count, 'canonical_company_v2'::text
      from public.financial_company_balance_v2(p_party_id) c;
  elsif p_party_type = 'currency_supplier' then
    return query select s.currency, s.debit, s.credit, s.balance, s.row_count, 'canonical_currency_supplier_v2'::text
      from public.financial_currency_supplier_balance_v2(p_party_id) s;
  elsif p_party_type = 'investor' then
    return query select i.currency, i.debit, i.credit, i.balance, i.row_count, 'canonical_investor_v2'::text
      from public.financial_investor_balance_v2(p_party_id) i;
  else
    raise exception 'FINANCIAL_ENGINE_NOT_MIGRATED: party_type % is not yet available in canonical v2', p_party_type;
  end if;
end;
$$;

revoke all on function public.financial_currency_supplier_balance_v2(uuid) from public;
revoke all on function public.financial_investor_balance_v2(uuid) from public;

grant execute on function public.financial_currency_supplier_balance_v2(uuid) to authenticated, service_role;
grant execute on function public.financial_investor_balance_v2(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
