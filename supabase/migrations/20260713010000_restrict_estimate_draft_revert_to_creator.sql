-- 承認依頼中/承認済み等の見積書を「下書きに戻す」操作を作成者(staff_id)本人とadminのみに制限する。
-- 従来はRLS(estimates_office_update)がoffice役割であれば誰でもUPDATE可能としていたため、
-- 承認権限を持つユーザーが他人の見積書を下書きに戻して編集できてしまう問題があった。
-- 承認・差し戻し(approved/returned遷移)と同様、UI側のガードは補助的な二重チェックに過ぎず、
-- 実際の制約はDBのトリガーで強制する。
CREATE OR REPLACE FUNCTION public.protect_estimate_approval_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff_id integer;
BEGIN
  IF current_setting('app.estimates_status_rpc', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'returned'))
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION '承認・差し戻しは approve_estimate / return_estimate 経由でのみ実行できます。';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'draft'
     AND OLD.status <> 'draft'
     AND NOT is_admin() THEN
    SELECT id INTO v_staff_id FROM office_staff WHERE auth_user_id = auth.uid();
    IF OLD.staff_id IS NOT NULL AND OLD.staff_id IS DISTINCT FROM v_staff_id THEN
      RAISE EXCEPTION '下書きに戻す操作は作成者本人のみ実行できます。';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
