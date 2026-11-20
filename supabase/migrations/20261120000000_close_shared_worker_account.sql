-- =========================================================
-- 作業員の共有アカウントの申告値で、誰の日報でも書け、承認もできる穴を塞ぐ
-- （docs/specs/daily-report-db-hardening.md §4.1 DB-3 / M1。worker-login.md §6 フェーズB の 3）
--
-- 【問題】
-- _effective_worker（20261107020000）は、作業員の個人アカウント以外では引数の作業員名・ID をそのまま使う。
-- office_staff.role = 'worker' の行（共有アカウント）でログインすると、current_staff_role() = 'worker' で
-- 日報・承認の RPC の role 判定を通り、申告した作業員として日報を保存でき、職長の名前と ID を申告すれば承認もできる。
-- 共有アカウント（office_staff.id=18）は 2026-11-09 に削除済みだが、office_staff_role_check が 'worker' を許しているので、
-- 管理者が担当者の role を worker にすれば穴が開き直す。
--
-- 【対処】
-- 1. office_staff.role から 'worker' を外す（作業員のログインは Workers.auth_user_id で持つ）。
--    これで current_staff_role() = 'worker' は作業員の個人アカウントだけで真になる。
-- 2. _effective_worker で引数をそのまま使うのを担当者（代理入力）だけにし、それ以外（閲覧者・ロール無し）は NULL を返す。
--    呼び出し側の RPC は、作業員を決められないときにすべて権限エラーか入力エラーで止まる。
--
-- 【適用前】role = 'worker' の担当者行が残っていると、下の DO ブロックで止まる。先に削除するか role を変える。
-- 【巻き戻し】office_staff_role_check を 'worker' 入りに戻し、_effective_worker を 20261107020000 の定義で作り直す。
-- =========================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.office_staff WHERE role = 'worker') THEN
    RAISE EXCEPTION 'role = worker の担当者行が残っています。先に削除するか role を変えてください。';
  END IF;
END $$;

ALTER TABLE public.office_staff DROP CONSTRAINT IF EXISTS office_staff_role_check;
ALTER TABLE public.office_staff ADD CONSTRAINT office_staff_role_check
  CHECK (role IN ('admin', 'system_admin', 'office', 'viewer'));

-- 引数で申告された作業員を、作業員の個人アカウントのときはログイン中の本人に置き換える。
-- 担当者（代理入力）は申告どおり。それ以外は NULL（呼び出し側で弾く）。
CREATE OR REPLACE FUNCTION public._effective_worker(
  p_worker_id bigint, p_worker_name text, OUT worker_id bigint, OUT worker_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_personal_worker() THEN
    SELECT w.id, NULLIF(btrim(w.name), '') INTO worker_id, worker_name
      FROM "Workers" w WHERE w.id = public.current_worker_id();
  ELSIF public.is_office_or_admin() THEN
    worker_id := p_worker_id;
    worker_name := NULLIF(btrim(p_worker_name), '');
  ELSE
    worker_id := NULL;
    worker_name := NULL;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._effective_worker(bigint, text) FROM anon, PUBLIC, authenticated;
