-- Read-only pagination over the existing canonical cash ledger.
-- No balances, ledger rows, RLS policies or financial write paths are changed.
CREATE INDEX IF NOT EXISTS payment_splits_treasury_history_idx
ON public.payment_splits (cash_box_id, created_at DESC, id DESC)
WHERE cancelled_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_treasury_ledger_page(
  p_box_ids uuid[],
  p_scope text DEFAULT 'current',
  p_month text DEFAULT NULL,
  p_page integer DEFAULT 0,
  p_box_id uuid DEFAULT NULL,
  p_direction text DEFAULT NULL,
  p_search text DEFAULT '',
  p_operations boolean DEFAULT false,
  p_kind text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_current text := to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM');
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.app_permission_allowed('reports','view') THEN
    RAISE EXCEPTION 'ليس لديك صلاحية عرض تقارير الخزائن' USING ERRCODE='42501';
  END IF;
  IF p_scope NOT IN ('current','archive','upcoming','undated')
    OR (p_month IS NOT NULL AND p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    OR COALESCE(p_page,0)<0 OR COALESCE(array_length(p_box_ids,1),0)>100 THEN
    RAISE EXCEPTION 'بيانات فترة سجل الخزائن غير صالحة';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT s.id,s.cash_box_id,s.amount,s.currency,s.direction,s.method,s.source_table,s.source_id,s.created_at,
      c.name AS box_name,COALESCE(c.balance,0) AS current_balance,
      to_char(s.created_at AT TIME ZONE 'Africa/Cairo','YYYY-MM') AS month_key
    FROM public.payment_splits s JOIN public.cash_boxes c ON c.id=s.cash_box_id
    WHERE s.cancelled_at IS NULL AND s.cash_box_id=ANY(COALESCE(p_box_ids,'{}'::uuid[]))
  ), history AS (
    -- Compute BEFORE scope, direction, search and page filters. This is the
    -- existing reverse-from-current-balance calculation, in numeric precision.
    SELECT b.*, current_balance - COALESCE(sum(
      abs(COALESCE(amount,0))*CASE WHEN direction='out' THEN -1 ELSE 1 END
    ) OVER (PARTITION BY cash_box_id ORDER BY created_at DESC NULLS LAST,id DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS balance_after
    FROM base b
  ), movements AS MATERIALIZED (
    SELECT h.*,
      CASE WHEN source_table='cash_box_transfer' THEN
        CASE WHEN p_operations THEN 'transfer' WHEN direction='in' THEN 'transfer_in' ELSE 'transfer_out' END
      WHEN source_table='cash_transfers' AND method LIKE 'تسوية%' THEN
        CASE WHEN direction='in' THEN 'settlement_in' ELSE 'settlement_out' END
      WHEN direction='in' THEN 'in' ELSE 'out' END AS kind
    FROM history h
    WHERE NOT p_operations OR
      (source_table='cash_transfers' AND method LIKE 'تسوية%') OR
      (source_table='cash_box_transfer' AND (direction='out' OR NOT EXISTS (
        SELECT 1 FROM base q WHERE q.source_table='cash_box_transfer' AND q.source_id=h.source_id AND q.direction='out'
      )))
  ), scoped AS (
    SELECT m.* FROM movements m WHERE
      (CASE p_scope WHEN 'current' THEN month_key=v_current WHEN 'archive' THEN month_key<v_current
        WHEN 'upcoming' THEN month_key>v_current ELSE month_key IS NULL END)
      AND (NULLIF(p_month,'') IS NULL OR month_key=p_month)
  ), named AS (
    SELECT s.*,
      CASE kind WHEN 'transfer' THEN 'تحويل بين الخزائن'
        WHEN 'transfer_in' THEN 'تحويل وارد من خزنة' WHEN 'transfer_out' THEN 'تحويل صادر إلى خزنة'
        WHEN 'settlement_in' THEN 'تسوية زيادة خزنة' WHEN 'settlement_out' THEN 'تسوية عجز خزنة'
        WHEN 'in' THEN 'وارد للخزنة' ELSE 'صادر من الخزنة' END AS type_label,
      CASE WHEN s.direction='in' THEN 'وارد' ELSE 'صادر' END AS direction_label,
      CASE s.source_table WHEN 'transactions' THEN 'حركة وكيل' WHEN 'company_transactions' THEN 'حركة شركة صادرة'
        WHEN 'expenses' THEN 'مصروف' WHEN 'expense_deductions' THEN 'مصروف'
        WHEN 'currency_supplier_transactions' THEN 'حركة مورد عملة' WHEN 'investor_transactions' THEN 'حركة مالك / مستثمر'
        WHEN 'merchant_cash_collections' THEN 'حركة تاجر كاش' WHEN 'usd_treasury_transactions' THEN 'حركة خزينة دولارية'
        WHEN 'cash_box_transfer' THEN 'تحويل بين الخزائن' WHEN 'cash_transfers' THEN 'تسوية خزنة' ELSE 'حركة مالية' END AS source_label,
      CASE WHEN s.source_table='cash_box_transfer' THEN COALESCE(peer.name,'خزنة أخرى')
        WHEN s.source_table='cash_transfers' THEN 'تسوية الخزنة'
        ELSE COALESCE(NULLIF(a.name,''),NULLIF(co.company_name,''),NULLIF(me.merchant_name,''),
          NULLIF(su.name,''),NULLIF(iv.investor_name,''),NULLIF(uc.company_name,''),NULLIF(um.merchant_name,''),
          NULLIF(ex.expense_name,''),NULLIF(dx.expense_name,'')) END AS party_name,
      peer.cash_box_id AS peer_id,peer.name AS peer_name
    FROM scoped s
    LEFT JOIN public.transactions t ON s.source_table='transactions' AND t.id=s.source_id
    LEFT JOIN public.agents a ON a.id=t.agent_id
    LEFT JOIN public.company_transactions ct ON s.source_table='company_transactions' AND ct.id=s.source_id
    LEFT JOIN public.issuing_companies co ON co.id=ct.company_id
    LEFT JOIN public.merchant_cash_collections mc ON s.source_table='merchant_cash_collections' AND mc.id=s.source_id
    LEFT JOIN public.merchants me ON me.id=mc.merchant_id
    LEFT JOIN public.currency_supplier_transactions st ON s.source_table='currency_supplier_transactions' AND st.id=s.source_id
    LEFT JOIN public.currency_suppliers su ON su.id=st.supplier_id
    LEFT JOIN public.investor_transactions it ON s.source_table='investor_transactions' AND it.id=s.source_id
    LEFT JOIN public.investors iv ON iv.id=it.investor_id
    LEFT JOIN public.usd_treasury_transactions ut ON s.source_table='usd_treasury_transactions' AND ut.id=s.source_id
    LEFT JOIN public.issuing_companies uc ON uc.id=ut.company_id
    LEFT JOIN public.merchants um ON um.id=ut.merchant_id
    LEFT JOIN public.expenses ex ON s.source_table='expenses' AND ex.id=s.source_id
    LEFT JOIN public.expense_deductions ed ON s.source_table='expense_deductions' AND ed.id=s.source_id
    LEFT JOIN public.expenses dx ON dx.id=ed.expense_id
    LEFT JOIN LATERAL (
      SELECT q.cash_box_id,c.name FROM public.payment_splits q JOIN public.cash_boxes c ON c.id=q.cash_box_id
      WHERE s.source_table='cash_box_transfer' AND q.source_table=s.source_table AND q.source_id=s.source_id
        AND q.id<>s.id AND q.cash_box_id<>s.cash_box_id AND q.cancelled_at IS NULL
      ORDER BY q.created_at,q.id LIMIT 1
    ) peer ON true
  ), filtered AS MATERIALIZED (
    SELECT n.* FROM named n
    WHERE (p_box_id IS NULL OR cash_box_id=p_box_id OR (p_operations AND peer_id=p_box_id))
      AND (NULLIF(p_direction,'') IS NULL OR direction=p_direction)
      AND (NULLIF(p_kind,'') IS NULL OR kind=p_kind)
      AND (COALESCE(btrim(p_search),'')='' OR strpos(lower(concat_ws(' ',box_name,type_label,direction_label,
        COALESCE(party_name,source_label),method,source_label,currency,amount::text,balance_after::text,peer_name)),
        lower(btrim(p_search)))>0)
  ), meta AS (
    SELECT count(*) AS total,LEAST(COALESCE(p_page,0),GREATEST((count(*)-1)/50,0))::integer AS page FROM filtered
  ), page_rows AS (
    SELECT * FROM filtered ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 50 OFFSET (SELECT page*50 FROM meta)
  )
  SELECT jsonb_build_object(
    'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'cashBoxId',cash_box_id,'cashBoxName',box_name,'performedAt',created_at,
      'kind',kind,'type',type_label,'directionLabel',direction_label,'direction',direction,
      'amount',abs(amount),'currency',currency,'counterparty',COALESCE(party_name,source_label),
      'details',COALESCE(NULLIF(method,''),source_label),'balanceAfter',balance_after,
      'from',CASE WHEN source_table='cash_box_transfer' AND direction='in' THEN COALESCE(peer_name,'خزنة أخرى')
        WHEN direction='out' THEN box_name ELSE 'تسوية الخزنة' END,
      'to',CASE WHEN source_table='cash_box_transfer' AND direction='out' THEN COALESCE(peer_name,'خزنة أخرى')
        WHEN direction='in' THEN box_name ELSE 'تسوية الخزنة' END
    ) ORDER BY created_at DESC NULLS LAST,id DESC) FROM page_rows),'[]'::jsonb),
    'total',(SELECT total FROM meta),'page',(SELECT page FROM meta),'pageSize',50,
    'months',COALESCE((SELECT jsonb_agg(month_key ORDER BY month_key DESC) FROM
      (SELECT DISTINCT month_key FROM movements WHERE month_key<v_current) mo),'[]'::jsonb),
    'currentCount',(SELECT count(*) FROM movements WHERE month_key=v_current),
    'archivedCount',(SELECT count(*) FROM movements WHERE month_key<v_current),
    'upcomingCount',(SELECT count(*) FROM movements WHERE month_key>v_current),
    'undatedCount',(SELECT count(*) FROM movements WHERE month_key IS NULL)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_treasury_ledger_page(uuid[],text,text,integer,uuid,text,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_treasury_ledger_page(uuid[],text,text,integer,uuid,text,text,boolean,text) TO authenticated;
