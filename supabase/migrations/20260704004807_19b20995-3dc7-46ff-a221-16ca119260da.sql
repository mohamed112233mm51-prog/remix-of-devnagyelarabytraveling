CREATE OR REPLACE FUNCTION public.enforce_cash_box_non_negative_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old numeric := COALESCE(OLD.balance, 0);
  v_new numeric := COALESCE(NEW.balance, 0);
  v_delta numeric := v_old - v_new;      -- positive => outflow, negative => inflow
  v_shortfall numeric;
  v_name text := COALESCE(NEW.name, OLD.name, '—');
  v_currency text := COALESCE(NEW.currency, OLD.currency, '');
BEGIN
  -- Debug trace (visible via `psql` server logs / edge logs).
  RAISE LOG
    'cash_box guard | id=% name=% currency=% old_balance=% new_balance=% delta(out)=%',
    COALESCE(NEW.id, OLD.id), v_name, v_currency, v_old, v_new, v_delta;

  -- Block ONLY outflows (v_new < v_old) that leave the balance negative.
  -- Inflows / deposits are always allowed — even into an overdrawn box —
  -- so historical negative balances can be reduced without being locked out.
  IF v_delta > 0 AND v_new < 0 THEN
    v_shortfall := -v_new;
    RAISE EXCEPTION
      'INSUFFICIENT_CASH_BOX_BALANCE: لا يمكن تنفيذ العملية. رصيد خزنة (%) بعملة (%) غير كافٍ لإتمام عملية الصرف. الرصيد الحالي: % %  |  المطلوب: % %  |  العجز: % %',
      v_name, v_currency,
      v_old, v_currency,
      v_delta, v_currency,
      v_shortfall, v_currency
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
