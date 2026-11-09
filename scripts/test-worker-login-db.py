"""Run worker personal login (docs/specs/worker-login.md) SQL regressions on a separate localhost PostgreSQL cluster.

Example: python scripts/test-worker-login-db.py --port 55432
Creates a fresh database with synthetic records; never accepts a remote host.
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
database = 'worker_login_test_' + uuid.uuid4().hex[:12]
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


def expect(actual, wanted, label):
    assert actual == wanted, (label, actual, wanted)


passed = []


def check(name, action):
    action()
    passed.append(name)
    print('PASS', name, flush=True)


# 担当者（tests/db/login-id-fixture.sql）
SYSTEM_ADMIN, ADMIN_A, ADMIN_B, OFFICE, SHARED = 1, 2, 3, 4, 5
# 作業員の Auth ユーザー（tests/db/worker-login-fixture.sql）
TANAKA, SUZUKI, RETIRED, FUTURE, SPARE = 101, 102, 103, 104, 105

MIGRATION = 'supabase/migrations/20261107020000_worker_personal_login.sql'

assert raw(f'CREATE DATABASE {database}', db='postgres').returncode == 0
for file in ['tests/db/login-id-fixture.sql',
             'supabase/migrations/20261026100000_password_change_logs.sql',
             'supabase/migrations/20261107000000_login_id_management.sql',
             'supabase/migrations/20261107010000_password_change_logs_forwarded_for.sql',
             'tests/db/worker-login-fixture.sql',
             MIGRATION]:
    result = raw((root / file).read_text(encoding='utf-8'))
    assert result.returncode == 0, (file, result.stderr)

rerun = raw((root / MIGRATION).read_text(encoding='utf-8'))
check('migration is re-runnable', lambda: expect(rerun.returncode, 0, rerun.stderr))

# 紐付け: 田中・鈴木・退職・予定は作業員アカウント、事務（担当者4）は作業員6と共有
for worker, user in [(1, TANAKA), (2, SUZUKI), (3, RETIRED), (4, FUTURE)]:
    service(f"SELECT link_worker_login('{uid(ADMIN_A)}', {worker}, '{uid(user)}')")

# ---------- ロール判定 ----------
check('personal worker role is worker', lambda: expect(run('SELECT current_staff_role()', TANAKA), 'worker', 'role'))
check('personal worker id', lambda: expect(run('SELECT current_worker_id()', TANAKA), '1', 'id'))
check('personal worker flag', lambda: expect(run('SELECT is_personal_worker()', TANAKA), 't', 'flag'))
check('retired today has no role', lambda: expect(
    run("SELECT current_staff_role()||','||coalesce(current_worker_id()::text,'null')", RETIRED), 'none,null', 'retired'))
check('future resignation still has role in DB', lambda: expect(run('SELECT current_staff_role()', FUTURE), 'worker', 'future'))
check('shared account is not personal worker', lambda: expect(
    run("SELECT current_staff_role()||','||is_personal_worker()", SHARED), 'worker,false', 'shared'))
check('unlinked auth user has no role (never NULL)', lambda: expect(run("SELECT current_staff_role()", SPARE), 'none', 'spare'))
check('anonymous has no role (never NULL)', lambda: expect(run("SELECT current_staff_role()"), 'none', 'anon'))
check('office role unchanged', lambda: expect(run('SELECT current_staff_role()', OFFICE), 'office', 'office'))

# ---------- 名簿・本人 ----------
check('personal worker reads directory', lambda: expect(run('SELECT count(*) FROM workers_directory', TANAKA), '7', 'dir'))
check('retired worker reads no directory', lambda: expect(run('SELECT count(*) FROM workers_directory', RETIRED), '0', 'dir'))
check('is_staff stays false for personal worker', lambda: expect(run('SELECT is_staff()', TANAKA), 'f', 'is_staff'))
check('personal worker cannot read Workers table', lambda: expect(run('SELECT count(*) FROM "Workers"', TANAKA), '0', 'rls'))
check('get_my_worker', lambda: expect(run("SELECT id||':'||name FROM get_my_worker()", TANAKA), '1:田中 太郎', 'me'))
check('get_worker_login_ids for admin', lambda: expect(
    run("SELECT string_agg(worker_id||':'||login_id, ',' ORDER BY worker_id) FROM get_worker_login_ids()", ADMIN_A),
    '1:tanaka,2:suzuki,3:retired,4:future', 'ids'))
check('get_worker_login_ids empty for office', lambda: expect(run('SELECT count(*) FROM get_worker_login_ids()', OFFICE), '0', 'ids'))

# ---------- 保護トリガー ----------
check('admin cannot set auth_user_id', lambda: run(
    f"UPDATE \"Workers\" SET auth_user_id='{uid(SPARE)}' WHERE id=5", ADMIN_A, fail='ログイン操作からだけ'))
check('office cannot clear auth_user_id', lambda: run(
    'UPDATE "Workers" SET auth_user_id=NULL WHERE id=1', OFFICE, fail='ログイン操作からだけ'))
check('cannot insert with auth_user_id', lambda: run(
    f"INSERT INTO \"Workers\" (id,name,auth_user_id) VALUES (90,'x','{uid(SPARE)}')", ADMIN_A, fail='ID発行'))
check('linked worker cannot be deleted directly', lambda: run('DELETE FROM "Workers" WHERE id=1', OFFICE, fail='削除ボタン'))
check('office can still edit other columns', lambda: run(
    "UPDATE \"Workers\" SET kana='タナカ タロウ' WHERE id=1 RETURNING id", OFFICE))
check('unlinked worker can be deleted directly', lambda: run(
    "INSERT INTO \"Workers\" (id,name) VALUES (91,'x'); DELETE FROM \"Workers\" WHERE id=91", OFFICE))

# ---------- 日報・承認の RPC（作業員アカウントは本人に固定） ----------
def save(user, worker_id, worker_name, extra=''):
    payload = ('{"project_id":1,"date":"2026-11-07","worker_id":%s,"worker_name":"%s",'
               '"inserts":[{"project_task_id":1,"hours":8}]%s}') % (worker_id, worker_name, extra)
    return run(f"SELECT save_daily_report('{payload}'::jsonb)", user)


check('personal worker saves as self even when naming another', lambda: (
    save(SUZUKI, 1, '田中 太郎'),
    expect(admin_sql("SELECT string_agg(DISTINCT worker_name, ',') FROM \"TaskRecords\""), '鈴木 次郎', 'name'))[-1])
check('personal worker cannot borrow foreman id', lambda: run(
    "SELECT save_daily_report('{\"project_id\":1,\"date\":\"2026-11-07\",\"worker_id\":1,\"worker_name\":\"田中 太郎\","
    "\"progress\":[{\"id\":1,\"progress_percentage\":50}]}'::jsonb)", SUZUKI, fail='職長のみ'))
check('real foreman can update progress', lambda: run(
    "SELECT save_daily_report('{\"project_id\":1,\"date\":\"2026-11-07\",\"worker_id\":2,\"worker_name\":\"鈴木 次郎\","
    "\"progress\":[{\"id\":1,\"progress_percentage\":50}]}'::jsonb)", TANAKA))
check('retired worker cannot save', lambda: run(
    "SELECT save_daily_report('{\"project_id\":1,\"date\":\"2026-11-07\",\"worker_id\":3,\"worker_name\":\"退職 三郎\"}'::jsonb)",
    RETIRED, fail='権限がありません'))
check('shared account still uses declared worker', lambda: (
    run("SELECT save_daily_report('{\"project_id\":2,\"date\":\"2026-11-07\",\"worker_id\":5,\"worker_name\":\"未発行 五郎\","
        "\"inserts\":[{\"project_task_id\":1,\"hours\":8}]}'::jsonb)", SHARED),
    expect(admin_sql("SELECT count(*) FROM \"TaskRecords\" WHERE worker_name='未発行 五郎'"), '1', 'shared'))[-1])

check('personal worker cannot delete another worker day', lambda: (
    run("SELECT delete_worker_project_day(2, '未発行 五郎', '2026-11-07')", SUZUKI),
    expect(admin_sql("SELECT count(*) FROM \"TaskRecords\" WHERE worker_name='未発行 五郎'"), '1', 'kept'))[-1])
check('personal worker deletes own day', lambda: (
    run("SELECT delete_worker_project_day(1, '未発行 五郎', '2026-11-07')", SUZUKI),
    expect(admin_sql("SELECT count(*) FROM \"TaskRecords\" WHERE worker_name='鈴木 次郎'"), '0', 'deleted'))[-1])

check('personal worker cannot add task with foreman id', lambda: run(
    "SELECT add_project_task(1, '足場', 2, 1, '田中 太郎')", SUZUKI, fail='職長のみ'))
check('foreman adds task', lambda: run("SELECT (add_project_task(1, '足場', 2, NULL, NULL)).id", TANAKA))
check('anyone adds task where no foreman', lambda: run("SELECT (add_project_task(2, '養生', 1, NULL, NULL)).id", SUZUKI))

check('personal worker cannot approve as foreman', lambda: run(
    "SELECT approve_overtime(1, '田中 太郎', 1)", SUZUKI, fail='職長のみ'))
check('foreman approves with own name', lambda: (
    run("SELECT approve_overtime(1, '鈴木 次郎', 2)", TANAKA),
    expect(admin_sql('SELECT approved_by||\':\'||(acknowledged_at IS NULL) FROM "OvertimeApprovals" WHERE id=1'),
           '田中 太郎:true', 'approved_by'))[-1])
check('retired worker cannot approve or delete', lambda: (
    run("SELECT approve_overtime(2, '退職 三郎', 3)", RETIRED, fail='職長のみ'),
    run("SELECT delete_worker_project_day(1, '鈴木 次郎', '2026-11-07')", RETIRED, fail='権限がありません'))[-1])
check('office approval records staff name', lambda: (
    run("SELECT approve_overtime(2, '鈴木 次郎', 2)", OFFICE),
    expect(admin_sql('SELECT approved_by FROM "OvertimeApprovals" WHERE id=2'), '事務', 'office approver'))[-1])
check('shared account approval keeps declared name', lambda: (
    run("SELECT approve_overtime(3, '田中 太郎', 1)", SHARED),
    expect(admin_sql('SELECT approved_by FROM "OvertimeApprovals" WHERE id=3'), '田中 太郎', 'shared approver'))[-1])

check('personal worker acknowledges only own', lambda: (
    run("SELECT acknowledge_approvals('田中 太郎', 1, ARRAY[4]::bigint[], ARRAY[]::bigint[])", SUZUKI),
    expect(admin_sql('SELECT acknowledged_at IS NOT NULL FROM "OvertimeApprovals" WHERE id=4'), 't', 'ack'))[-1])

# ---------- パスワード変更履歴 ----------
check('worker link synced fingerprint (no fake self log)', lambda: (
    run("SELECT log_password_change('self')", TANAKA) is not None
    and expect(admin_sql("SELECT count(*) FROM password_change_logs WHERE kind='self'"), '0', 'fake self')))
admin_sql(f"UPDATE auth.users SET encrypted_password='hash-101b', updated_at=now() WHERE id='{uid(TANAKA)}'")
check('worker self change recorded with worker name', lambda: (
    run("SELECT log_password_change('self')", TANAKA),
    expect(admin_sql("SELECT staff_name||':'||worker_id||':'||login_id||':'||coalesce(staff_id::text,'-') "
                     "FROM password_change_logs WHERE kind='self'"), '田中 太郎:1:tanaka:-', 'self row'))[-1])
check('admin worker reset logged', lambda: (
    service(f"SELECT log_admin_worker_password_reset('{uid(ADMIN_A)}', 2, 'UA', '1.2.3.4', '1.2.3.4')"),
    expect(admin_sql("SELECT kind||':'||staff_name||':'||worker_id||':'||operator_staff_name FROM password_change_logs "
                     "ORDER BY id DESC LIMIT 1"), 'admin_reset:鈴木 次郎:2:管理者A', 'reset row'))[-1])

# ---------- Edge Function 専用 RPC ----------
for fn in [f"assert_can_manage_worker_login('{uid(ADMIN_A)}', 1, false)",
           f"link_worker_login('{uid(ADMIN_A)}', 5, '{uid(SPARE)}')",
           f"link_worker_to_staff_login('{uid(ADMIN_A)}', 6, 4)",
           f"unlink_worker_login('{uid(ADMIN_A)}', 1)",
           f"delete_worker_with_login('{uid(ADMIN_A)}', 1)",
           f"assert_can_delete_worker('{uid(ADMIN_A)}', 1)",
           f"log_admin_worker_password_reset('{uid(ADMIN_A)}', 1)",
           f"worker_ban_state('{uid(ADMIN_A)}', 1)",
           f"staff_id_for_auth_user('{uid(OFFICE)}')"]:
    check(f'authenticated cannot call {fn.split("(")[0]}', lambda f=fn: run(f'SELECT {f}', ADMIN_A, fail='permission denied'))

check('office cannot manage worker login', lambda: service(
    f"SELECT assert_can_manage_worker_login('{uid(OFFICE)}', 1)", fail='管理者権限'))
check('link refuses already linked worker', lambda: service(
    f"SELECT link_worker_login('{uid(ADMIN_A)}', 1, '{uid(SPARE)}')", fail='既にログイン'))

check('shared worker account cannot be linked to worker', lambda: service(
    f"SELECT link_worker_to_staff_login('{uid(ADMIN_A)}', 6, 5)", fail='共有アカウント'))
check('admin cannot link admin staff', lambda: service(
    f"SELECT link_worker_to_staff_login('{uid(ADMIN_A)}', 6, 3)", fail='システム管理者だけ'))
check('legacy email staff cannot be linked', lambda: service(
    f"SELECT link_worker_to_staff_login('{uid(SYSTEM_ADMIN)}', 6, 2)", fail='ログインIDがありません'))
check('office staff linked to worker', lambda: service(f"SELECT link_worker_to_staff_login('{uid(ADMIN_A)}', 6, 4)"))
check('dual user keeps office role and gets worker id', lambda: expect(
    run("SELECT current_staff_role()||','||current_worker_id()||','||is_personal_worker()", OFFICE), 'office,6,false', 'dual'))
check('dual staff cannot be linked twice', lambda: service(
    f"SELECT link_worker_to_staff_login('{uid(ADMIN_A)}', 5, 4)", fail='別の作業員'))
check('login ids show linked staff', lambda: expect(
    run("SELECT login_id||':'||linked_staff_id FROM get_worker_login_ids() WHERE worker_id=6", ADMIN_A), 'office:4', 'linked'))

check('ban state: active worker', lambda: expect(
    service(f"SELECT should_ban||','||shared FROM worker_ban_state('{uid(OFFICE)}', 1)"), 'false,false', 'ban'))
check('ban state: future resignation bans', lambda: expect(
    service(f"SELECT should_ban||','||shared FROM worker_ban_state('{uid(OFFICE)}', 4)"), 'true,false', 'ban'))
check('ban state: shared with staff', lambda: expect(
    service(f"SELECT shared FROM worker_ban_state('{uid(OFFICE)}', 6)"), 't', 'shared'))
check('ban state needs office or above', lambda: service(
    f"SELECT * FROM worker_ban_state('{uid(SHARED)}', 1)", fail='事務以上'))

check('unlink returns auth user', lambda: (
    expect(service(f"SELECT unlink_worker_login('{uid(ADMIN_A)}', 4)"), uid(FUTURE), 'unlink'),
    expect(admin_sql('SELECT auth_user_id IS NULL FROM "Workers" WHERE id=4'), 't', 'cleared'))[-1])
check('unlink without login fails', lambda: service(
    f"SELECT unlink_worker_login('{uid(ADMIN_A)}', 4)", fail='ログインがありません'))
check('delete returns auth user and removes row', lambda: (
    service(f"SELECT link_worker_login('{uid(ADMIN_A)}', 7, '{uid(SPARE)}')"),
    expect(service(f"SELECT delete_worker_with_login('{uid(ADMIN_A)}', 7)"), uid(SPARE), 'delete'),
    expect(admin_sql('SELECT count(*) FROM "Workers" WHERE id=7'), '0', 'row'))[-1])
check('dual staff approval records worker name', lambda: (
    admin_sql("INSERT INTO \"OvertimeApprovals\" (id, project_id, worker_name, date, status, requested_hours) VALUES (9, 1, '事務兼 六子', '2026-11-05', 'pending', 1)"),
    run("SELECT approve_overtime(9, 'x', NULL)", OFFICE),
    expect(admin_sql('SELECT approved_by||\':\'||(acknowledged_at IS NOT NULL) FROM "OvertimeApprovals" WHERE id=9'),
           '事務兼 六子:true', 'dual approver'))[-1])
check('office may delete worker with login', lambda: (
    service(f"SELECT link_worker_login('{uid(ADMIN_A)}', 5, '{uid(SPARE)}')"),
    expect(service(f"SELECT delete_worker_with_login('{uid(OFFICE)}', 5)"), uid(SPARE), 'office delete'))[-1])
check('shared account may not delete worker', lambda: service(
    f"SELECT delete_worker_with_login('{uid(SHARED)}', 2)", fail='事務以上'))
check('admin may not delete worker sharing admin login', lambda: (
    admin_sql(f"SELECT set_config('app.bypass_worker_protect_trigger','on',false); UPDATE \"Workers\" SET auth_user_id='{uid(ADMIN_B)}' WHERE id=4"),
    service(f"SELECT delete_worker_with_login('{uid(ADMIN_A)}', 4)", fail='システム管理者だけ'))[-1])
check('worker_id_for_auth_user', lambda: expect(service(f"SELECT worker_id_for_auth_user('{uid(OFFICE)}')"), '6', 'w'))

print(f'{len(passed)} worker-login DB regressions passed; isolated database: {database}')
