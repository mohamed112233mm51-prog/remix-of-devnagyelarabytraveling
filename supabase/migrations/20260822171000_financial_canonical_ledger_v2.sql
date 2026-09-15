-- Financial Scalability Hardening v2.4 (parallel only)
-- Canonical paginated ledgers for agent/company/currency_supplier/merchant.
-- Full-history running balance is calculated in PostgreSQL, then page slicing is applied.
-- This migration is READ ONLY with respect to financial history.

create or replace function public.financial_entity_ledger_page_v2(
  p_party_type text,
  p_party_id uuid,
  p_currency text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  row_key text,
  source_table text,
  source_id uuid,
  accounting_date date,
  created_at timestamptz,
  currency text,
  debit numeric,
  credit numeric,
  delta numeric,
  running_balance numeric,
  total_count bigint,
  row_kind text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_party_type = 'agent' then
    return query
    with base as (
      select
        ('transactions:' || t.id::text) as row_key,
        'transactions'::text as source_table,
        t.id as source_id,
        coalesce(t.date, t.created_at::date) as accounting_date,
        t.created_at,
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
        (t.source_service_type = 'payment' or (coalesce(t.count, 0)::numeric * coalesce(t.price, 0)::numeric) <= 0) as is_payment
      from public.transactions t
      where t.agent_id = p_party_id and t.cancelled_at is null
    ), rows_ as (
      select
        b.row_key, b.source_table, b.source_id, b.accounting_date, b.created_at, b.currency,
        case when b.is_payment then 0::numeric else b.service_value end as debit,
        case when b.is_payment then case when b.paid_value <> 0 then b.paid_value else b.service_value end else b.paid_value end as credit,
        case when b.is_payment then 'payment'::text else 'service'::text end as row_kind
      from base b
    ), filtered as (
      select r.*, (r.debit - r.credit) as delta
      from rows_ r
      where (p_currency is null or r.currency = public.financial_normalize_currency_v2(p_currency))
        and (p_from is null or r.accounting_date >= p_from)
        and (p_to is null or r.accounting_date <= p_to)
    ), enriched as (
      select f.*,
        sum(f.delta) over (partition by f.currency order by f.accounting_date, f.created_at, f.source_id rows between unbounded preceding and current row) as running_balance,
        count(*) over () as total_count
      from filtered f
    )
    select e.row_key,e.source_table,e.source_id,e.accounting_date,e.created_at,e.currency,e.debit,e.credit,e.delta,e.running_balance,e.total_count,e.row_kind
    from enriched e
    order by e.accounting_date desc, e.created_at desc, e.source_id desc
    limit greatest(1, least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0);

  elsif p_party_type = 'company' then
    return query
    with rows_ as (
      select
        ('company_transactions:' || t.id::text) as row_key,
        'company_transactions'::text as source_table,
        t.id as source_id,
        coalesce(t.date, t.created_at::date) as accounting_date,
        t.created_at,
        public.financial_single_split_currency_v2('company_transactions', t.id, t.currency) as currency,
        round(coalesce(t.trip_value,0)::numeric) as debit,
        round(coalesce(t.total_paid,0)::numeric) as credit,
        case when round(coalesce(t.trip_value,0)::numeric) > 0 then 'service'::text else 'payment'::text end as row_kind
      from public.company_transactions t
      where t.company_id = p_party_id and t.cancelled_at is null
    ), filtered as (
      select r.*, (r.debit-r.credit) as delta
      from rows_ r
      where (p_currency is null or r.currency = public.financial_normalize_currency_v2(p_currency))
        and (p_from is null or r.accounting_date >= p_from)
        and (p_to is null or r.accounting_date <= p_to)
    ), enriched as (
      select f.*,
        sum(f.delta) over (partition by f.currency order by f.accounting_date, f.created_at, f.source_id rows between unbounded preceding and current row) as running_balance,
        count(*) over () as total_count
      from filtered f
    )
    select e.row_key,e.source_table,e.source_id,e.accounting_date,e.created_at,e.currency,e.debit,e.credit,e.delta,e.running_balance,e.total_count,e.row_kind
    from enriched e
    order by e.accounting_date desc,e.created_at desc,e.source_id desc
    limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0);

  elsif p_party_type = 'currency_supplier' then
    return query
    with rows_ as (
      select
        ('currency_supplier_transactions:' || t.id::text) as row_key,
        'currency_supplier_transactions'::text as source_table,
        t.id as source_id,
        coalesce(t.tx_date, t.created_at::date) as accounting_date,
        t.created_at,
        case
          when t.tx_type in ('شراء عملة','بيع عملة') then 'EGP'
          when t.tx_type = 'دفع نقدية' then public.financial_normalize_currency_v2(t.sold_currency)
          when t.tx_type = 'استلام نقدية' then public.financial_normalize_currency_v2(t.bought_currency)
          else public.financial_normalize_currency_v2(coalesce(t.opening_currency,t.bought_currency))
        end as currency,
        case
          when t.tx_type = 'شراء عملة' then coalesce((select sum(coalesce((x->>'amount')::numeric,0)) from jsonb_array_elements(coalesce(t.payment_splits::jsonb,'[]'::jsonb)) x),0) - coalesce(t.sold_amount,0)::numeric
          when t.tx_type = 'بيع عملة' then coalesce(t.bought_amount,0)::numeric - coalesce((select sum(coalesce((x->>'amount')::numeric,0)) from jsonb_array_elements(coalesce(t.payment_splits::jsonb,'[]'::jsonb)) x),0)
          when t.tx_type = 'دفع نقدية' then coalesce(t.sold_amount,0)::numeric
          when t.tx_type = 'استلام نقدية' then -coalesce(t.bought_amount,0)::numeric
          else coalesce(t.bought_amount,0)::numeric - coalesce(t.sold_amount,0)::numeric
        end as delta,
        t.tx_type::text as row_kind
      from public.currency_supplier_transactions t
      where t.supplier_id = p_party_id and t.cancelled_at is null
    ), filtered as (
      select r.*,
        case when r.delta > 0 then r.delta else 0 end::numeric as debit,
        case when r.delta < 0 then -r.delta else 0 end::numeric as credit
      from rows_ r
      where (p_currency is null or r.currency = public.financial_normalize_currency_v2(p_currency))
        and (p_from is null or r.accounting_date >= p_from)
        and (p_to is null or r.accounting_date <= p_to)
    ), enriched as (
      select f.*,
        sum(f.delta) over (partition by f.currency order by f.accounting_date,f.created_at,f.source_id rows between unbounded preceding and current row) as running_balance,
        count(*) over () as total_count
      from filtered f
    )
    select e.row_key,e.source_table,e.source_id,e.accounting_date,e.created_at,e.currency,e.debit,e.credit,e.delta,e.running_balance,e.total_count,e.row_kind
    from enriched e
    order by e.accounting_date desc,e.created_at desc,e.source_id desc
    limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0);

  elsif p_party_type = 'merchant' then
    return query
    with company_out_source_ids as (
      select t.source_service_id
      from public.transactions t
      where t.merchant_id = p_party_id and t.source_service_type = 'merchant_cash_out_to_company'
        and t.cancelled_at is null and t.source_service_id is not null
    ), rows_ as (
      select
        ('transactions:' || t.id::text) as row_key,'transactions'::text as source_table,t.id as source_id,
        coalesce(t.date,t.created_at::date) as accounting_date,t.created_at,
        public.financial_normalize_currency_v2(coalesce(t.payment_currency,t.currency,'EGP')) as currency,
        case
          when t.source_service_type='merchant_cash_out' then abs(coalesce(t.paid,0)::numeric)
          when t.source_service_type in ('merchant_cash_out_to_company','merchant_cash_out_to_agent') then -abs(coalesce(t.paid,0)::numeric)
          else (case when coalesce(t.merchant_cash_net_amount,0)::numeric>0 then round(coalesce(t.merchant_cash_net_amount,0)::numeric)
                     else round(coalesce(t.merchant_cash_amount,0)::numeric-coalesce(t.merchant_cash_amount,0)::numeric*0.01) end)
               + coalesce(t.merchant_cash_physical_amount,0)::numeric
        end as delta,
        coalesce(t.source_service_type,'transaction')::text as row_kind
      from public.transactions t
      where t.merchant_id=p_party_id and t.cancelled_at is null
      union all
      select
        ('company_transactions:' || c.id::text),'company_transactions',c.id,
        coalesce(c.date,c.created_at::date),c.created_at,
        public.financial_normalize_currency_v2(coalesce(c.payment_currency,c.currency,'EGP')),
        -round(abs(coalesce(nullif(coalesce(c.merchant_cash_net_amount,0)::numeric,0),coalesce(c.merchant_cash_amount,0)::numeric,0))+abs(coalesce(c.merchant_cash_physical_amount,0)::numeric)),
        'company_outflow'
      from public.company_transactions c
      where c.merchant_id=p_party_id and c.cancelled_at is null
        and not exists(select 1 from company_out_source_ids x where x.source_service_id=c.id::text)
      union all
      select
        ('merchant_cash_collections:' || mc.id::text),'merchant_cash_collections',mc.id,
        coalesce(mc.date,mc.created_at::date),mc.created_at,
        public.financial_normalize_currency_v2(coalesce(mc.opening_currency,'EGP')),
        -coalesce(mc.amount,0)::numeric,
        coalesce(mc.source_service_type,'collection')::text
      from public.merchant_cash_collections mc
      where mc.merchant_id=p_party_id and mc.cancelled_at is null
      union all
      select
        ('usd_treasury_transactions:' || u.id::text),'usd_treasury_transactions',u.id,
        coalesce(u.date,u.created_at::date),u.created_at,'EGP',-coalesce(u.egp_amount,0)::numeric,'conversion'
      from public.usd_treasury_transactions u
      where u.merchant_id=p_party_id and u.cancelled_at is null and u.type='conversion'
        and u.source_type in ('merchant_wallet','merchant_physical')
    ), filtered as (
      select r.*,
        case when r.delta < 0 then -r.delta else 0 end::numeric as debit,
        case when r.delta > 0 then r.delta else 0 end::numeric as credit
      from rows_ r
      where (p_currency is null or r.currency=public.financial_normalize_currency_v2(p_currency))
        and (p_from is null or r.accounting_date>=p_from)
        and (p_to is null or r.accounting_date<=p_to)
    ), enriched as (
      select f.*,
        sum(f.delta) over (partition by f.currency order by f.accounting_date,f.created_at,f.source_table,f.source_id rows between unbounded preceding and current row) as running_balance,
        count(*) over () as total_count
      from filtered f
    )
    select e.row_key,e.source_table,e.source_id,e.accounting_date,e.created_at,e.currency,e.debit,e.credit,e.delta,e.running_balance,e.total_count,e.row_kind
    from enriched e
    order by e.accounting_date desc,e.created_at desc,e.source_table desc,e.source_id desc
    limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0);

  else
    raise exception 'FINANCIAL_LEDGER_NOT_MIGRATED: party_type % is not yet available in canonical ledger v2', p_party_type;
  end if;
end;
$$;

revoke all on function public.financial_entity_ledger_page_v2(text,uuid,text,date,date,integer,integer) from public;
grant execute on function public.financial_entity_ledger_page_v2(text,uuid,text,date,date,integer,integer) to authenticated,service_role;

notify pgrst,'reload schema';
