-- Financial Scalability Hardening v2 (parallel only)
-- Canonical server-side balance calculations for AGENTS and COMPANIES.
-- Mirrors src/lib/financialSummary.ts legacy formulas. No UI is switched here.
-- No financial row is updated/deleted/backfilled.

create or replace function public.financial_single_split_currency_v2(
  p_source_table text,
  p_source_id uuid,
  p_fallback text
)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  with currencies as (
    select distinct upper(coalesce(nullif(trim(ps.currency), ''), 'EGP')) as currency
    from public.payment_splits ps
    where ps.source_table = p_source_table
      and ps.source_id = p_source_id::text
      and ps.cancelled_at is null
  )
  select case
    when (select count(*) from currencies) = 1 then (select min(currency) from currencies)
    else upper(coalesce(nullif(trim(p_fallback), ''), 'EGP'))
  end;
$$;

create or replace function public.financial_agent_balance_v2(p_agent_id uuid)
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
  with base as (
    select
      t.id,
      public.financial_single_split_currency_v2('transactions', t.id, t.currency) as currency,
      (coalesce(t.count, 0)::numeric * coalesce(t.price, 0)::numeric) as service_value,
      case
        when (
          coalesce(t.instapay_amount, 0)::numeric
          + coalesce(t.cash_amount, 0)::numeric
          + case
              when coalesce(t.merchant_cash_net_amount, 0)::numeric > 0
                then round(coalesce(t.merchant_cash_net_amount, 0)::numeric)
              else round(coalesce(t.merchant_cash_amount, 0)::numeric - coalesce(t.merchant_cash_amount, 0)::numeric * 0.01)
            end
          + coalesce(t.merchant_cash_physical_amount, 0)::numeric
        ) > 0
          then round(
            coalesce(t.instapay_amount, 0)::numeric
            + coalesce(t.cash_amount, 0)::numeric
            + case
                when coalesce(t.merchant_cash_net_amount, 0)::numeric > 0
                  then round(coalesce(t.merchant_cash_net_amount, 0)::numeric)
                else round(coalesce(t.merchant_cash_amount, 0)::numeric - coalesce(t.merchant_cash_amount, 0)::numeric * 0.01)
              end
            + coalesce(t.merchant_cash_physical_amount, 0)::numeric
          )
        when coalesce(t.total_paid, 0)::numeric > 0 then round(coalesce(t.total_paid, 0)::numeric)
        else round(coalesce(t.paid, 0)::numeric)
      end as paid_value,
      (
        t.source_service_type = 'payment'
        or (coalesce(t.count, 0)::numeric * coalesce(t.price, 0)::numeric) <= 0
      ) as is_payment
    from public.transactions t
    where t.agent_id = p_agent_id
      and t.cancelled_at is null
  ), ledger as (
    select
      currency,
      case when is_payment then 0::numeric else service_value end as debit,
      case
        when is_payment then case when paid_value <> 0 then paid_value else service_value end
        else paid_value
      end as credit
    from base
  )
  select
    currency,
    coalesce(sum(debit), 0)::numeric as debit,
    coalesce(sum(credit), 0)::numeric as credit,
    coalesce(sum(debit - credit), 0)::numeric as balance,
    count(*)::bigint as row_count
  from ledger
  group by currency
  order by currency;
$$;

create or replace function public.financial_company_balance_v2(p_company_id uuid)
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
      public.financial_single_split_currency_v2('company_transactions', t.id, t.currency) as currency,
      round(coalesce(t.trip_value, 0)::numeric) as debit,
      round(coalesce(t.total_paid, 0)::numeric) as credit
    from public.company_transactions t
    where t.company_id = p_company_id
      and t.cancelled_at is null
  )
  select
    currency,
    coalesce(sum(debit), 0)::numeric as debit,
    coalesce(sum(credit), 0)::numeric as credit,
    coalesce(sum(debit - credit), 0)::numeric as balance,
    count(*)::bigint as row_count
  from ledger
  group by currency
  order by currency;
$$;

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
    return query
      select a.currency, a.debit, a.credit, a.balance, a.row_count, 'canonical_agent_v2'::text
      from public.financial_agent_balance_v2(p_party_id) a;
  elsif p_party_type = 'company' then
    return query
      select c.currency, c.debit, c.credit, c.balance, c.row_count, 'canonical_company_v2'::text
      from public.financial_company_balance_v2(p_party_id) c;
  else
    raise exception 'FINANCIAL_ENGINE_NOT_MIGRATED: party_type % is not yet available in canonical v2', p_party_type;
  end if;
end;
$$;

revoke all on function public.financial_single_split_currency_v2(text, uuid, text) from public;
revoke all on function public.financial_agent_balance_v2(uuid) from public;
revoke all on function public.financial_company_balance_v2(uuid) from public;
revoke all on function public.financial_entity_balance_v2(text, uuid) from public;

grant execute on function public.financial_single_split_currency_v2(text, uuid, text) to authenticated, service_role;
grant execute on function public.financial_agent_balance_v2(uuid) to authenticated, service_role;
grant execute on function public.financial_company_balance_v2(uuid) to authenticated, service_role;
grant execute on function public.financial_entity_balance_v2(text, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
