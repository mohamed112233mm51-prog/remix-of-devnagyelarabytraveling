
CREATE OR REPLACE FUNCTION public.apply_payment_split_to_cash_box()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  sign_new int := CASE WHEN COALESCE(NEW.direction,'in') = 'out' THEN -1 ELSE 1 END;
  sign_old int := CASE WHEN COALESCE(OLD.direction,'in') = 'out' THEN -1 ELSE 1 END;
  amt_new numeric := CASE WHEN NEW.cancelled_at IS NULL THEN COALESCE(NEW.amount,0) ELSE 0 END;
  amt_old numeric := CASE WHEN OLD.cancelled_at IS NULL THEN COALESCE(OLD.amount,0) ELSE 0 END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cash_box_id IS NOT NULL AND amt_new <> 0 THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) + sign_new * amt_new,
             updated_at = now()
       WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.cash_box_id IS NOT NULL AND amt_old <> 0 THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) - sign_old * amt_old,
             updated_at = now()
       WHERE id = OLD.cash_box_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.cash_box_id IS NOT NULL AND amt_old <> 0 THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) - sign_old * amt_old,
             updated_at = now()
       WHERE id = OLD.cash_box_id;
    END IF;
    IF NEW.cash_box_id IS NOT NULL AND amt_new <> 0 THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) + sign_new * amt_new,
             updated_at = now()
       WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;
