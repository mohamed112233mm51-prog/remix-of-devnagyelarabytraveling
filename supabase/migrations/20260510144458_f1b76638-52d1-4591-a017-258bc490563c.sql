-- Expenses tables
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_name text NOT NULL,
  expense_type text NOT NULL DEFAULT 'متغير',
  amount numeric NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'نقدي',
  notes text,
  auto_deduct_enabled boolean NOT NULL DEFAULT false,
  auto_deduct_day integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.expenses FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.expense_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  deduction_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'مكتمل',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_deductions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.expense_deductions FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_deductions;

-- Auto-deduct cron: daily check for fixed expenses with auto_deduct_day = today, no deduction yet this month
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.run_auto_expense_deductions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.expense_deductions (expense_id, deduction_date, amount, status)
  SELECT e.id, CURRENT_DATE, e.amount, 'مكتمل'
  FROM public.expenses e
  WHERE e.expense_type = 'ثابت'
    AND e.auto_deduct_enabled = true
    AND e.auto_deduct_day = EXTRACT(DAY FROM CURRENT_DATE)::int
    AND NOT EXISTS (
      SELECT 1 FROM public.expense_deductions d
      WHERE d.expense_id = e.id
        AND date_trunc('month', d.deduction_date) = date_trunc('month', CURRENT_DATE)
    );
END;
$$;

SELECT cron.schedule(
  'auto-expense-deductions-daily',
  '0 1 * * *',
  $$SELECT public.run_auto_expense_deductions();$$
);
