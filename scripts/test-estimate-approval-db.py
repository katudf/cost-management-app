"""Run estimate SQL regressions on a separate localhost PostgreSQL cluster.

Example: python scripts/test-estimate-approval-db.py --port 55432
Creates a fresh database with synthetic records; never accepts a remote host.
"""
import argparse
import concurrent.futures
import json
import subprocess
import time
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, required=True)
args = parser.parse_args()
if args.port == 5432:
    parser.error('Use a separate test cluster port, not 5432.')
root = Path(__file__).resolve().parents[1]
database = 'estimate_test_' + uuid.uuid4().hex[:12]
base = ['psql', '-X', '-h', '127.0.0.1', '-p', str(args.port), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']


def raw(sql, db=database):
    return subprocess.run(base + ['-d', db], input=sql, text=True, encoding='utf-8', capture_output=True)


def query(sql, staff=1, fail=None):
    jwt = f'00000000-0000-0000-0000-{staff:012d}' if staff else ''
    result = raw(f"SET ROLE authenticated; SET request.jwt.claim.sub='{jwt}';\n" + sql)
    if fail:
        assert result.returncode and fail in result.stderr, (sql, result.stdout, result.stderr)
    else:
        assert result.returncode == 0, (sql, result.stderr)
    return result.stdout.strip()


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def header(number, title='Latest content', total=110):
    return dict(estimate_number=number, customer_id=1, title=title, issue_date='2026-10-01',
                payment_terms='', tax_rate=0.1, show_net=True, show_subtotals=False,
                stamp_header='company', show_approver=False, staff_id=1,
                net_calc_type='perc', net_perc=95, total_with_tax=total)


sheets = [dict(id=None, title='Top')]
items = [dict(sheet_index=0, item_type='item', name='Updated detail', quantity=1, unit_price=100, amount=100)]


def save_sql(estimate_id, data, ss=sheets, ii=items, submit=False, approver=2):
    return (f"SELECT public.save_estimate_v3({estimate_id or 'NULL'}, {literal(data)}, {literal(ss)}, "
            f"{literal(ii)}, {'true' if submit else 'false'}, {approver if submit else 'NULL'});")


passed = []


def check(name, action):
    action()
    passed.append(name)
    print('PASS', name, flush=True)


assert raw(f'CREATE DATABASE {database}', db='postgres').returncode == 0
for file in ['tests/db/estimate-approval-fixture.sql', 'tests/db/estimate-approval-live-definitions.sql',
             'supabase/migrations/20261001000000_atomic_estimate_save_and_content_lock.sql']:
    result = raw((root / file).read_text(encoding='utf-8'))
    assert result.returncode == 0, result.stderr

created = json.loads(query(save_sql(None, header('261001-9001-001'), submit=True)))
eid = created['id']
sid = created['sheet_ids'][0]
check('new unsaved estimate saves and submits atomically', lambda: (
    query(f"SELECT 1/(CASE WHEN status='pending' AND payment_terms='' AND total_with_tax=110 THEN 1 ELSE 0 END) FROM estimates WHERE id={eid}")))

for role in [1, 2, 3, 4]:
    for table, statement in [
        ('header', f"UPDATE estimates SET title='tampered' WHERE id={eid}"),
        ('approver', f"UPDATE estimates SET approver_staff_id=3 WHERE id={eid}"),
        ('item insert', f"INSERT INTO estimate_items(estimate_id,item_type,name) VALUES ({eid},'item','tampered')"),
        ('item update', f"UPDATE estimate_items SET amount=999 WHERE estimate_id={eid}"),
        ('item delete', f"DELETE FROM estimate_items WHERE estimate_id={eid}"),
        ('sheet insert', f"INSERT INTO estimate_sheets(estimate_id) VALUES ({eid})"),
        ('sheet update', f"UPDATE estimate_sheets SET title='tampered' WHERE estimate_id={eid}"),
        ('sheet delete', f"DELETE FROM estimate_sheets WHERE estimate_id={eid}"),
        ('v2 RPC', f"SELECT save_estimate_items_v2({eid},'[]','[]')"),
        ('v3 RPC', save_sql(eid, header('261001-9001-001'))),
    ]:
        check(f'pending {table} rejected for staff {role}', lambda st=statement, r=role: query(st, r, fail='ERROR'))

check('other approver rejected', lambda: query(f'SELECT approve_estimate({eid})', 3, fail='指名'))
check('designated approver succeeds', lambda: query(f'SELECT approve_estimate({eid})', 2))
check('second approval rejected', lambda: query(f'SELECT approve_estimate({eid})', 2, fail='承認依頼中'))
for role in [1, 2, 3, 4]:
    for name, statement in [
        ('header', f"UPDATE estimates SET title='tampered' WHERE id={eid}"),
        ('approver', f"UPDATE estimates SET approver_staff_id=3 WHERE id={eid}"),
        ('item insert', f"INSERT INTO estimate_items(estimate_id,item_type,name) VALUES ({eid},'item','tampered')"),
        ('item update', f"UPDATE estimate_items SET amount=999 WHERE estimate_id={eid}"),
        ('item delete', f"DELETE FROM estimate_items WHERE estimate_id={eid}"),
        ('sheet insert', f"INSERT INTO estimate_sheets(estimate_id) VALUES ({eid})"),
        ('sheet update', f"UPDATE estimate_sheets SET title='tampered' WHERE estimate_id={eid}"),
        ('sheet delete', f"DELETE FROM estimate_sheets WHERE estimate_id={eid}"),
        ('v2 RPC', f"SELECT save_estimate_items_v2({eid},'[]','[]')"),
        ('v3 RPC', save_sql(eid,header('261001-9001-001'))),
    ]:
        check(f'approved {name} rejected for staff {role}', lambda st=statement,r=role: query(st,r,fail='ERROR'))

check('approved header edit rejected', lambda: query(f"UPDATE estimates SET payment_terms='changed' WHERE id={eid}", fail='下書き'))
check('approved item edit rejected', lambda: query(f"UPDATE estimate_items SET name='changed' WHERE estimate_id={eid}", fail='下書き'))
check('approved save RPC rejected', lambda: query(save_sql(eid, header('261001-9001-001')), fail='下書き'))
check('other creator cannot revert', lambda: query(f"UPDATE estimates SET status='draft' WHERE id={eid}", 3, fail='作成者'))
check('customer submission transition', lambda: query(f"UPDATE estimates SET status='submitted' WHERE id={eid}"))
check('order and project linkage', lambda: query(f"UPDATE estimates SET status='ordered',lost_reason='' WHERE id={eid}; UPDATE estimates SET project_id=1 WHERE id={eid}"))
check('ordered cannot change to lost', lambda: query(f"UPDATE estimates SET status='lost' WHERE id={eid}", fail='遷移'))
check('logical delete and restore', lambda: query(f"UPDATE estimates SET deleted_at=now() WHERE id={eid}; SELECT restore_estimate({eid})"))
check('admin revert clears approval trail', lambda: query(f"UPDATE estimates SET status='draft' WHERE id={eid}; SELECT 1/(CASE WHEN approved_at IS NULL AND approved_by IS NULL THEN 1 ELSE 0 END) FROM estimates WHERE id={eid}", 4))

ss = [dict(id=sid, title='Top')]
check('unsaved header and items saved on resubmission', lambda: query(save_sql(eid, header('261001-9001-001', 'Resubmitted latest', 220), ss, [dict(items[0], amount=200)], True)))
check('return by designated approver', lambda: query(f"SELECT return_estimate({eid},'Fix details')", 2))
check('returned stays locked', lambda: query(f"UPDATE estimate_items SET amount=999 WHERE estimate_id={eid}", fail='下書き'))
check('creator revert and resubmit', lambda: query(f"UPDATE estimates SET status='draft' WHERE id={eid}; " + save_sql(eid, header('261001-9001-001'), ss, items, True)))
check('lost transition', lambda: query(f"SELECT approve_estimate({eid}); UPDATE estimates SET status='submitted' WHERE id={eid}; UPDATE estimates SET status='lost',lost_reason='Lost test' WHERE id={eid}", 2))
check('non-creator cannot change content while reverting', lambda: query(f"UPDATE estimates SET status='draft',title='tampered' WHERE id={eid}", 4, fail='下書き以外'))
check('parent delete cascades children', lambda: query(f'DELETE FROM estimates WHERE id={eid}', 4))

draft = json.loads(query(save_sql(None, header('261001-9002-001'))))
did, dsid = draft['id'], draft['sheet_ids'][0]
before = query(f"SELECT to_jsonb(e)::text FROM estimates e WHERE id={did}")
before_items = query(f"SELECT jsonb_agg(i ORDER BY id)::text FROM estimate_items i WHERE estimate_id={did}")
check('existing invalid item rolls back header sheets and items', lambda: query(
    save_sql(did, header('261001-9002-001','Should roll back'), [dict(id=dsid,title='Should roll back')], [dict(items[0],item_type='invalid')]), fail='check constraint'))
assert before == query(f"SELECT to_jsonb(e)::text FROM estimates e WHERE id={did}")
assert before_items == query(f"SELECT jsonb_agg(i ORDER BY id)::text FROM estimate_items i WHERE estimate_id={did}")
assert query(f"SELECT title FROM estimate_sheets WHERE id='{dsid}'") == 'Top'
check('new failure leaves no orphan header', lambda: query(save_sql(None, header('261001-9003-001'), ii=[dict(items[0],item_type='invalid')], submit=True), fail='check constraint'))
assert query("SELECT count(*) FROM estimates WHERE estimate_number='261001-9003-001'") == '0'
check('retry after failure succeeds', lambda: query(save_sql(None, header('261001-9003-001'), submit=True)))
check('duplicate number rejected by DB', lambda: query(save_sql(None, header('261001-9002-001')), fail='unique constraint'))
check('invalid total rolls back', lambda: query(save_sql(did, header('261001-9002-001',total=999), [dict(id=dsid,title='Top')]), fail='合計'))
check('foreign sheet rejected', lambda: query(save_sql(did, header('261001-9002-001'), [dict(id=created['sheet_ids'][0],title='Foreign')]), fail='所属'))
check('out of range sheet link rejected', lambda: query(save_sql(did, header('261001-9002-001'), [dict(id=dsid,title='Top')], [dict(items[0],linked_sheet_index=8)]), fail='参照'))
check('viewer RPC rejected', lambda: query(save_sql(None,header('261001-9004-001')),5,fail='権限'))
check('missing auth RPC rejected', lambda: query(save_sql(None,header('261001-9004-001')),0,fail='権限'))
check('invalid designated approver rolls back', lambda: query(save_sql(did,header('261001-9002-001'),[dict(id=dsid,title='Top')],submit=True,approver=1),fail='承認者'))
check('direct pending transition rejected', lambda: query(f"UPDATE estimates SET status='pending',approver_staff_id=2 WHERE id={did}",fail='遷移'))
check('anon lacks RPC execute', lambda: (
    raw(f"SET ROLE anon; SELECT save_estimate_v3(NULL,{literal(header('261001-9004-001'))},'[]','[]',false,NULL)").returncode != 0
    or (_ for _ in ()).throw(AssertionError('anon execute allowed'))))

check('cross-estimate child reparent rejected', lambda: query(f"UPDATE estimate_items SET estimate_id=1 WHERE estimate_id={did}",fail='所属見積'))
check('invalid sheet causes full new rollback', lambda: query(save_sql(None,header('261001-9004-001'),[dict(id=dsid,title='Foreign')]),fail='所属'))

# Stable sheet UUIDs and new item IDs / category links survive the atomic request.
linked_items = [dict(sheet_index=0,item_type='item',name='Category link',amount=100,linked_item_index=1),
                dict(sheet_index=1,item_type='category',name='Category'),
                dict(sheet_index=1,item_type='item',name='Sub detail',amount=100)]
check('temporary sheet and category links remapped', lambda: query(save_sql(did,header('261001-9002-001'),[dict(id=dsid,title='Top'),dict(id=None,title='Sub')],linked_items)))
assert query(f"SELECT count(*) FROM estimate_items i JOIN estimate_items t ON t.id=i.linked_category_item_id WHERE i.estimate_id={did} AND t.item_type='category'") == '1'

clone = json.loads(query(save_sql(None,header('261001-9005-001'),[dict(id=None,title='Top'),dict(id=None,title='Sub')],linked_items,True)))
check('linked parent cascade deletion preserves content protection', lambda: query(f"DELETE FROM estimates WHERE id={clone['id']}"))
clone = json.loads(query(save_sql(None,header('261001-9005-001'),[dict(id=None,title='Top'),dict(id=None,title='Sub')],linked_items,True)))
query(f"UPDATE estimates SET deleted_at=now()-interval '31 days' WHERE id={clone['id']}")
check('expired linked estimate purges with category FK cleanup', lambda: query('SELECT purge_expired_estimates()'))

# Saving first holds the parent lock; a concurrent approval waits for submission.
lock_sql = save_sql(did,header('261001-9002-001'),[dict(id=dsid,title='Top')],items,True)
with concurrent.futures.ThreadPoolExecutor() as executor:
    held = executor.submit(query, 'BEGIN; ' + lock_sql + ' SELECT pg_sleep(1.5); COMMIT;')
    time.sleep(0.3)
    approved = executor.submit(query, f'SELECT approve_estimate({did})', 2)
    held.result()
    approved.result()
check('concurrent save then approval locks same parent', lambda: query(f"SELECT 1/(CASE WHEN status='approved' AND title='Latest content' THEN 1 ELSE 0 END) FROM estimates WHERE id={did}"))

# Approval first: even a save submitted while the approval transaction is open fails.
query(f"UPDATE estimates SET status='draft' WHERE id={did}; " + lock_sql)
with concurrent.futures.ThreadPoolExecutor() as executor:
    held = executor.submit(query, f'BEGIN; SELECT approve_estimate({did}); SELECT pg_sleep(1.5); COMMIT;', 2)
    time.sleep(0.3)
    attempted = executor.submit(query,save_sql(did,header('261001-9002-001'),[dict(id=dsid,title='Top')]),1,'下書き')
    held.result()
    attempted.result()
check('concurrent approval then save rejects stale draft', lambda: query(f"SELECT 1/(CASE WHEN status='approved' THEN 1 ELSE 0 END) FROM estimates WHERE id={did}"))

query(f"UPDATE estimates SET deleted_at=now()-interval '31 days' WHERE id={did}")
check('expired purge still works', lambda: query('SELECT purge_expired_estimates()'))
assert query(f'SELECT count(*) FROM estimates WHERE id={did}') == '0'
print(f'{len(passed)} DB regressions passed; isolated database: {database}')
