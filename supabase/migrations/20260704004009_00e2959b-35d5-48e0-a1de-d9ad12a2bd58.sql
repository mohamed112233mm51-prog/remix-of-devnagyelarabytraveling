-- Guarantee that no cash box balance can ever go below zero,
-- regardless of which code path performs the update.
CREATE OR REPLACE FUNCTION public.enforce_cash_box_non_negative_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old numeric := COALESCE(OLD.balance, 0);
  v_new numeric := COALESCE(NEW.balance, 0);
  v_delta numeric;
  v_shortfall numeric;
  v_name text := COALESCE(NEW.name, OLD.name, '—');
  v_currency text := COALESCE(NEW.currency, OLD.currency, '');
BEGIN
  IF v_new < 0 THEN
    v_delta := v_old - v_new;         -- amount being deducted
    v_shortfall := -v_new;            -- how much it goes below zero
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

DROP TRIGGER IF EXISTS trg_cash_boxes_non_negative ON public.cash_boxes;

-- BEFORE UPDATE so the balance write is aborted before any dependent
-- side effects commit; because the trigger raises inside the same
-- transaction as the caller (payment_splits, currency ops, transfers,
-- future services), the entire operation is rolled back atomically.
CREATE TRIGGER trg_cash_boxes_non_negative
BEFORE UPDATE OF balance ON public.cash_boxes
FOR EACH ROW
WHEN (NEW.balance IS DISTINCT FROM OLD.balance)
EXECUTE FUNCTION public.enforce_cash_box_non_negative_balance();

-- Also guard direct INSERTs that seed a negative balance.
CREATE OR REPLACE FUNCTION public.enforce_cash_box_non_negative_balance_ins()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.balance, 0) < 0 THEN
    RAISE EXCEPTION
      'INSUFFICIENT_CASH_BOX_BALANCE: لا يمكن إنشاء خزنة (%) بعملة (%) برصيد سالب.',
      COALESCE(NEW.name,'—'), COALESCE(NEW.currency,'')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_boxes_non_negative_ins ON public.cash_boxes;
CREATE TRIGGER trg_cash_boxes_non_negative_ins
BEFORE INSERT ON public.cash_boxes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cash_box_non_negative_balance_ins();
