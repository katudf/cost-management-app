"""Run daily report DB hardening (docs/specs/daily-report-db-hardening.md) SQL regressions on a separate localhost PostgreSQL cluster.

Example: python scripts/test-daily-report-hardening-db.py --port 55432
Creates a fresh database with synthetic records; never accepts a remote host.
The fixtures are shared with scripts/test-worker-login-db.py (tests/db/login-id-fixture.sql, tests/db/worker-login-fixture.sql).
"""
import argparse
import json
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

# =========================================================
# M2: 日報の保存・承認の RPC（DB-4・DB-5・DB-6・DB-7）と、M3 の準備（部品・presence RPC・現場の名簿ビュー）
# =========================================================
M2 = 'supabase/migrations/20261120010000_daily_report_rpc_v2.sql'
for file in ['supabase/migrations/20260930000000_create_worker_daily_break_settings.sql',
             'tests/db/daily-report-hardening-fixture.sql']:
    result = raw((root / file).read_text(encoding='utf-8'))
    assert result.returncode == 0, (file, result.stderr)
m2_sql = (root / M2).read_text(encoding='utf-8')
def m2_applies():
    result = raw(m2_sql)
    expect(result.returncode, 0, result.stderr)


check('M2 applies', m2_applies)
check('M2 is re-runnable', lambda: expect(raw(m2_sql).returncode, 0, 'rerun'))

D = '2026-11-25'


def save_payload(user, payload, fail=None):
    """save_daily_report を呼び、戻り値（jsonb）を dict で返す。"""
    body = json.dumps(payload, ensure_ascii=False)
    out = run(f"SELECT save_daily_report($j${body}$j$::jsonb)", user, fail=fail)
    return None if fail else json.loads(out)


def payload(project_id, **extra):
    return {'project_id': project_id, 'date': D, 'worker_id': 2, 'worker_name': '鈴木 次郎', **extra}


def record(project_id, date=D, worker='鈴木 次郎', hours=8, note='', task=None):
    task = task or {1: 1, 2: 2, 3: 3}[project_id]
    return int(admin_sql(
        f"INSERT INTO \"TaskRecords\" (project_id, project_task_id, date, worker_name, hours, overtime_hours, note) "
        f"VALUES ({project_id}, {task}, '{date}', '{worker}', {hours}, 0, '{note}') RETURNING id"))


def version(record_id):
    return admin_sql(f'SELECT updated_at FROM "TaskRecords" WHERE id = {record_id}')


def field(record_id, column):
    return admin_sql(f'SELECT {column} FROM "TaskRecords" WHERE id = {record_id}')


R_A = record(1, note='a')            # 鈴木・現場A・この日
R_B = record(2, hours=2)             # 鈴木・現場B・この日（休憩の再計算の対象）
R_PREV = record(1, date='2026-11-24')  # 鈴木・現場A・前の日
R_TANAKA = record(2, worker='田中 太郎', hours=4)

# ---------- updated_at ----------
def touch_bumps_version():
    before = version(R_A)
    admin_sql(f'UPDATE "TaskRecords" SET note = note WHERE id = {R_A}')
    assert version(R_A) != before, 'updated_at did not change'


check('TaskRecords.updated_at is bumped on every UPDATE', touch_bumps_version)

# ---------- DB-4: 現場・日付の絞り込み ----------
check('update of another day row is refused and nothing is saved', lambda: (
    save_payload(SUZUKI, payload(1, updates=[{'id': R_PREV, 'data': {'hours': 1, 'note': 'x'},
                                              'fallback_insert': {'project_task_id': 1, 'hours': 1}}],
                                 inserts=[{'project_task_id': 1, 'hours': 3}]),
                 fail='別の日か別の現場'),
    expect(field(R_PREV, 'hours'), '8', 'prev untouched'),
    expect(admin_sql(f"SELECT count(*) FROM \"TaskRecords\" WHERE date = '{D}' AND hours = 3"), '0', 'no insert'))[-1])
check('delete of another project row is ignored', lambda: (
    save_payload(SUZUKI, payload(1, delete_ids=[R_B])),
    expect(admin_sql(f'SELECT count(*) FROM "TaskRecords" WHERE id = {R_B}'), '1', 'kept'))[-1])
check('break recalculation updates the same day row of another project', lambda: (
    save_payload(SUZUKI, payload(1, updates=[{'id': R_B, 'data': {'hours': 1.5, 'overtime_hours': 0}}])),
    expect(field(R_B, 'hours'), '1.5', 'recalc'))[-1])
check('full update of another project row is refused', lambda: save_payload(
    SUZUKI, payload(1, updates=[{'id': R_B, 'data': {'hours': 1, 'note': 'x'}}]), fail='別の日か別の現場'))
check('another worker row is not touched (fallback inserts own row, as before)', lambda: (
    save_payload(SUZUKI, payload(2, updates=[{'id': R_TANAKA, 'data': {'hours': 1},
                                              'fallback_insert': {'project_task_id': 2, 'hours': 1}}])),
    expect(field(R_TANAKA, 'hours'), '4', 'tanaka untouched'))[-1])

# ---------- DB-5: 楽観ロック ----------
def stale_version_conflicts():
    seen = version(R_A)
    admin_sql(f'UPDATE "TaskRecords" SET hours = 7 WHERE id = {R_A}')  # 管理者が直した
    body = json.dumps(payload(1, expected_versions={str(R_A): seen},
                              updates=[{'id': R_A, 'data': {'hours': 8, 'note': 'w'},
                                        'fallback_insert': {'project_task_id': 1, 'hours': 8}}],
                              break_durations=[0, 60, 30]), ensure_ascii=False)
    result = raw(f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(SUZUKI)}';\n"
                 f"\\set VERBOSITY verbose\nSELECT save_daily_report($j${body}$j$::jsonb)")
    assert result.returncode and 'PT409' in result.stderr and '他の人が先に' in result.stderr, result.stderr
    assert '"reason": "updated"' in result.stderr and f'"id": {R_A}' in result.stderr, result.stderr
    expect(field(R_A, 'hours'), '7', 'admin edit kept')
    expect(admin_sql(f"SELECT count(*) FROM \"WorkerDailyBreakSettings\" WHERE date = '{D}'"), '0', 'no break saved')


check('stale expected_versions conflicts (PT409) and nothing is saved', stale_version_conflicts)


def current_version_saves():
    out = save_payload(SUZUKI, payload(1, expected_versions={str(R_A): version(R_A)},
                                       updates=[{'id': R_A, 'data': {'hours': 6, 'note': 'ok'},
                                                 'fallback_insert': {'project_task_id': 1, 'hours': 6}}]))
    expect(field(R_A, 'hours'), '6', 'saved')
    expect(out['versions'].get(str(R_A)) is not None, True, 'versions has row')
    day_ids = admin_sql(f"SELECT string_agg(id::text, ',' ORDER BY id) FROM \"TaskRecords\" "
                        f"WHERE worker_name = '鈴木 次郎' AND date = '{D}'")
    expect(sorted(out['versions'], key=int), day_ids.split(','), 'versions covers the whole day of this worker')
    expect({str(R_A), str(R_B)} <= set(out['versions']), True, 'both projects')
    expect(out['break_saved'], False, 'no break key')


check('current expected_versions saves and returns versions', current_version_saves)


def deleted_row_conflicts():
    r = record(1, hours=5)
    seen = version(r)
    admin_sql(f'DELETE FROM "TaskRecords" WHERE id = {r}')
    before = admin_sql('SELECT count(*) FROM "TaskRecords"')
    result = raw(f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(SUZUKI)}';\n"
                 "SELECT save_daily_report($j$" + json.dumps(payload(
                     1, expected_versions={str(r): seen},
                     updates=[{'id': r, 'data': {'hours': 5}, 'fallback_insert': {'project_task_id': 1, 'hours': 5}}]))
                 + "$j$::jsonb)")
    assert result.returncode and '"reason": "deleted"' in result.stderr, result.stderr
    expect(admin_sql('SELECT count(*) FROM "TaskRecords"'), before, 'not re-inserted')


check('row deleted by someone else conflicts instead of fallback insert (Q1)', deleted_row_conflicts)


def old_client_fallback_inserts():
    r = record(1, hours=5)
    admin_sql(f'DELETE FROM "TaskRecords" WHERE id = {r}')
    out = save_payload(SUZUKI, payload(1, updates=[{'id': r, 'data': {'hours': 5},
                                                    'fallback_insert': {'project_task_id': 1, 'hours': 5}}]))
    expect(len(out['remapped']), 1, 'old client re-inserts as before')


check('old client without versions still re-inserts deleted rows', old_client_fallback_inserts)


def delete_of_missing_row_is_not_conflict():
    r = record(1, hours=5)
    seen = version(r)
    admin_sql(f'DELETE FROM "TaskRecords" WHERE id = {r}')
    save_payload(SUZUKI, payload(1, expected_versions={str(r): seen}, delete_ids=[r]))


check('deleting an already deleted row is not a conflict', delete_of_missing_row_is_not_conflict)


def progress_conflicts():
    admin_sql('UPDATE "ProjectTasks" SET progress_percentage = 30 WHERE id = 1')
    tanaka = {'project_id': 1, 'date': D, 'worker_id': 1, 'worker_name': '田中 太郎'}
    result = raw(f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(TANAKA)}';\n"
                 "SELECT save_daily_report($j$" + json.dumps(dict(
                     tanaka, progress=[{'id': 1, 'progress_percentage': 50, 'expected_progress': 10}]))
                 + "$j$::jsonb)")
    assert result.returncode and '"kind": "progress"' in result.stderr, result.stderr
    expect(admin_sql('SELECT progress_percentage FROM "ProjectTasks" WHERE id = 1'), '30', 'kept')
    save_payload(TANAKA, dict(tanaka, progress=[{'id': 1, 'progress_percentage': 50, 'expected_progress': 30}]))
    expect(admin_sql('SELECT progress_percentage FROM "ProjectTasks" WHERE id = 1'), '50', 'saved')
    # 進捗を送らない旧画面は今までどおり
    save_payload(TANAKA, dict(tanaka, progress=[{'id': 1, 'progress_percentage': 60}]))
    expect(admin_sql('SELECT progress_percentage FROM "ProjectTasks" WHERE id = 1'), '60', 'old client')


check('stale expected_progress conflicts, current one saves', progress_conflicts)
check('non-foreman progress is still a permission error (not a conflict)', lambda: save_payload(
    SUZUKI, payload(1, progress=[{'id': 1, 'progress_percentage': 90, 'expected_progress': 0}]), fail='職長のみ'))

# ---------- DB-7: 休憩設定 ----------
def breaks_saved_in_same_transaction():
    out = save_payload(SUZUKI, payload(1, inserts=[{'project_task_id': 1, 'hours': 1}], break_durations=[30, 60, 30]))
    expect(out['break_saved'], True, 'break_saved')
    expect(admin_sql(f"SELECT break_durations::text FROM \"WorkerDailyBreakSettings\" "
                     f"WHERE worker_name = '鈴木 次郎' AND date = '{D}'"), '[30, 60, 30]', 'saved')
    # §7.3 の確かめ方: RPC で保存した休憩設定の updated_at は、同じトランザクションの日報の行と一致する
    expect(admin_sql(f"SELECT count(*) FROM \"WorkerDailyBreakSettings\" b WHERE b.date = '{D}' AND EXISTS ("
                     f"SELECT 1 FROM \"TaskRecords\" t WHERE t.worker_name = b.worker_name AND t.date = b.date "
                     f"AND t.updated_at = b.updated_at)"), '1', 'same now()')
    save_payload(SUZUKI, payload(1, break_durations=[0, 60, 30]))
    expect(admin_sql(f"SELECT break_durations::text FROM \"WorkerDailyBreakSettings\" "
                     f"WHERE worker_name = '鈴木 次郎' AND date = '{D}'"), '[0, 60, 30]', 'upserted')


check('break settings are saved in the same transaction', breaks_saved_in_same_transaction)
for bad in (['x', 60, 30], [30, 60, 30, 0], [-1, 60, 30], {'a': 1}, None):
    check(f'invalid break_durations {bad!r} is refused', lambda bad=bad: save_payload(
        SUZUKI, payload(1, break_durations=bad), fail='休憩設定の内容が不正'))
check('break settings roll back with a failed save', lambda: (
    save_payload(SUZUKI, payload(1, break_durations=[15, 60, 15],
                                 updates=[{'id': R_PREV, 'data': {'note': 'x'}}]), fail='別の日か別の現場'),
    expect(admin_sql(f"SELECT break_durations::text FROM \"WorkerDailyBreakSettings\" "
                     f"WHERE worker_name = '鈴木 次郎' AND date = '{D}'"), '[0, 60, 30]', 'unchanged'))[-1])
check('break settings are saved for the effective worker, not the declared one', lambda: (
    save_payload(SUZUKI, {'project_id': 1, 'date': '2026-11-26', 'worker_id': 1, 'worker_name': '田中 太郎',
                          'break_durations': [30, 60, 30]}),
    expect(admin_sql("SELECT string_agg(worker_name, ',') FROM \"WorkerDailyBreakSettings\" WHERE date = '2026-11-26'"),
           '鈴木 次郎', 'self'))[-1])

check('office with an empty worker gets an input error', lambda: save_payload(
    OFFICE, {'project_id': 1, 'date': D, 'worker_id': None, 'worker_name': ' '}, fail='保存内容が不正'))

# ---------- DB-6: 承認に「画面で見た値」 ----------
admin_sql("INSERT INTO \"OvertimeApprovals\" (id, project_id, worker_name, date, status, requested_hours, updated_at) VALUES "
          "(11, 1, '鈴木 次郎', '2026-11-11', 'pending', 2, now()), "
          "(12, 1, '鈴木 次郎', '2026-11-12', 'pending', 1, now()), "
          "(13, 1, '鈴木 次郎', '2026-11-13', 'pending', 1, now())")

check('only the new approve functions remain (no overload ambiguity)', lambda: expect(
    admin_sql("SELECT string_agg(proname||'('||pg_get_function_identity_arguments(oid)||')', ' | ' ORDER BY proname) "
              "FROM pg_proc WHERE proname IN ('approve_overtime', 'approve_work_allowance')"),
    'approve_overtime(p_id bigint, p_approver_name text, p_approver_worker_id bigint, p_expected_hours numeric, '
    'p_expected_updated_at timestamp with time zone) | approve_work_allowance(p_id bigint, p_approver_name text, '
    'p_approver_worker_id bigint, p_expected_task_names text[], p_expected_updated_at timestamp with time zone)',
    'overloads'))
check('approval with different hours than seen is refused', lambda: (
    run("SELECT approve_overtime(11, '田中 太郎', 1, 1.5)", TANAKA, fail='申請の内容が変わりました'),
    expect(admin_sql('SELECT status FROM "OvertimeApprovals" WHERE id = 11'), 'pending', 'still pending'))[-1])
check('approval with the seen hours succeeds', lambda: (
    run("SELECT approve_overtime(11, '田中 太郎', 1, 2)", TANAKA),
    expect(admin_sql('SELECT status||\':\'||approved_hours FROM "OvertimeApprovals" WHERE id = 11'), 'approved:2', 'ok'))[-1])
check('approval with a stale updated_at is refused', lambda: run(
    "SELECT approve_overtime(12, '田中 太郎', 1, 1, '2000-01-01')", TANAKA, fail='申請の内容が変わりました'))
check('approval with the current updated_at succeeds', lambda: run(
    "SELECT approve_overtime(12, '田中 太郎', 1, 1, '"
    + admin_sql('SELECT updated_at FROM "OvertimeApprovals" WHERE id = 12') + "')", TANAKA))
check('old 3-argument call still approves (named arguments as supabase-js sends)', lambda: (
    run("SELECT approve_overtime(p_id => 13, p_approver_name => '田中 太郎', p_approver_worker_id => 1)", TANAKA),
    expect(admin_sql('SELECT status FROM "OvertimeApprovals" WHERE id = 13'), 'approved', 'old call'))[-1])
check('approving an already approved request is refused', lambda: run(
    "SELECT approve_overtime(13, '田中 太郎', 1)", TANAKA, fail='承認待ちではありません'))
check('non-foreman still cannot approve', lambda: run(
    "SELECT approve_overtime(1, '田中 太郎', 1, 1)", SUZUKI, fail='職長のみ'))
check('allowance approval with different task names is refused', lambda: (
    run("SELECT approve_work_allowance(1, '田中 太郎', 1, ARRAY['足場'])", TANAKA, fail='申請の内容が変わりました'),
    expect(admin_sql('SELECT status FROM "WorkAllowanceApprovals" WHERE id = 1'), 'pending', 'still pending'))[-1])
check('allowance approval compares task names regardless of order', lambda: (
    run("SELECT approve_work_allowance(1, '田中 太郎', 1, ARRAY['足場', '塗装'])", TANAKA),
    expect(admin_sql('SELECT status FROM "WorkAllowanceApprovals" WHERE id = 1'), 'approved', 'ok'))[-1])
check('allowance approval with a stale updated_at is refused', lambda: run(
    "SELECT approve_work_allowance(2, '田中 太郎', 1, NULL, '2000-01-01')", TANAKA, fail='申請の内容が変わりました'))

# ---------- M3 の準備: 部品・presence RPC・現場の名簿ビュー ----------
check('current_worker_name / my_foreman_project_ids', lambda: (
    expect(run("SELECT current_worker_name()||':'||my_foreman_project_ids()::text", TANAKA), '田中 太郎:{1}', 'tanaka'),
    expect(run("SELECT current_worker_name()||':'||my_foreman_project_ids()::text", SUZUKI), '鈴木 次郎:{3}', 'suzuki'),
    expect(run("SELECT coalesce(current_worker_name(), 'null')||':'||my_foreman_project_ids()::text", OFFICE),
           'null:{}', 'office'))[-1])
check('presence returns who worked where without hours', lambda: (
    expect(run("SELECT string_agg(DISTINCT worker_name, ',' ORDER BY worker_name) "
               "FROM get_task_record_presence('2026-11-24', '2026-11-25')", SUZUKI), '田中 太郎,鈴木 次郎', 'names'),
    expect(admin_sql("SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM ("
                     "SELECT unnest(proargnames) AS column_name, generate_subscripts(proargnames, 1) AS ordinal_position "
                     "FROM pg_proc WHERE proname = 'get_task_record_presence') a WHERE column_name NOT LIKE 'p\\_%'"),
           'project_id,worker_name,date', 'columns'))[-1])
check('presence refuses a long range', lambda: run(
    "SELECT count(*) FROM get_task_record_presence('2026-01-01', '2026-12-31')", SUZUKI, fail='期間の指定が不正'))
check('presence refuses viewer', lambda: run(
    "SELECT count(*) FROM get_task_record_presence('2026-11-24', '2026-11-25')", VIEWER, fail='権限がありません'))
check('projects_directory has no amount columns', lambda: expect(
    admin_sql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'projects_directory' "
              "AND column_name IN ('estimatedAmount', 'finalAmount', 'taxAmount', 'customerId')"), '0', 'no amounts'))
check('projects_directory is readable by worker and viewer, not by others', lambda: (
    expect(run('SELECT count(*) FROM projects_directory', SUZUKI), '3', 'worker'),
    expect(run('SELECT count(*) FROM projects_directory', VIEWER), '3', 'viewer'),
    expect(run('SELECT count(*) FROM projects_directory', OFFICE), '3', 'office'),
    expect(run('SELECT count(*) FROM projects_directory', SPARE), '0', 'unlinked'),
    expect(run('SELECT count(*) FROM projects_directory', RETIRED), '0', 'retired'))[-1])
check('anon cannot read projects_directory', lambda: run(
    'SELECT count(*) FROM projects_directory', role='anon', fail='permission denied'))
check('_touch_updated_at stays internal', lambda: expect(
    admin_sql("SELECT has_function_privilege('authenticated', 'public._touch_updated_at()', 'EXECUTE')"), 'f', 'internal'))

print(f'{len(passed)} daily-report hardening DB regressions passed; isolated database: {database}')
