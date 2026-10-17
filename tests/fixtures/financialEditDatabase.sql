CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION public.app_permission_allowed(text,text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('test.can_edit',true),'true')='true'
$$;
CREATE FUNCTION public.app_financial_action_allowed(text,text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.app_permission_allowed($1,$2)
$$;
CREATE TABLE public.cash_boxes(id uuid PRIMARY KEY,name text,currency text,balance numeric DEFAULT 0,is_active boolean DEFAULT true,updated_at timestamptz DEFAULT now());
CREATE TABLE public.merchants(id uuid PRIMARY KEY,merchant_name text,initial_balance numeric DEFAULT 10000);
CREATE TABLE public.expenses(
  id uuid PRIMARY KEY,expense_name text,expense_type text,amount numeric,date date,notes text,statement text,
  currency text DEFAULT 'EGP',auto_deduct_enabled boolean DEFAULT false,auto_deduct_day integer,
  funding_source text,merchant_id uuid,created_at timestamptz DEFAULT now()
);
CREATE TABLE public.expense_deductions(
  id uuid PRIMARY KEY,expense_id uuid REFERENCES public.expenses(id),deduction_date date,amount numeric,
  funding_source text,currency text DEFAULT 'EGP',cancelled_at timestamptz,status text DEFAULT 'مكتمل',
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.merchant_cash_collections(
  id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants(id),expense_id uuid REFERENCES public.expenses(id),
  date date,amount numeric,note text,statement text,opening_currency text DEFAULT 'EGP',
  source_service_type text,source_service_id uuid,cancelled_at timestamptz,created_at timestamptz DEFAULT now()
);
CREATE TABLE public.currency_supplier_transactions(
  id uuid PRIMARY KEY,supplier_id uuid,tx_type text,tx_date date,bought_currency text,bought_amount numeric,
  sold_currency text,sold_amount numeric,exchange_rate numeric,commission_amount numeric DEFAULT 0,created_by uuid,
  payment_splits jsonb DEFAULT '[]',description text,statement text,opening_currency text,cancelled_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.payment_splits(
  id uuid PRIMARY KEY,source_table text,source_id uuid,cash_box_id uuid REFERENCES public.cash_boxes(id),
  method text,currency text,direction text,amount numeric CHECK(amount>0),gross_amount numeric,net_amount numeric,
  merchant_commission_amount numeric DEFAULT 0,created_by uuid,egp_equivalent numeric DEFAULT 0,exchange_rate numeric DEFAULT 1,
  cancelled_at timestamptz,created_at timestamptz DEFAULT now()
);
CREATE TABLE public.financial_operation_requests(operation_id uuid PRIMARY KEY,result jsonb,fingerprint text,created_by uuid);
CREATE TABLE public.financial_audit_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),table_name text,record_id uuid,action text,reason text,performed_by uuid,
  before_value jsonb,after_value jsonb,entity_type text,entity_id uuid,reference_no text,performed_at timestamptz DEFAULT now()
);
CREATE FUNCTION public.merchant_available_balance(uuid,text) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT m.initial_balance-COALESCE((SELECT SUM(c.amount) FROM public.merchant_cash_collections c
    WHERE c.merchant_id=m.id AND upper(c.opening_currency)=upper($2) AND c.cancelled_at IS NULL),0)
  FROM public.merchants m WHERE m.id=$1
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['expenses','expense_deductions','currency_supplier_transactions','payment_splits','merchant_cash_collections'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY read_rows ON public.%I FOR SELECT TO authenticated USING(true)',t);
    IF t <> 'merchant_cash_collections' THEN
      EXECUTE format('CREATE POLICY edit_rows ON public.%I FOR UPDATE TO authenticated USING(public.app_permission_allowed(''test'',''edit'')) WITH CHECK(public.app_permission_allowed(''test'',''edit''))',t);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON public.financial_audit_log FOR INSERT TO authenticated
  WITH CHECK(COALESCE(current_setting('test.can_audit',true),'true')='true');
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT ON public.financial_audit_log TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
