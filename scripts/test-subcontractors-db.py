"""Run subcontractor (docs/specs/subcontractors.md) SQL regressions on a separate localhost PostgreSQL cluster.

Example: python scripts/test-subcontractors-db.py --port 55433
Creates a fresh database with synthetic records; never accepts a remote host.
"""
import argparse
import os
import subprocess
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, required=True)
args = parser.parse_args()
if args.port == 5432:
    parser.error('Use a separate test cluster port, not 5432.')
root = Path(__file__).resolve().parents[1]
database = 'subcontractors_test_' + uuid.uuid4().hex[:12]
base = ['psql', '-X', '-h', '127.0.0.1', '-p', str(args.port), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']


def raw(sql, db=database):
    env = {**os.environ, 'PGOPTIONS': '-c lc_messages=C', 'LANGUAGE': 'en'}  # サーバーのシステムメッセージを英語にそろえる
    return subprocess.run(base + ['-d', db], input=sql, text=True, encoding='utf-8', errors='replace', capture_output=True, env=env)


def uid(n):
    return f'00000000-0000-0000-0000-{n:012d}'


def run(sql, user=None, fail=None):
    """user（auth.users の UUID 末尾）としてログインした状態で実行する。user=None は未ログインの anon。"""
    role = 'authenticated' if user else 'anon'
    prefix = f"SET ROLE {role}; SET request.jwt.claim.sub='{uid(user) if user else ''}';\n"
    result = raw(prefix + sql)
    if fail:
        assert result.returncode and fail in result.stderr, (sql, result.stdout, result.stderr)
    else:
        assert result.returncode == 0, (sql, result.stderr)
    return result.stdout.strip()


def admin_sql(sql, fail=None):
    result = raw(sql)
    if fail:
        assert result.returncode and fail in result.stderr, (sql, result.stdout, result.stderr)
    else:
        assert result.returncode == 0, (sql, result.stderr)
    return result.stdout.strip()


def expect(actual, wanted, label):
    assert actual == wanted, (label, actual, wanted)


passed = []


def check(name, action):
    action()
    passed.append(name)
    print('PASS', name, flush=True)


ADMIN, OFFICE, FOREMAN, WORKER, VIEWER = 1, 2, 3, 4, 5
MIGRATION = 'supabase/migrations/20261112000000_subcontractors_phase_a.sql'

assert raw(f'CREATE DATABASE {database}', db='postgres').returncode == 0
for file in ['tests/db/subcontractors-fixture.sql', MIGRATION]:
    result = raw((root / file).read_text(encoding='utf-8'))
    assert result.returncode == 0, (file, result.stderr)

rerun = raw((root / MIGRATION).read_text(encoding='utf-8'))
check('migration is re-runnable', lambda: expect(rerun.returncode, 0, rerun.stderr))

# ---------- 名寄せ ----------
check('normalize treats ㈲ / 有限会社 / （有）as the same', lambda: expect(
    admin_sql("SELECT count(DISTINCT normalize_company_name(n)) FROM unnest(ARRAY["
              "'㈲菊池塗装工業所','有限会社菊池塗装工業所','（有）菊池塗装工業所','(有) 菊池塗装工業所']) n"), '1', 'normalize'))

# ---------- 会社マスタ → Workers 行 ----------
admin_sql("INSERT INTO \"Subcontractors\" (name, standard_unit_price) VALUES ('㈲菊池塗装工業所', 25000)")
admin_sql("INSERT INTO \"Subcontractors\" (name, standard_unit_price) VALUES ('㈲藤澤塗装', 0)")
check('inserting a company creates its Workers row', lambda: expect(
    admin_sql("SELECT string_agg(name||':'||display_order||':'||show_in_assignment, ',' ORDER BY subcontractor_id) "
              "FROM \"Workers\" WHERE subcontractor_id IS NOT NULL"),
    '㈲菊池塗装工業所:3:true,㈲藤澤塗装:4:true', 'workers'))
check('duplicate company with another notation is rejected', lambda: admin_sql(
    "INSERT INTO \"Subcontractors\" (name) VALUES ('有限会社菊池塗装工業所')", fail='subcontractors_normalized_name_key'))
check('negative standard price is rejected', lambda: admin_sql(
    "INSERT INTO \"Subcontractors\" (name, standard_unit_price) VALUES ('x', -1)", fail='subcontractors_standard_unit_price_nonneg'))

# ---------- Workers の保護トリガー ----------
check('subcontractor worker row cannot be renamed by hand', lambda: run(
    "UPDATE \"Workers\" SET name='x' WHERE subcontractor_id=1", OFFICE, fail='下請け会社マスタから変更'))
check('subcontractor worker row cannot be hidden by hand', lambda: run(
    "UPDATE \"Workers\" SET show_in_assignment=false WHERE subcontractor_id=1", OFFICE, fail='下請け会社マスタから変更'))
check('subcontractor worker row cannot be deleted', lambda: run(
    'DELETE FROM "Workers" WHERE subcontractor_id=1', OFFICE, fail='削除できません'))
check('subcontractor link cannot be changed', lambda: run(
    'UPDATE "Workers" SET subcontractor_id=NULL WHERE subcontractor_id=1', OFFICE, fail='変更できません'))
check('subcontractor row cannot be inserted directly', lambda: run(
    "INSERT INTO \"Workers\" (name, subcontractor_id) VALUES ('y', 2)", OFFICE, fail='下請け会社マスタから登録'))
check('display_order of a subcontractor row can be changed (assignment chart reorder)', lambda: expect(
    run("UPDATE \"Workers\" SET display_order=9 WHERE subcontractor_id=2 RETURNING display_order", OFFICE), '9', 'order'))
admin_sql("UPDATE \"Workers\" SET display_order=4 WHERE subcontractor_id=2")
check('regular worker rows are still editable', lambda: run(
    "UPDATE \"Workers\" SET name='田中 職長' WHERE id=1 RETURNING id", OFFICE))

# ---------- 日報の記録: 会社の照合・暫定契約・単価コピー ----------
P1 = 1
admin_sql(f"INSERT INTO \"SubcontractorRecords\" (project_id, date, company_name, worker_count, unit_price) "
          f"VALUES ({P1}, '2026-11-02', '有限会社菊池塗装工業所', 3, 0)")
check('record matches the company by normalized name and canonicalizes the name', lambda: expect(
    admin_sql("SELECT subcontractor_id||':'||company_name FROM \"SubcontractorRecords\" WHERE date='2026-11-02'"),
    '1:㈲菊池塗装工業所', 'match'))
check('a provisional joyo contract is created with the standard price', lambda: expect(
    admin_sql("SELECT type||':'||unit_price||':'||needs_review FROM \"SubcontractContracts\" "
              "WHERE project_id=1 AND subcontractor_id=1"), '常用:25000:true', 'contract'))
check('record unit price is copied from the contract', lambda: expect(
    admin_sql("SELECT unit_price FROM \"SubcontractorRecords\" WHERE date='2026-11-02'"), '25000', 'price'))
admin_sql(f"INSERT INTO \"SubcontractorRecords\" (project_id, date, company_name, worker_count) VALUES ({P1}, '2026-11-03', '㈲菊池塗装工業所', 2)")
check('a second record reuses the contract', lambda: expect(
    admin_sql("SELECT count(*) FROM \"SubcontractContracts\" WHERE project_id=1 AND subcontractor_id=1"), '1', 'count'))
admin_sql(f"INSERT INTO \"SubcontractorRecords\" (project_id, date, company_name, worker_count, unit_price) "
          f"VALUES ({P1}, '2026-11-04', '未登録の会社', 1, 0)")
check('unmatched company is saved with NULL id and no contract (never rejected)', lambda: expect(
    admin_sql("SELECT coalesce(subcontractor_id::text,'null')||':'||company_name||':'||unit_price "
              "FROM \"SubcontractorRecords\" WHERE date='2026-11-04'"), 'null:未登録の会社:0', 'unmatched'))
check('a non-zero price on insert is kept', lambda: (
    admin_sql(f"INSERT INTO \"SubcontractorRecords\" (project_id, date, company_name, worker_count, unit_price) "
              f"VALUES ({P1}, '2026-11-05', '㈲菊池塗装工業所', 1, 30000)"),
    expect(admin_sql("SELECT unit_price FROM \"SubcontractorRecords\" WHERE date='2026-11-05'"), '30000', 'kept'))[-1])
check('renaming to another company re-matches and re-copies the price', lambda: (
    admin_sql("UPDATE \"SubcontractorRecords\" SET company_name='㈲藤澤塗装' WHERE date='2026-11-03'"),
    expect(admin_sql("SELECT subcontractor_id||':'||unit_price FROM \"SubcontractorRecords\" WHERE date='2026-11-03'"),
           '2:0', 'rematch'))[-1])
check('a pending contract for the new company has the standard price 0 and needs review', lambda: expect(
    admin_sql("SELECT unit_price||':'||needs_review FROM \"SubcontractContracts\" WHERE project_id=1 AND subcontractor_id=2"),
    '0:true', 'contract2'))

# ---------- 請負契約 ----------
admin_sql("INSERT INTO \"SubcontractContracts\" (project_id, subcontractor_id, type, contract_amount, start_date, end_date, scope) "
          "VALUES (1, 1, '請負', 500000, '2026-11-10', '2026-11-12', '外壁塗装')")
check('overlapping ukeoi periods are rejected', lambda: admin_sql(
    "INSERT INTO \"SubcontractContracts\" (project_id, subcontractor_id, type, contract_amount, start_date, end_date) "
    "VALUES (1, 1, '請負', 1, '2026-11-12', '2026-11-20')", fail='subcontract_contracts_ukeoi_no_overlap'))
check('adjacent ukeoi periods are accepted (closed interval)', lambda: admin_sql(
    "INSERT INTO \"SubcontractContracts\" (project_id, subcontractor_id, type, contract_amount, start_date, end_date) "
    "VALUES (1, 1, '請負', 100000, '2026-11-13', '2026-11-13')"))
check('ukeoi without a start date is rejected', lambda: admin_sql(
    "INSERT INTO \"SubcontractContracts\" (project_id, subcontractor_id, type, contract_amount) VALUES (2, 1, '請負', 1)",
    fail='subcontract_contracts_ukeoi_check'))
check('a second joyo contract for the same project and company is rejected', lambda: admin_sql(
    "INSERT INTO \"SubcontractContracts\" (project_id, subcontractor_id, type, unit_price) VALUES (1, 1, '常用', 1)",
    fail='subcontract_contracts_joyo_key'))
check('a ukeoi period may be open-ended in another project', lambda: admin_sql(
    "INSERT INTO \"SubcontractContracts\" (project_id, subcontractor_id, type, contract_amount, start_date) "
    "VALUES (2, 1, '請負', 100, '2026-11-01')"))

admin_sql(f"INSERT INTO \"SubcontractorRecords\" (project_id, date, company_name, worker_count) VALUES ({P1}, '2026-11-11', '㈲菊池塗装工業所', 4)")
check('a record inside a ukeoi period keeps unit price 0 (not costed)', lambda: expect(
    admin_sql("SELECT unit_price FROM \"SubcontractorRecords\" WHERE date='2026-11-11'"), '0', 'ukeoi price'))
admin_sql(f"INSERT INTO \"SubcontractorRecords\" (project_id, date, company_name, worker_count) VALUES ({P1}, '2026-11-14', '㈲菊池塗装工業所', 2)")
check('a record after the ukeoi period is costed as joyo', lambda: expect(
    admin_sql("SELECT unit_price FROM \"SubcontractorRecords\" WHERE date='2026-11-14'"), '25000', 'joyo price'))

# ---------- 職長向けの協力業者費合計 ----------
# 現場1: 常用 11-02(3×25000) + 11-05(1×30000) + 11-14(2×25000) + 未登録 11-04(1×0) + 藤澤 11-03(2×0)、請負 500000 + 100000
EXPECTED_COST = str(75000 + 30000 + 50000 + 600000)
check('admin cost = joyo (outside ukeoi periods) + ukeoi amounts', lambda: expect(
    run('SELECT get_project_subcontract_cost(1, NULL, NULL)', ADMIN), EXPECTED_COST, 'cost'))
check('the declared foreman gets the same total without seeing prices', lambda: expect(
    run("SELECT get_project_subcontract_cost(1, 1, '田中 職長')", FOREMAN), EXPECTED_COST, 'foreman'))
check('a worker who is not this project foreman is denied', lambda: run(
    "SELECT get_project_subcontract_cost(1, 2, '鈴木 作業員')", WORKER, fail='権限がありません'))
check('a viewer is denied', lambda: run('SELECT get_project_subcontract_cost(1, NULL, NULL)', VIEWER, fail='権限がありません'))
check('anon cannot execute the cost RPC', lambda: run('SELECT get_project_subcontract_cost(1, NULL, NULL)', fail='permission denied'))

# ---------- 暫定契約の確定 ----------
check('office confirms the pending contract: only zero-price joyo records are updated', lambda: (
    expect(run("SELECT confirm_subcontract_contract(c.id, 26000) FROM \"SubcontractContracts\" c "
               "WHERE c.project_id=1 AND c.subcontractor_id=2 AND c.type='常用'", OFFICE), '1', 'updated'),
    expect(admin_sql("SELECT unit_price||':'||needs_review FROM \"SubcontractContracts\" WHERE project_id=1 AND subcontractor_id=2 AND type='常用'"),
           '26000:false', 'contract'),
    expect(admin_sql("SELECT unit_price FROM \"SubcontractorRecords\" WHERE date='2026-11-03'"), '26000', 'record'))[-1])
check('confirmation does not overwrite non-zero prices or ukeoi-period records', lambda: (
    admin_sql("UPDATE \"SubcontractContracts\" SET needs_review=true WHERE project_id=1 AND subcontractor_id=1 AND type='常用'"),
    run("SELECT confirm_subcontract_contract(c.id, 99999) FROM \"SubcontractContracts\" c "
        "WHERE c.project_id=1 AND c.subcontractor_id=1 AND c.type='常用'", OFFICE),
    expect(admin_sql("SELECT string_agg(date||'='||unit_price, ',' ORDER BY date) FROM \"SubcontractorRecords\" "
                     "WHERE subcontractor_id=1"),
           '2026-11-02=25000,2026-11-05=30000,2026-11-11=0,2026-11-14=25000', 'non-zero kept'))[-1])
JOYO_ID = admin_sql("SELECT id FROM \"SubcontractContracts\" WHERE type='常用' LIMIT 1")
UKEOI_ID = admin_sql("SELECT id FROM \"SubcontractContracts\" WHERE type='請負' LIMIT 1")
check('a worker cannot confirm a contract', lambda: run(
    f"SELECT confirm_subcontract_contract('{JOYO_ID}', 1)", FOREMAN, fail='権限がありません'))
check('only joyo contracts can be confirmed', lambda: run(
    f"SELECT confirm_subcontract_contract('{UKEOI_ID}', 1)", OFFICE, fail='常用の契約だけ'))

# ---------- 権限（RLS・ビュー） ----------
check('worker cannot read contracts or the company master directly', lambda: (
    expect(run('SELECT count(*) FROM "SubcontractContracts"', FOREMAN), '0', 'contracts'),
    expect(run('SELECT count(*) FROM "Subcontractors"', FOREMAN), '0', 'master'))[-1])
check('worker cannot write contracts', lambda: run(
    "INSERT INTO \"SubcontractContracts\" (project_id, subcontractor_id, type, unit_price) VALUES (2, 2, '常用', 1)",
    FOREMAN, fail='row-level security'))
check('office reads and writes contracts', lambda: expect(run('SELECT count(*) > 0 FROM "SubcontractContracts"', OFFICE), 't', 'office'))
check('worker reads the company directory without prices', lambda: (
    expect(run('SELECT count(*) FROM subcontractors_directory', FOREMAN), '2', 'dir'),
    run('SELECT standard_unit_price FROM subcontractors_directory', FOREMAN, fail='standard_unit_price'))[-1])
check('viewer sees nothing in the directory views', lambda: (
    expect(run('SELECT count(*) FROM subcontractors_directory', VIEWER), '0', 'dir'),
    expect(run('SELECT count(*) FROM subcontractor_records_directory', VIEWER), '0', 'records'))[-1])
check('worker records view has no price column', lambda: run('SELECT unit_price FROM subcontractor_records_directory', FOREMAN, fail='unit_price'))
check('anon cannot read the new tables or views', lambda: (
    run('SELECT count(*) FROM "Subcontractors"', fail='permission denied'),
    run('SELECT count(*) FROM subcontractors_directory', fail='permission denied'),
    run('SELECT count(*) FROM "SubcontractContracts"', fail='permission denied'))[-1])
check('workers_directory exposes subcontractor_id', lambda: expect(
    run('SELECT count(*) FROM workers_directory WHERE subcontractor_id IS NOT NULL', OFFICE), '2', 'wd'))

# ---------- 同期（名前・無効化） ----------
admin_sql("UPDATE \"Subcontractors\" SET name='㈲菊池塗装' WHERE id=1")
check('renaming a company updates the Workers row and the record copies', lambda: (
    expect(admin_sql("SELECT name FROM \"Workers\" WHERE subcontractor_id=1"), '㈲菊池塗装', 'worker'),
    expect(admin_sql("SELECT count(DISTINCT company_name) FROM \"SubcontractorRecords\" WHERE subcontractor_id=1"), '1', 'copies'),
    expect(admin_sql("SELECT DISTINCT company_name FROM \"SubcontractorRecords\" WHERE subcontractor_id=1"), '㈲菊池塗装', 'name'))[-1])
admin_sql("UPDATE \"Subcontractors\" SET active=false WHERE id=2")
check('deactivating a company hides its assignment row', lambda: expect(
    admin_sql("SELECT show_in_assignment FROM \"Workers\" WHERE subcontractor_id=2"), 'f', 'hidden'))
check('a company with a Workers row cannot be deleted', lambda: admin_sql(
    'DELETE FROM "Subcontractors" WHERE id=2', fail='violates foreign key'))

# ---------- Assignments ----------
check('planned_count accepts NULL and positive values, rejects negative', lambda: (
    admin_sql("INSERT INTO \"Assignments\" (date, \"workerId\", \"projectId\", planned_count) "
              "SELECT '2026-11-20', id, 1, 3 FROM \"Workers\" WHERE subcontractor_id=1"),
    admin_sql("INSERT INTO \"Assignments\" (date, \"workerId\", \"projectId\") VALUES ('2026-11-21', 1, 1)"),
    admin_sql("INSERT INTO \"Assignments\" (date, \"workerId\", \"projectId\", planned_count) VALUES ('2026-11-22', 1, 1, -1)",
              fail='assignments_planned_count_nonneg'))[-1])

# ---------- 旧クライアント互換 ----------
check('the old worker SELECT policy is untouched in phase A', lambda: expect(
    admin_sql("SELECT count(*) FROM pg_policies WHERE tablename='SubcontractorRecords' AND policyname='subcontractor_records_select_worker'"),
    '1', 'policy'))

print(f'{len(passed)} checks passed')
raw(f'DROP DATABASE {database}', db='postgres')
