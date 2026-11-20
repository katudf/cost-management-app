"""Run daily report DB hardening (docs/specs/daily-report-db-hardening.md) SQL regressions on a separate localhost PostgreSQL cluster.

Example: python scripts/test-daily-report-hardening-db.py --port 55432
Creates a fresh database with synthetic records; never accepts a remote host.
The fixtures are shared with scripts/test-worker-login-db.py (tests/db/login-id-fixture.sql, tests/db/worker-login-fixture.sql).
"""
import argparse
import subprocess
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, required=True)
args = parser.parse_args()
if args.port == 5432:
    parser.error('Use a separate test cluster port, not 5432.')
root = Path(__file__).resolve().parents[1]
database = 'daily_report_hardening_test_' + uuid.uuid4().hex[:12]
base = ['psql', '-X', '-h', '127.0.0.1', '-p', str(args.port), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']


def raw(sql, db=database):
    return subprocess.run(base + ['-d', db], input=sql, text=True, encoding='utf-8', capture_output=True)


def uid(n):
    return f'00000000-0000-0000-0000-{n:012d}'


def run(sql, user=None, role='authenticated', fail=None):
    """user（auth.users の UUID 末尾）としてログインした状態か、service_role で実行する。"""
    prefix = f"SET ROLE {role}; SET request.jwt.claim.sub='{uid(user) if user else ''}';\n"
    result = raw(prefix + sql)
    if fail:
        assert result.returncode and fail in result.stderr, (sql, result.stdout, result.stderr)
    else:
        assert result.returncode == 0, (sql, result.stderr)
    return result.stdout.strip()


def service(sql, fail=None):
    return run(sql, role='service_role', fail=fail)


def admin_sql(sql):
    result = raw(sql)
    assert result.returncode == 0, (sql, result.stderr)
    return result.stdout.strip()


def as_owner(sql, user=None):
    """内部関数（authenticated に EXECUTE が無い）を、ログイン中の利用者の状態で呼ぶ。"""
    return admin_sql(f"SET request.jwt.claim.sub='{uid(user) if user else ''}';\n" + sql)


def expect(actual, wanted, label):
    assert actual == wanted, (label, actual, wanted)


passed = []


def check(name, action):
    action()
    passed.append(name)
    print('PASS', name, flush=True)


# 担当者（tests/db/login-id-fixture.sql）。SHARED（担当者5）は role = worker の共有アカウント
SYSTEM_ADMIN, ADMIN_A, ADMIN_B, OFFICE, SHARED = 1, 2, 3, 4, 5
# 作業員の Auth ユーザー（tests/db/worker-login-fixture.sql）
TANAKA, SUZUKI, RETIRED, FUTURE, SPARE = 101, 102, 103, 104, 105

M1 = 'supabase/migrations/20261120000000_close_shared_worker_account.sql'

assert raw(f'CREATE DATABASE {database}', db='postgres').returncode == 0
for file in ['tests/db/login-id-fixture.sql',
             'supabase/migrations/20261026100000_password_change_logs.sql',
             'supabase/migrations/20261107000000_login_id_management.sql',
             'supabase/migrations/20261107010000_password_change_logs_forwarded_for.sql',
             'tests/db/worker-login-fixture.sql',
             'supabase/migrations/20261107020000_worker_personal_login.sql',
             'supabase/migrations/20261110000000_merge_worker_login_into_staff.sql']:
    result = raw((root / file).read_text(encoding='utf-8'))
    assert result.returncode == 0, (file, result.stderr)

# 田中（作業員1・現場Aの職長）と鈴木（作業員2）は作業員の個人アカウント
for worker, user in [(1, TANAKA), (2, SUZUKI)]:
    service(f"SELECT link_worker_login('{uid(ADMIN_A)}', {worker}, '{uid(user)}')")

m1_sql = (root / M1).read_text(encoding='utf-8')

# =========================================================
# M1（DB-3）: 共有アカウントの申告値を塞ぐ
# =========================================================
def m1_refused_while_shared_row_exists():
    result = raw(m1_sql)
    assert result.returncode and 'role = worker の担当者行が残っています' in result.stderr, result.stderr
    # 何も変わっていない（DO ブロックで止まり、CHECK も関数も元のまま）
    expect(admin_sql("SELECT pg_get_constraintdef(oid) LIKE '%worker%' FROM pg_constraint WHERE conname='office_staff_role_check'"),
           't', 'check unchanged')


check('M1 refuses while a role=worker staff row exists', m1_refused_while_shared_row_exists)

# 本番と同じく共有アカウントを無くす（ここでは削除の代わりに閲覧者へ変える。閲覧者の動きも確かめるため）
admin_sql("BEGIN; SELECT set_config('app.bypass_staff_protect_trigger', 'on', true); "
          "UPDATE office_staff SET role = 'viewer' WHERE id = 5; COMMIT;")
VIEWER = SHARED

check('M1 applies', lambda: expect(raw(m1_sql).returncode, 0, 'apply'))
check('M1 is re-runnable', lambda: expect(raw(m1_sql).returncode, 0, 'rerun'))


def role_worker_rejected():
    result = raw("INSERT INTO office_staff (id, name, role) VALUES (90, '共通', 'worker')")
    assert result.returncode and 'office_staff_role_check' in result.stderr, result.stderr
    # 保護トリガー（管理者以外の role 変更を拒否）を外し、CHECK だけで止まることを確かめる
    result = raw("BEGIN; SELECT set_config('app.bypass_staff_protect_trigger', 'on', true); "
                 "UPDATE office_staff SET role = 'worker' WHERE id = 6; COMMIT;")
    assert result.returncode and 'office_staff_role_check' in result.stderr, result.stderr


check('staff role worker cannot be created any more', role_worker_rejected)
check('other staff roles still allowed', lambda: admin_sql(
    "INSERT INTO office_staff (id, name, role) VALUES (91, '閲覧', 'viewer'), (92, '事務2', 'office'); "
    "DELETE FROM office_staff WHERE id IN (91, 92)"))

# ---------- _effective_worker ----------
check('effective worker: personal worker is fixed to self', lambda: expect(
    as_owner("SELECT worker_id||':'||worker_name FROM _effective_worker(1, '田中 太郎')", SUZUKI), '2:鈴木 次郎', 'self'))
check('effective worker: office uses declared (proxy input)', lambda: expect(
    as_owner("SELECT worker_id||':'||worker_name FROM _effective_worker(5, ' 未発行 五郎 ')", OFFICE), '5:未発行 五郎', 'proxy'))
check('effective worker: viewer gets NULL', lambda: expect(
    as_owner("SELECT coalesce(worker_id::text, 'null')||','||coalesce(worker_name, 'null') FROM _effective_worker(1, '田中 太郎')",
             VIEWER), 'null,null', 'viewer'))
check('effective worker: unlinked login gets NULL', lambda: expect(
    as_owner("SELECT coalesce(worker_id::text, 'null')||','||coalesce(worker_name, 'null') FROM _effective_worker(1, '田中 太郎')",
             SPARE), 'null,null', 'spare'))
check('effective worker: anonymous gets NULL', lambda: expect(
    as_owner("SELECT coalesce(worker_id::text, 'null')||','||coalesce(worker_name, 'null') FROM _effective_worker(1, '田中 太郎')"),
    'null,null', 'anon'))
check('effective worker stays internal', lambda: run(
    "SELECT * FROM _effective_worker(1, '田中 太郎')", TANAKA, fail='permission denied'))

# ---------- 日報・承認の RPC ----------
SAVE_AS_TANAKA = ("SELECT save_daily_report('{\"project_id\":1,\"date\":\"2026-11-20\",\"worker_id\":1,"
                  "\"worker_name\":\"田中 太郎\",\"inserts\":[{\"project_task_id\":1,\"hours\":8}]}'::jsonb)")

check('viewer cannot save a declared worker report', lambda: (
    run(SAVE_AS_TANAKA, VIEWER, fail='権限がありません'),
    expect(admin_sql("SELECT count(*) FROM \"TaskRecords\" WHERE date = '2026-11-20'"), '0', 'nothing saved'))[-1])
check('viewer cannot delete a declared worker day', lambda: run(
    "SELECT delete_worker_project_day(1, '田中 太郎', '2026-11-20')", VIEWER, fail='権限がありません'))
check('viewer cannot approve as declared foreman', lambda: (
    run("SELECT approve_overtime(3, '田中 太郎', 1)", VIEWER, fail='職長のみ'),
    expect(admin_sql('SELECT status FROM "OvertimeApprovals" WHERE id=3'), 'pending', 'still pending'))[-1])
check('viewer cannot add task as declared foreman', lambda: run(
    "SELECT add_project_task(1, '足場', 2, 1, '田中 太郎')", VIEWER, fail='職長のみ'))
check('viewer cannot acknowledge for declared worker', lambda: run(
    "SELECT acknowledge_approvals('鈴木 次郎', 2, ARRAY[4]::bigint[], ARRAY[]::bigint[])", VIEWER, fail='権限がありません'))

check('personal worker still saves as self', lambda: (
    run(SAVE_AS_TANAKA, SUZUKI),
    expect(admin_sql("SELECT string_agg(DISTINCT worker_name, ',') FROM \"TaskRecords\" WHERE date = '2026-11-20'"),
           '鈴木 次郎', 'self'))[-1])
check('office still saves for a declared worker (proxy input)', lambda: (
    run("SELECT save_daily_report('{\"project_id\":2,\"date\":\"2026-11-20\",\"worker_id\":5,\"worker_name\":\"未発行 五郎\","
        "\"inserts\":[{\"project_task_id\":1,\"hours\":8}]}'::jsonb)", OFFICE),
    expect(admin_sql("SELECT count(*) FROM \"TaskRecords\" WHERE worker_name = '未発行 五郎'"), '1', 'proxy'))[-1])
check('real foreman still approves with own name', lambda: (
    run("SELECT approve_overtime(3, '鈴木 次郎', 2)", TANAKA),
    expect(admin_sql('SELECT approved_by FROM "OvertimeApprovals" WHERE id=3'), '田中 太郎', 'foreman'))[-1])
check('office still approves and is recorded by staff name', lambda: (
    run("SELECT approve_overtime(2, '鈴木 次郎', 2)", OFFICE),
    expect(admin_sql('SELECT approved_by FROM "OvertimeApprovals" WHERE id=2'), '事務', 'office'))[-1])
check('personal worker role is still worker', lambda: expect(
    run("SELECT current_staff_role()||','||is_personal_worker()", TANAKA), 'worker,true', 'role'))
check('viewer role is viewer', lambda: expect(
    run("SELECT current_staff_role()||','||is_personal_worker()", VIEWER), 'viewer,false', 'viewer role'))

print(f'{len(passed)} daily-report hardening DB regressions passed; isolated database: {database}')
