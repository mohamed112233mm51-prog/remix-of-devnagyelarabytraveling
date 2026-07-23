
CREATE OR REPLACE FUNCTION public.reset_production_business_data(p_confirm text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean := false;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_deleted jsonb := '{}'::jsonb;
  v_remaining jsonb := '{}'::jsonb;
  v_computed jsonb := '{}'::jsonb;
  v_fk_report jsonb := '[]'::jsonb;
  v_agent_column_report jsonb := '[]'::jsonb;
  v_agent_column_after jsonb := '[]'::jsonb;
  v_identity jsonb := '{}'::jsonb;
  v_count bigint := 0;
  v_existing_deleted bigint := 0;
  v_agents_before bigint := 0;
  v_agents_deleted bigint := 0;
  v_agents_after bigint := 0;
  v_transactions_after bigint := 0;
  v_executions_after bigint := 0;
  v_agent_references_before bigint := 0;
  v_agent_references_after bigint := 0;
  v_remaining_total bigint := 0;
  v_current_table text := '';
  t text;
  r record;
  wipe_tables text[] := ARRAY[
    'payment_splits',
    'financial_audit_log',
    'expense_deductions',
    'expenses',
    'investor_transactions',
    'merchant_cash_collections',
    'currency_supplier_transactions',
    'usd_treasury_transactions',
    'company_transactions',
    'transactions',
    'submissions',
    'executions',
    'company_pricing_rules',
    'activity_logs',
    'import_batches',
    'investors',
    'merchants',
    'currency_suppliers',
    'issuing_companies'
  ];
  preserved_agent_id_tables text[] := ARRAY['profiles'];
  v_err_state text;
  v_err_message text;
  v_err_detail text;
  v_err_hint text;
  v_err_constraint text;
  v_err_table text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: يجب تسجيل الدخول' USING ERRCODE = '28000';
  END IF;

  SELECT public.has_role(p_user_id, 'admin'::public.app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: صلاحيات المسؤول مطلوبة' USING ERRCODE = '42501';
  END IF;

  IF p_confirm IS DISTINCT FROM 'تهيئة الإنتاج نهائياً' THEN
    RAISE EXCEPTION 'CONFIRM_MISMATCH: عبارة التأكيد غير مطابقة' USING ERRCODE = '22023';
  END IF;

  v_identity := jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'request_jwt_role', current_setting('request.jwt.claim.role', true),
    'security', 'SECURITY DEFINER RPC invoked from trusted server client'
  );

  SELECT count(*) INTO v_agents_before FROM public.agents;
  v_before := v_before || jsonb_build_object('agents', v_agents_before, 'agentsBefore', v_agents_before);

  FOREACH t IN ARRAY wipe_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_count;
    v_before := v_before || jsonb_build_object(t, v_count);
  END LOOP;

  FOR r IN
    SELECT con.conname AS constraint_name,
           child.relname::text AS child_table,
           a.attname::text AS child_column,
           CASE con.confdeltype
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
             ELSE con.confdeltype::text
           END AS delete_rule
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = cols.attnum
    WHERE n.nspname = 'public'
      AND con.contype = 'f'
      AND con.confrelid = 'public.agents'::regclass
    ORDER BY child.relname, con.conname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL AND EXISTS (SELECT 1 FROM public.agents a WHERE a.id = c.%I)',
      r.child_table, r.child_column, r.child_column
    ) INTO v_count;
    v_agent_references_before := v_agent_references_before + v_count;
    v_fk_report := v_fk_report || jsonb_build_array(jsonb_build_object(
      'child_table', r.child_table,
      'child_column', r.child_column,
      'constraint_name', r.constraint_name,
      'delete_rule', r.delete_rule,
      'rows_referencing_agents', v_count
    ));
  END LOOP;

  FOR r IN
    SELECT c.table_name::text AS child_table,
           c.column_name::text AS child_column,
           EXISTS (
             SELECT 1
             FROM pg_constraint con
             JOIN pg_class child ON child.oid = con.conrelid
             JOIN pg_namespace n ON n.oid = child.relnamespace
             JOIN unnest(con.conkey) AS cols(attnum) ON true
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = cols.attnum
             WHERE n.nspname = 'public'
               AND con.contype = 'f'
               AND con.confrelid = 'public.agents'::regclass
               AND child.relname = c.table_name
               AND a.attname = c.column_name
           ) AS has_fk
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'agent_id'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL', r.child_table, r.child_column) INTO v_count;
    v_agent_references_before := v_agent_references_before + CASE WHEN r.has_fk THEN 0 ELSE v_count END;
    v_agent_column_report := v_agent_column_report || jsonb_build_array(jsonb_build_object(
      'child_table', r.child_table,
      'child_column', r.child_column,
      'constraint_name', CASE WHEN r.has_fk THEN 'see_foreign_keys' ELSE NULL END,
      'delete_rule', CASE WHEN r.has_fk THEN 'see_foreign_keys' ELSE 'NO FK' END,
      'rows_with_agent_id', v_count
    ));
  END LOOP;

  v_before := v_before || jsonb_build_object('agentReferences', v_agent_references_before);

  EXECUTE 'ALTER TABLE public.payment_splits DISABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.cash_boxes DISABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.issuing_companies DISABLE TRIGGER USER';

  v_current_table := 'payment_splits (agent refs)';
  DELETE FROM public.payment_splits ps
  WHERE ps.transaction_id IN (SELECT tx.id FROM public.transactions tx WHERE tx.agent_id IS NOT NULL)
     OR (
       ps.source_table = 'transactions'
       AND ps.source_id IN (SELECT tx.id FROM public.transactions tx WHERE tx.agent_id IS NOT NULL)
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('payment_splits_agent_refs', v_count);

  FOR r IN
    SELECT c.table_name::text AS child_table,
           c.column_name::text AS child_column
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'agent_id'
    ORDER BY CASE WHEN c.table_name = ANY(preserved_agent_id_tables) THEN 1 ELSE 0 END, c.table_name
  LOOP
    v_current_table := r.child_table || '.' || r.child_column;
    IF r.child_table = ANY(preserved_agent_id_tables) THEN
      EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I IS NOT NULL', r.child_table, r.child_column, r.child_column);
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_deleted := v_deleted || jsonb_build_object(r.child_table || '_agent_id_cleared', v_count);
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE %I IS NOT NULL', r.child_table, r.child_column);
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_existing_deleted := COALESCE((v_deleted->>r.child_table)::bigint, 0);
      v_deleted := v_deleted || jsonb_build_object(r.child_table, v_existing_deleted + v_count);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY wipe_tables LOOP
    v_current_table := t;
    -- WHERE true satisfies Supabase pg_safeupdate extension while still wiping the full table.
    EXECUTE format('DELETE FROM public.%I WHERE true', t);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_existing_deleted := COALESCE((v_deleted->>t)::bigint, 0);
    v_deleted := v_deleted || jsonb_build_object(t, v_existing_deleted + v_count);
  END LOOP;

  v_agent_references_after := 0;
  v_agent_column_after := '[]'::jsonb;
  FOR r IN
    SELECT c.table_name::text AS child_table,
           c.column_name::text AS child_column
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'agent_id'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL', r.child_table, r.child_column) INTO v_count;
    v_agent_references_after := v_agent_references_after + v_count;
    v_agent_column_after := v_agent_column_after || jsonb_build_array(jsonb_build_object(
      'child_table', r.child_table,
      'child_column', r.child_column,
      'rows_with_agent_id_after_child_wipe', v_count
    ));
  END LOOP;

  IF v_agent_references_after <> 0 THEN
    RAISE EXCEPTION 'RESET_AGENT_REFERENCES_REMAIN: %', jsonb_build_object(
      'agentReferencesAfterChildWipe', v_agent_references_after,
      'agent_reference_tables', v_agent_column_after,
      'foreign_keys', v_fk_report
    )::text USING ERRCODE = '23503';
  END IF;

  v_current_table := 'agents';
  DELETE FROM public.agents WHERE true;
  GET DIAGNOSTICS v_agents_deleted = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('agents', v_agents_deleted);

  v_current_table := 'cash_boxes (reset)';
  UPDATE public.cash_boxes
     SET balance = 0,
         opening_balance = 0,
         opening_date = NULL,
         opening_note = NULL,
         updated_at = now()
   WHERE true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('cash_boxes_reset', v_count);

  EXECUTE 'ALTER TABLE public.issuing_companies ENABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.payment_splits ENABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.cash_boxes ENABLE TRIGGER USER';

  SELECT count(*) INTO v_agents_after FROM public.agents;
  SELECT count(*) INTO v_transactions_after FROM public.transactions;
  SELECT count(*) INTO v_executions_after FROM public.executions;

  v_after := v_after || jsonb_build_object('agents', v_agents_after, 'agentsAfter', v_agents_after);
  FOREACH t IN ARRAY wipe_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_count;
    v_after := v_after || jsonb_build_object(t, v_count);
  END LOOP;

  v_agent_references_after := 0;
  v_agent_column_after := '[]'::jsonb;
  FOR r IN
    SELECT c.table_name::text AS child_table,
           c.column_name::text AS child_column
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'agent_id'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL', r.child_table, r.child_column) INTO v_count;
    v_agent_references_after := v_agent_references_after + v_count;
    v_agent_column_after := v_agent_column_after || jsonb_build_array(jsonb_build_object(
      'child_table', r.child_table,
      'child_column', r.child_column,
      'rows_with_agent_id', v_count
    ));
  END LOOP;

  v_remaining := jsonb_build_object(
    'agents', v_agents_after,
    'agentsBefore', v_agents_before,
    'agentsAfter', v_agents_after,
    'transactions', v_transactions_after,
    'executions', v_executions_after,
    'agentReferences', v_agent_references_after
  );

  FOREACH t IN ARRAY wipe_tables LOOP
    v_remaining_total := v_remaining_total + COALESCE((v_after->>t)::bigint, 0);
  END LOOP;
  v_remaining_total := v_remaining_total + v_agents_after + v_agent_references_after;

  v_computed := jsonb_build_object(
    'agentCount', v_agents_after,
    'services', COALESCE((
      SELECT jsonb_object_agg(currency, amount)
      FROM (
        SELECT COALESCE(currency, 'EGP') AS currency,
               SUM(COALESCE(price, 0) * COALESCE(count, 1)) AS amount
        FROM public.transactions
        WHERE cancelled_at IS NULL
          AND agent_id IS NOT NULL
          AND COALESCE(price, 0) <> 0
        GROUP BY COALESCE(currency, 'EGP')
      ) s
      WHERE amount <> 0
    ), '{}'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_object_agg(currency, amount)
      FROM (
        SELECT COALESCE(currency, 'EGP') AS currency,
               SUM(COALESCE(instapay_amount, 0)
                 + COALESCE(cash_amount, 0)
                 + COALESCE(merchant_cash_net_amount, 0)
                 + COALESCE(merchant_cash_physical_amount, 0)) AS amount
        FROM public.transactions
        WHERE cancelled_at IS NULL
          AND agent_id IS NOT NULL
        GROUP BY COALESCE(currency, 'EGP')
      ) p
      WHERE amount <> 0
    ), '{}'::jsonb),
    'due', '{}'::jsonb
  );

  IF (v_agents_before > 0 AND v_agents_after > 0)
     OR v_agents_after <> 0
     OR v_transactions_after <> 0
     OR v_executions_after <> 0
     OR v_agent_references_after <> 0
     OR v_remaining_total <> 0 THEN
    RAISE EXCEPTION 'RESET_VERIFICATION_FAILED: %', jsonb_build_object(
      'success', false,
      'before', v_before,
      'deleted', v_deleted,
      'remaining', v_remaining,
      'remainingTotal', v_remaining_total,
      'tables_after', v_after,
      'foreign_keys', v_fk_report,
      'agent_id_columns_before', v_agent_column_report,
      'agent_id_columns_after', v_agent_column_after,
      'computed', v_computed,
      'connection_identity', v_identity
    )::text USING ERRCODE = '23503';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'before', v_before,
    'deleted', v_deleted,
    'remaining', v_remaining,
    'remainingTotal', v_remaining_total,
    'tables_after', v_after,
    'foreign_keys', v_fk_report,
    'agent_id_columns_before', v_agent_column_report,
    'agent_id_columns_after', v_agent_column_after,
    'computed', v_computed,
    'connection_identity', v_identity
  );
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS
    v_err_state = RETURNED_SQLSTATE,
    v_err_message = MESSAGE_TEXT,
    v_err_detail = PG_EXCEPTION_DETAIL,
    v_err_hint = PG_EXCEPTION_HINT,
    v_err_constraint = CONSTRAINT_NAME,
    v_err_table = TABLE_NAME;
  BEGIN EXECUTE 'ALTER TABLE public.issuing_companies ENABLE TRIGGER USER'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN EXECUTE 'ALTER TABLE public.payment_splits ENABLE TRIGGER USER'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN EXECUTE 'ALTER TABLE public.cash_boxes ENABLE TRIGGER USER'; EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE EXCEPTION 'RESET_FAILED: %', jsonb_build_object(
    'success', false,
    'failedTable', COALESCE(NULLIF(v_err_table, ''), v_current_table),
    'currentStep', v_current_table,
    'postgresCode', v_err_state,
    'message', v_err_message,
    'detail', v_err_detail,
    'hint', v_err_hint,
    'constraint', v_err_constraint,
    'table', COALESCE(NULLIF(v_err_table, ''), v_current_table),
    'agentsBefore', v_agents_before,
    'agentsDeleted', v_agents_deleted,
    'agentsAfter', v_agents_after,
    'remaining', v_remaining,
    'remainingTotal', v_remaining_total,
    'foreign_keys', v_fk_report,
    'agent_id_columns_before', v_agent_column_report,
    'agent_id_columns_after', v_agent_column_after,
    'connection_identity', v_identity
  )::text;
END;
$function$;
