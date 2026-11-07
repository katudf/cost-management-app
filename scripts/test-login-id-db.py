"""Run login-id (docs/specs/login-id.md) SQL regressions on a separate localhost PostgreSQL cluster.

Example: python scripts/test-login-id-db.py --port 55432
Creates a fresh database with synthetic records; never accepts a remote host.
"""
import argparse
import re
import subprocess
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, required=True)
args = parser.parse_args()
if args.port == 5432:
    parser.error('Use a separate test cluster port, not 5432.')
root = Path(__file__).resolve().parents[1]
database = 'login_id_test_' + uuid.uuid4().hex[:12]
base = ['psql', '-X', '-h', '127.0.0.1', '-p', str(args.port), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']


def raw(sql, db=database):
    return subprocess.run(base + ['-d', db], input=sql, text=True, encoding='utf-8', capture_output=True)


def uid(staff):
    return f'00000000-0000-0000-0000-{staff:012d}'


def run(sql, staff=None, role='authenticated', fail=None):
    """staff の担当者としてログインした状態（role=authenticated）か、service_role で実行する。"""
    prefix = f"SET ROLE {role}; SET request.jwt.claim.sub='{uid(staff) if staff else ''}';\n"
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


passed = []


def check(name, action):
    action()
    passed.append(name)
    print('PASS', name, flush=True)


SYSTEM_ADMIN, ADMIN_A, ADMIN_B, OFFICE, WORKER = 1, 2, 3, 4, 5

assert raw(f'CREATE DATABASE {database}', db='postgres').returncode == 0
for file in ['tests/db/login-id-fixture.sql',
             'supabase/migrations/20261026100000_password_change_logs.sql',
             'supabase/migrations/20261107000000_login_id_management.sql']:
    result = raw((root / file).read_text(encoding='utf-8'))
    assert result.returncode == 0, (file, result.stderr)

# マイグレーションは2回流しても失敗しない
result = raw((root / 'supabase/migrations/20261107000000_login_id_management.sql').read_text(encoding='utf-8'))
check('migration is re-runnable', lambda: (result.returncode == 0) or (_ for _ in ()).throw(AssertionError(result.stderr)))


# 架空メールのドメインは SQL・画面・Edge Function の3か所にあるので、一致を確かめる
def same_domain_everywhere():
    sql_domain = admin_sql('SELECT login_id_email_domain()')
    for path in ['src/utils/loginId.js', 'supabase/functions/manage-staff-login/handler.ts']:
        match = re.search(r"LOGIN_ID_EMAIL_DOMAIN\s*=\s*'([^']+)'", (root / path).read_text(encoding='utf-8'))
        assert match and match.group(1) == sql_domain, (path, match and match.group(1), sql_domain)


check('email domain matches SQL, front end and Edge Function', same_domain_everywhere)
check('login id from email', lambda: (
    admin_sql("SELECT login_id_from_email('Kimura01@LOGIN.invalid')||','||coalesce(login_id_from_email('a@login.invalid.example.com'),'null')||','||coalesce(login_id_from_email('a@xlogin.invalid'),'null')")
    == 'kimura01,null,null' or (_ for _ in ()).throw(AssertionError('login_id_from_email'))))

# ---------- 保護トリガー（決定 #11） ----------
check('admin cannot demote another admin', lambda: run(
    "UPDATE office_staff SET role='office' WHERE id=3", ADMIN_A, fail='システム管理者だけ'))
check('admin cannot promote office to admin', lambda: run(
    "UPDATE office_staff SET role='admin' WHERE id=4", ADMIN_A, fail='システム管理者だけ'))
check('admin cannot unlink another admin', lambda: run(
    "UPDATE office_staff SET auth_user_id=NULL WHERE id=3", ADMIN_A, fail='システム管理者だけ'))
check('admin can still relink an office row', lambda: run(
    f"UPDATE office_staff SET auth_user_id='{uid(7)}' WHERE id=6", ADMIN_A))  # office の行は従来どおり admin が付け替え可
admin_sql("SELECT set_config('app.bypass_staff_protect_trigger','on',false); UPDATE office_staff SET auth_user_id=NULL WHERE id=6;")
check('admin cannot insert admin', lambda: run(
    "INSERT INTO office_staff (id,name,role) VALUES (90,'x','admin')", ADMIN_A, fail='システム管理者だけ'))
check('admin can insert office', lambda: run(
    "INSERT INTO office_staff (id,name,role) VALUES (91,'x','office')", ADMIN_A))
check('admin can rename another admin', lambda: run(
    "UPDATE office_staff SET name='管理者B（改）' WHERE id=3 RETURNING id", ADMIN_A))
check('admin cannot delete another admin', lambda: run(
    "DELETE FROM office_staff WHERE id=3", ADMIN_A, fail='システム管理者だけ'))
check('row with login cannot be deleted directly', lambda: run(
    "DELETE FROM office_staff WHERE id=4", ADMIN_A, fail='削除ボタン'))
check('row without login can be deleted directly', lambda: run(
    "DELETE FROM office_staff WHERE id=91", ADMIN_A))
check('office cannot change own role', lambda: run(
    "UPDATE office_staff SET role='admin' WHERE id=4", OFFICE, fail='管理者のみ'))
check('system admin can demote admin', lambda: run(
    "UPDATE office_staff SET role='office' WHERE id=3; UPDATE office_staff SET role='admin' WHERE id=3", SYSTEM_ADMIN))

# ---------- ID取得 RPC ----------
check('office gets no login ids', lambda: (
    run('SELECT count(*) FROM get_office_staff_login_ids()', OFFICE) == '0'
    or (_ for _ in ()).throw(AssertionError('office saw login ids'))))
check('admin gets login ids and legacy emails', lambda: (
    run("SELECT string_agg(staff_id||':'||coalesce(login_id,'-')||':'||coalesce(legacy_email,'-'), ',' ORDER BY staff_id) FROM get_office_staff_login_ids()", ADMIN_A)
    == '1:sysadmin:-,2:-:admin-a@example.com,3:admin-b:-,4:office:-,5:genba:-'
    or (_ for _ in ()).throw(AssertionError('unexpected login ids'))))
check('own login id', lambda: (
    run('SELECT get_my_login_id()', WORKER) == 'genba' or (_ for _ in ()).throw(AssertionError('own id'))))
check('legacy email user has no login id', lambda: (
    run('SELECT coalesce(get_my_login_id(),\'null\')', ADMIN_A) == 'null' or (_ for _ in ()).throw(AssertionError('legacy'))))

# ---------- Edge Function 専用 RPC ----------
for fn in ["assert_can_manage_staff_login('%s', 5, false)" % uid(ADMIN_A),
           "link_staff_login('%s', 6, '%s')" % (uid(ADMIN_A), uid(7)),
           "delete_staff_with_login('%s', 5)" % uid(ADMIN_A),
           "log_admin_password_reset('%s', 4)" % uid(ADMIN_A),
           "sync_password_fingerprint('%s')" % uid(4)]:
    check(f'authenticated cannot call {fn.split("(")[0]}', lambda f=fn: run(f'SELECT {f}', ADMIN_A, fail='permission denied'))

check('admin may manage worker', lambda: service(f"SELECT (assert_can_manage_staff_login('{uid(ADMIN_A)}', 5)).id"))
check('admin may not manage admin', lambda: service(
    f"SELECT assert_can_manage_staff_login('{uid(ADMIN_A)}', 3)", fail='システム管理者だけ'))
check('admin may not manage system admin', lambda: service(
    f"SELECT assert_can_manage_staff_login('{uid(ADMIN_A)}', 1)", fail='システム管理者だけ'))
check('system admin may manage admin', lambda: service(f"SELECT assert_can_manage_staff_login('{uid(SYSTEM_ADMIN)}', 3)"))
check('office may not manage anyone', lambda: service(
    f"SELECT assert_can_manage_staff_login('{uid(OFFICE)}', 5)", fail='管理者権限'))
check('unknown staff', lambda: service(
    f"SELECT assert_can_manage_staff_login('{uid(ADMIN_A)}', 999)", fail='見つかりません'))

check('link new login', lambda: service(f"SELECT link_staff_login('{uid(ADMIN_A)}', 7, '{uid(7)}')"))
check('link sets fingerprint', lambda: (
    admin_sql(f"SELECT count(*) FROM password_change_log_state WHERE auth_user_id='{uid(7)}'") == '1'
    or (_ for _ in ()).throw(AssertionError('fingerprint'))))
check('link refuses already linked staff', lambda: service(
    f"SELECT link_staff_login('{uid(ADMIN_A)}', 7, '{uid(7)}')", fail='既にログイン'))
check('admin cannot link admin row', lambda: service(
    f"SELECT link_staff_login('{uid(ADMIN_A)}', 3, '{uid(7)}')", fail='システム管理者だけ'))

check('admin reset logged with operator', lambda: service(f"SELECT log_admin_password_reset('{uid(ADMIN_A)}', 4, 'UA', '1.2.3.4', '1.2.3.4')"))
check('admin reset row', lambda: (
    admin_sql("SELECT kind||':'||login_id||':'||operator_staff_name||':'||staff_name FROM password_change_logs ORDER BY id DESC LIMIT 1")
    == 'admin_reset:office:管理者A:事務' or (_ for _ in ()).throw(AssertionError('reset row'))))
check('self log after admin reset is not recorded', lambda: (
    run("SELECT log_password_change('self')", OFFICE) is not None
    and admin_sql("SELECT count(*) FROM password_change_logs WHERE kind='self'") == '0'
    or (_ for _ in ()).throw(AssertionError('fake self log'))))
admin_sql(f"UPDATE auth.users SET encrypted_password='hash-4b', updated_at=now() WHERE id='{uid(OFFICE)}'")
check('real self change is recorded with login id', lambda: (
    run("SELECT log_password_change('self')", OFFICE) is not None
    and admin_sql("SELECT kind||':'||login_id FROM password_change_logs WHERE kind='self'") == 'self:office'
    or (_ for _ in ()).throw(AssertionError('self row'))))
check('client cannot log admin_reset', lambda: run("SELECT log_password_change('admin_reset')", OFFICE, fail='invalid'))

check('cannot delete self', lambda: service(
    f"SELECT delete_staff_with_login('{uid(SYSTEM_ADMIN)}', 1)", fail='自分自身'))
check('admin cannot delete admin with login', lambda: service(
    f"SELECT delete_staff_with_login('{uid(ADMIN_A)}', 3)", fail='システム管理者だけ'))
check('delete returns auth user and removes row', lambda: (
    service(f"SELECT delete_staff_with_login('{uid(ADMIN_A)}', 5)") == uid(WORKER)
    and admin_sql('SELECT count(*) FROM office_staff WHERE id=5') == '0'
    or (_ for _ in ()).throw(AssertionError('delete'))))
check('delete row without login returns null', lambda: (
    service(f"SELECT coalesce(delete_staff_with_login('{uid(ADMIN_A)}', 8)::text,'null')") == 'null'
    or (_ for _ in ()).throw(AssertionError('delete null'))))

print(f'{len(passed)} login-id DB regressions passed; isolated database: {database}')
