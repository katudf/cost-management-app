-- =========================================================
-- 重大: purge_expired_estimates() / restore_estimate() が
--       未認証(anon)から実行できてしまう問題の修正
-- =========================================================
--
-- 【問題1】EXECUTE権限が剥奪されていない
--   20260710010136_phase3_revoke_definer_function_exec で SECURITY DEFINER 関数の
--   EXECUTE を anon/PUBLIC から剥奪したが、この2関数はその後
--   (20260715232753_add_estimate_restore) に追加されたため、リストから漏れていた。
--   結果、PostgREST の /rest/v1/rpc/... から匿名で到達可能になっていた。
--
-- 【問題2】権限チェックがNULLですり抜ける（本質的な原因）
--   ガード式が以下の形になっていた:
--     IF NOT (is_admin() OR current_staff_role() = 'office') THEN
--       RAISE EXCEPTION '権限がありません';
--     END IF;
--
--   未認証の場合 auth.uid() が NULL のため current_staff_role() は NULL を返す。
--   SQLの三値論理では
--     is_admin()                     -> false （EXISTS なので false であってNULLではない）
--     current_staff_role() = 'office' -> NULL  （NULL との比較は NULL）
--     false OR NULL                   -> NULL
--     NOT NULL                        -> NULL
--   IF文はNULLを真として扱わないため RAISE EXCEPTION に到達せず、
--   そのまま本体の DELETE / UPDATE が実行されていた。
--
--   実際に anon キーで叩いたところ purge_expired_estimates() は
--   HTTP 200 を返した（削除対象が0件だったため実害は出ていないが、
--   論理削除から30日を過ぎた見積書が存在すれば匿名の第三者に物理削除されていた）。
--
-- 【対処】
--   1. EXECUTE を anon, PUBLIC から剥奪する（他のRPCと同じ扱いに揃える）
--   2. ガード式を coalesce(...) で包み、NULLでもEXCEPTIONが発生するようにする
--   多層防御とし、片方が将来崩れてももう片方で止まるようにする。


-- ---------------------------------------------------------
-- 1. 権限チェックのNULLすり抜けを塞ぐ
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION restore_estimate(p_estimate_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_at timestamptz;
BEGIN
  -- coalesce で NULL を false に落としてから NOT を取る（未認証を確実に弾く）
  IF NOT coalesce(is_admin() OR current_staff_role() = 'office', false) THEN
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

CREATE OR REPLACE FUNCTION purge_expired_estimates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- coalesce で NULL を false に落としてから NOT を取る（未認証を確実に弾く）
  IF NOT coalesce(is_admin() OR current_staff_role() = 'office', false) THEN
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


-- ---------------------------------------------------------
-- 2. EXECUTE権限を剥奪する
--    フロントエンドからログイン済みユーザーが呼ぶため authenticated は残す。
--    （権限チェックは関数内部で行う。20260710010136 と同じ方針）
--    CREATE OR REPLACE は既存のACLを保持するため、上の再定義後に実行する。
-- ---------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.restore_estimate(bigint) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_expired_estimates() FROM anon, PUBLIC;
