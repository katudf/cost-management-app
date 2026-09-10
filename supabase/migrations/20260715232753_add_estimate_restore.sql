-- 削除済み見積書の復元機能を追加。
-- 既存の estimates_office_update ポリシーは USING句に deleted_at IS NULL を要求するため、
-- 削除済み行（deleted_at IS NOT NULL）に対するUPDATE（復元含む）が常にRLS違反になる。
-- 20260713000000 と同じ理由でポリシーをそのままにはできないため、
-- 復元・完全削除は SECURITY DEFINER の RPC 経由に限定し、
-- 通常のUPDATEポリシーは削除済み行を対象外のまま維持する（誤操作防止）。

-- ============================================================
-- 見積書の復元（論理削除の取り消し）
-- 削除から30日以内のみ復元可能
-- ============================================================
CREATE OR REPLACE FUNCTION restore_estimate(p_estimate_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_at timestamptz;
BEGIN
  IF NOT (is_admin() OR current_staff_role() = 'office') THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT deleted_at INTO v_deleted_at
  FROM estimates
  WHERE id = p_estimate_id
  FOR UPDATE;

  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION '削除されていない見積書です';
  END IF;

  IF v_deleted_at < now() - interval '30 days' THEN
    RAISE EXCEPTION '削除から30日を過ぎているため復元できません';
  END IF;

  UPDATE estimates SET deleted_at = NULL WHERE id = p_estimate_id;
END;
$$;

-- ============================================================
-- 削除済み見積書の完全削除（物理削除）
-- 30日を過ぎた削除済み見積りのみ対象。管理者が手動実行する想定。
-- estimate_items の外部キーにON DELETE CASCADEが設定されているか
-- 移行ファイル上で確認できないため、明細を先に明示的に削除する。
-- ============================================================
CREATE OR REPLACE FUNCTION purge_expired_estimates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (is_admin() OR current_staff_role() = 'office') THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  DELETE FROM estimate_items
  WHERE estimate_id IN (
    SELECT id FROM estimates
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - interval '30 days'
  );

  DELETE FROM estimates
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - interval '30 days';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
