-- Financial Scalability Hardening v2.2 (parallel only)
-- Canonical merchant balance calculated from full historical parent tables.
-- Mirrors the currently-proven merchant guard formula. No UI cutover here.
-- No financial row is updated/deleted/backfilled.

create or replace function public.financial_normalize_currency_v2(p_currency text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when btrim(coalesce(p_currency, '')) = '' then 'EGP'
    when btrim(p_currency) in ('USD','دولار','دولار أمريكي','$') then 'USD'
    when btrim(p_currency) in ('LYD','دينار ليبي','دينار','د.ل') then 'LYD'
    when btrim(p_currency) in ('EGP','جنيه مصري','جنيه','ج.م') then 'EGP'
    else upper(btrim(p_currency))
  end;
$$;

create or replace function public.financial_merchant_balance_v2(p_merchant_id uuid)
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
  with company_out_source_ids as (
    select t.source_service_id
    from public.transactions t
    where t.merchant_id = p_merchant_id
      and t.source_service_type = 'merchant_cash_out_to_company'
      and t.cancelled_at is null
      and t.source_service_id is not null
  ), movements as (
    -- transactions: incoming from agents + explicit merchant cash movements.
    select
      public.financial_normalize_currency_v2(coalesce(t.payment_currency, t.currency, 'EGP')) as currency,
      case
        when t.source_service_type = 'merchant_cash_out'
          then abs(coalesce(t.paid, 0)::numeric)
        when t.source_service_type in ('merchant_cash_out_to_company','merchant_cash_out_to_agent')
          then -abs(coalesce(t.paid, 0)::numeric)
        else
          (
            case
              when coalesce(t.merchant_cash_net_amount, 0)::numeric > 0
                then round(coalesce(t.merchant_cash_net_amount, 0)::numeric)
              else round(
                coalesce(t.merchant_cash_amount, 0)::numeric
                - coalesce(t.merchant_cash_amount, 0)::numeric * 0.01
              )
            end
          ) + coalesce(t.merchant_cash_physical_amount, 0)::numeric
      end as delta,
      1::bigint as n
    from public.transactions t
    where t.merchant_id = p_merchant_id
      and t.cancelled_at is null

    union all

    -- company_transactions: merchant-funded company outflows not already represented
    -- by a linked transactions row, preventing double-counting.
    select
      public.financial_normalize_currency_v2(coalesce(c.payment_currency, c.currency, 'EGP')) as currency,
      -round(
        abs(
          coalesce(
            nullif(coalesce(c.merchant_cash_net_amount, 0)::numeric, 0),
            coalesce(c.merchant_cash_amount, 0)::numeric,
            0
          )
        )
        + abs(coalesce(c.merchant_cash_physical_amount, 0)::numeric)
      ) as delta,
      1::bigint as n
    from public.company_transactions c
    where c.merchant_id = p_merchant_id
      and c.cancelled_at is null
      and not exists (
        select 1
        from company_out_source_ids x
        where x.source_service_id = c.id::text
      )

    union all

    -- Collections reduce merchant wallet balance.
    select
      public.financial_normalize_currency_v2(coalesce(mc.opening_currency, 'EGP')) as currency,
      -coalesce(mc.amount, 0)::numeric as delta,
      1::bigint as n
    from public.merchant_cash_collections mc
    where mc.merchant_id = p_merchant_id
      and mc.cancelled_at is null

    union all

    -- EGP spent to create USD from merchant wallet/physical source.
    select
      'EGP'::text as currency,
      -coalesce(u.egp_amount, 0)::numeric as delta,
      1::bigint as n
    from public.usd_treasury_transactions u
    where u.merchant_id = p_merchant_id
      and u.cancelled_at is null
      and u.type = 'conversion'
      and u.source_type in ('merchant_wallet','merchant_physical')
  ), grouped as (
    select currency, sum(delta)::numeric as balance, sum(n)::bigint as row_count
    from movements
    group by currency
  )
  select
    g.currency,
    case when g.balance < 0 then -g.balance else 0 end::numeric as debit,
    case when g.balance > 0 then g.balance else 0 end::numeric as credit,
    g.balance::numeric,
    g.row_count
  from grouped g
  order by g.currency;
$$;

-- Extend canonical dispatcher with merchant.
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
  elsif p_party_type = 'merchant' then
    return query select m.currency, m.debit, m.credit, m.balance, m.row_count, 'canonical_merchant_v2'::text
      from public.financial_merchant_balance_v2(p_party_id) m;
  else
    raise exception 'FINANCIAL_ENGINE_NOT_MIGRATED: party_type % is not yet available in canonical v2', p_party_type;
  end if;
end;
$$;

revoke all on function public.financial_normalize_currency_v2(text) from public;
revoke all on function public.financial_merchant_balance_v2(uuid) from public;

grant execute on function public.financial_normalize_currency_v2(text) to authenticated, service_role;
grant execute on function public.financial_merchant_balance_v2(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
