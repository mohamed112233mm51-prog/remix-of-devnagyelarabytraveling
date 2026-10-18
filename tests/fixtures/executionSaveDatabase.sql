CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION public.app_permission_allowed(section text, action text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('test.execution_'||action,true),'true')='true' $$;
CREATE TABLE public.executions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "submission_id" uuid,
  "passenger_name" text NOT NULL,
  "national_id" text,
  "dob" date,
  "passport" text,
  "birth_place" text,
  "agent_id" uuid,
  "status" text DEFAULT 'بطيء'::text NOT NULL,
  "departure_from" text,
  "destination" text,
  "airline" text,
  "travel_date" date,
  "notes" text,
  "services" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_demo" bool DEFAULT false NOT NULL,
  "operation_status" text DEFAULT 'قيد التنفيذ'::text NOT NULL,
  "approval_company_id" uuid,
  "passenger_type" text,
  "approval_validity_enabled" bool DEFAULT false,
  "issue_date" date,
  "fx_locks" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "fx_locked_at" timestamptz,
  "financial_posting_date" date
);
CREATE TABLE public.submissions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "services" text[] DEFAULT '{}'::text[] NOT NULL,
  "passenger_name" text NOT NULL,
  "national_id" text,
  "dob" date,
  "passport" text,
  "birth_place" text,
  "agent_id" uuid,
  "status" text DEFAULT 'بطيء'::text NOT NULL,
  "departure_from" text,
  "submit_date" date,
  "issue_date" date,
  "approval_authority" text,
  "notes" text,
  "executed_at" timestamptz,
  "execution_id" uuid,
  "is_demo" bool DEFAULT false NOT NULL,
  "operation_status" text DEFAULT 'قيد المتابعة'::text NOT NULL,
  "approval_company_id" uuid,
  "approval_validity_enabled" bool DEFAULT false NOT NULL,
  "passenger_type" text
);
CREATE TABLE public.transactions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "agent_id" uuid,
  "date" date DEFAULT CURRENT_DATE NOT NULL,
  "destination" text,
  "count" int4 DEFAULT 1 NOT NULL,
  "price" numeric DEFAULT 0 NOT NULL,
  "paid" numeric DEFAULT 0 NOT NULL,
  "payment_method" text DEFAULT 'نقدي'::text NOT NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "travel_statement" text,
  "instapay_amount" numeric DEFAULT 0 NOT NULL,
  "cash_amount" numeric DEFAULT 0 NOT NULL,
  "mobile_cash_amount" numeric DEFAULT 0 NOT NULL,
  "mobile_cash_net_amount" numeric DEFAULT 0 NOT NULL,
  "total_paid" numeric DEFAULT 0 NOT NULL,
  "arabic_tourism_cash_amount" numeric DEFAULT 0 NOT NULL,
  "arabic_tourism_cash_net_amount" numeric DEFAULT 0 NOT NULL,
  "merchant_cash_amount" numeric DEFAULT 0 NOT NULL,
  "merchant_cash_net_amount" numeric DEFAULT 0 NOT NULL,
  "service_type" text,
  "merchant_cash_physical_amount" numeric DEFAULT 0 NOT NULL,
  "merchant_id" uuid,
  "is_demo" bool DEFAULT false NOT NULL,
  "source_service_id" text,
  "source_service_type" text,
  "statement" text,
  "currency" text DEFAULT 'EGP'::text NOT NULL,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text
);
CREATE TABLE public.company_transactions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "company_id" uuid NOT NULL,
  "date" date DEFAULT CURRENT_DATE NOT NULL,
  "destination" text,
  "count" int4 DEFAULT 1 NOT NULL,
  "price" numeric DEFAULT 0 NOT NULL,
  "trip_value" numeric DEFAULT 0 NOT NULL,
  "instapay_amount" numeric DEFAULT 0 NOT NULL,
  "cash_amount" numeric DEFAULT 0 NOT NULL,
  "mobile_cash_amount" numeric DEFAULT 0 NOT NULL,
  "mobile_cash_net_amount" numeric DEFAULT 0 NOT NULL,
  "total_paid" numeric DEFAULT 0 NOT NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "arabic_tourism_cash_amount" numeric DEFAULT 0 NOT NULL,
  "arabic_tourism_cash_net_amount" numeric DEFAULT 0 NOT NULL,
  "merchant_cash_amount" numeric DEFAULT 0 NOT NULL,
  "merchant_cash_net_amount" numeric DEFAULT 0 NOT NULL,
  "service_type" text,
  "merchant_cash_physical_amount" numeric DEFAULT 0 NOT NULL,
  "merchant_id" uuid,
  "is_demo" bool DEFAULT false NOT NULL,
  "source_service_id" text,
  "source_service_type" text,
  "usd_amount" numeric DEFAULT 0 NOT NULL,
  "exchange_rate_used" numeric,
  "payment_currency" text,
  "statement" text,
  "currency" text DEFAULT 'EGP'::text NOT NULL,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text
);
CREATE TABLE public.financial_operation_requests (
  "operation_id" uuid NOT NULL PRIMARY KEY,
  "fingerprint" text NOT NULL,
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid DEFAULT auth.uid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE public.financial_audit_log (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "table_name" text NOT NULL,
  "record_id" uuid NOT NULL,
  "action" text NOT NULL,
  "reason" text,
  "reference_no" text,
  "entity_type" text,
  "entity_id" uuid,
  "before_value" jsonb,
  "after_value" jsonb,
  "performed_by" uuid,
  "performed_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE public.payment_splits(id uuid PRIMARY KEY,source_table text,source_id uuid,amount numeric);
ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['executions','submissions','transactions','company_transactions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY read_rows ON public.%I FOR SELECT TO authenticated USING(true)',t);
 IF t IN ('executions','submissions') THEN
 EXECUTE format('CREATE POLICY insert_rows ON public.%I FOR INSERT TO authenticated WITH CHECK(public.app_permission_allowed(''executions'',''create''))',t);
 EXECUTE format('CREATE POLICY update_rows ON public.%I FOR UPDATE TO authenticated USING(public.app_permission_allowed(''executions'',''edit'')) WITH CHECK(public.app_permission_allowed(''executions'',''edit''))',t);
 EXECUTE format('CREATE POLICY delete_rows ON public.%I FOR DELETE TO authenticated USING(public.app_permission_allowed(''executions'',''delete''))',t);
 ELSE
 EXECUTE format('CREATE POLICY insert_rows ON public.%I FOR INSERT TO authenticated WITH CHECK(public.app_permission_allowed(''executions'',''edit''))',t);
 EXECUTE format('CREATE POLICY delete_rows ON public.%I FOR DELETE TO authenticated USING(public.app_permission_allowed(''executions'',''edit''))',t);
 END IF;
 END LOOP; END $$;
ALTER TABLE public.financial_operation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY requests_read ON public.financial_operation_requests FOR SELECT TO authenticated USING(created_by=auth.uid());
CREATE POLICY requests_insert ON public.financial_operation_requests FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid());
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON public.financial_audit_log FOR INSERT TO authenticated WITH CHECK(performed_by=auth.uid() AND COALESCE(current_setting('test.can_audit',true),'true')='true');
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
