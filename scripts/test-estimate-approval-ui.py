"""Browser regressions for the real editor with all Supabase traffic stubbed.

Run against Vite: python scripts/test-estimate-approval-ui.py --url http://127.0.0.1:5174
No live database requests are allowed. Uses a generated scratch-only entry point.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:5174')
args = parser.parse_args()
if urlparse(args.url).hostname not in ('localhost', '127.0.0.1'):
    parser.error('Only a localhost Vite server is allowed.')
root = Path(__file__).resolve().parents[1]
scratch = root / 'scratch'
scratch.mkdir(exist_ok=True)
(scratch / 'estimate-approval-ui.html').write_text('<html><div id="root"></div><script type="module" src="/scratch/estimate-approval-ui.js"></script></html>', encoding='utf-8')
(scratch / 'estimate-approval-ui.js').write_text('''
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import EstimateEditor from '/src/estimate-editor/EstimateEditor.jsx';
import { ToastProvider } from '/src/components/Toast.jsx';
import '/src/index.css';
function Harness() {
  const [id, setId] = useState(new URLSearchParams(location.search).get('id') || null);
  return React.createElement(ToastProvider, null, React.createElement(EstimateEditor, {
    estimateId: id, onSaved: setId, onBack: () => { window.backCount=(window.backCount||0)+1; },
    onStatusChanged: () => { window.statusCount=(window.statusCount||0)+1; },
  }));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
''', encoding='utf-8')

staff = [dict(id=1,name='Creator',role='office',is_approver=False),
         dict(id=2,name='Approver',role='office',is_approver=True),
         dict(id=3,name='Other',role='office',is_approver=True)]
sid = '11111111-1111-4111-8111-111111111111'
record = dict(id=42, estimate_number='261001-9001-001', customer_id=1, title='Original title',
              payment_terms='', issue_date='2026-10-01', status='draft', staff_id=1, tax_rate=0.1,
              sheets=[dict(id=sid,sort_order=1,title=None)], items=[], show_net=True)
state = dict(row=record, requests=[], held=[], hold=False, fail=False, user=1, projects=[], tasks=[])
passed = []


def response(route, data, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(data,ensure_ascii=False),
                  headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'})


def save_response(route, payload):
    if state['fail']:
        response(route, dict(code='P0001', message='Injected item failure'), 400)
        return
    ids = [s['id'] or sid for s in payload['p_sheets']]
    state['row'] = dict(state['row'], **payload['p_header'],id=42,
                        status='pending' if payload['p_submit'] else 'draft',
                        approver_staff_id=payload['p_approver_staff_id'],
                        sheets=[dict(s,id=ids[idx],sort_order=idx+1) for idx,s in enumerate(payload['p_sheets'])],
                        items=[dict(i,id=idx+1,sheet_id=ids[i['sheet_index']],sort_order=idx) for idx,i in enumerate(payload['p_items'])])
    response(route, dict(id=42,sheet_ids=ids,status=state['row']['status']))


def intercept(route):
    request = route.request
    parsed = urlparse(request.url)
    if parsed.hostname in ('localhost','127.0.0.1'):
        if parsed.path == '/src/hooks/useAuth.jsx':
            route.fulfill(content_type='application/javascript',body='export const useAuth=()=>({currentStaff:'+json.dumps(staff[state['user']-1])+'});')
        else:
            route.continue_()
        return
    # All non-local requests are intercepted. Production writes cannot escape.
    if '/rest/v1/' not in parsed.path:
        route.abort()
        return
    path = parsed.path.split('/rest/v1/')[1]
    if request.method == 'OPTIONS':
        response(route,{})
    elif path == 'rpc/get_next_estimate_seq':
        response(route,'9001')
    elif path == 'rpc/save_estimate_v3':
        payload = request.post_data_json
        state['requests'].append(payload)
        if state['hold']:
            state['held'].append((route,payload))
        else:
            save_response(route,payload)
    elif path in ('rpc/approve_estimate','rpc/return_estimate'):
        state['row'].update(status='approved' if 'approve_' in path else 'returned',approved_by='Approver',approved_at='2026-10-01T02:00:00Z')
        response(route,None)
    elif path == 'estimates':
        params=parse_qs(parsed.query)
        if params.get('select') == ['id']:
            response(route,[])
        elif request.method == 'PATCH':
            state['row'].update(request.post_data_json)
            if state['row']['status']=='draft':
                state['row'].update(approved_by=None,approved_at=None,returned_reason='')
            response(route,state['row'])
        else:
            response(route,state['row'])
    elif path == 'Customers':
        response(route,[dict(id=1,name='Synthetic customer')])
    elif path == 'office_staff':
        response(route,staff)
    elif path == 'system_settings':
        response(route,dict(est_default_valid_days=30))
    elif path == 'Projects':
        if request.method=='POST':
            state['projects'].extend(request.post_data_json)
            response(route,dict(id=1))
        else:
            response(route,[])
    elif path == 'ProjectTasks':
        if request.method=='POST':
            state['tasks'].extend(request.post_data_json)
        response(route,[])
    elif path == 'Workers':
        response(route,[])
    else:
        raise AssertionError('Unexpected API request: '+path)


def check(name):
    passed.append(name)
    print('PASS',name,flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport=dict(width=1920,height=1080))
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.route('**/*',intercept)

    def open_editor(existing=False):
        page.goto(args.url+'/scratch/estimate-approval-ui.html'+('?id=42' if existing else ''))
        page.wait_for_load_state('networkidle')
        expect(page.get_by_role('button',name='保存',exact=True)).to_be_visible()

    def submit():
        page.get_by_role('button',name='承認依頼',exact=True).click()
        page.locator('select').filter(has=page.locator('option',has_text='Approver')).last.select_option('2')
        page.get_by_role('button',name='申請する',exact=True).click()

    open_editor()
    # Inspect actual rendered controls before selecting / filling them.
    page.get_by_role('button',name='-- 選択してください --',exact=True).click()
    page.get_by_placeholder('顧客名で絞り込み').fill('Synthetic')
    page.get_by_text('Synthetic customer',exact=True).click()
    page.get_by_role('textbox',name='工事名',exact=True).fill('Latest new title')
    page.get_by_role('textbox',name='支払条件',exact=True).fill('')
    page.locator('input[data-col="name"]').last.fill('Latest new item')
    page.locator('input[data-col="quantity"]').last.fill('1')
    page.locator('input[data-col="unit_price"]').last.fill('100')
    state['hold']=True
    submit()
    page.wait_for_function('document.querySelector("button") !== null')
    expect(page.get_by_role('button',name='申請する',exact=True)).to_be_disabled()
    expect(page.get_by_role('button',name='保存中...',exact=True)).to_be_disabled()
    page.get_by_role('button',name='申請する',exact=True).evaluate('(b)=>{b.click();b.click();}')
    assert len(state['requests'])==1
    assert state['requests'][0]['p_estimate_id'] is None
    assert state['requests'][0]['p_header']['title']=='Latest new title'
    assert state['requests'][0]['p_header']['payment_terms']==''
    assert state['requests'][0]['p_header']['total_with_tax']==110
    assert any(i['name']=='Latest new item' and i['amount']==100 for i in state['requests'][0]['p_items'])
    check('new unsaved submission uses one atomic request and prevents double execution')
    route,payload=state['held'].pop()
    save_response(route,payload)
    state['hold']=False
    expect(page.get_by_text('承認を依頼しますか？',exact=True)).not_to_be_visible()
    expect(page.get_by_text('編集ロック中',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='保存',exact=True)).to_be_disabled()
    assert page.get_by_role('textbox',name='工事名',exact=True).count()==0
    check('submission locks immediately without reloading even for a new estimate')

    page.get_by_role('button',name='下書きに戻す',exact=True).click()
    expect(page.get_by_role('button',name='保存',exact=True)).to_be_enabled()
    page.get_by_role('textbox',name='工事名',exact=True).fill('Latest edited title')
    page.locator('input[data-col="name"]').last.fill('Latest edited item')
    page.locator('input[data-col="unit_price"]').last.fill('200')
    snapshot_before=page.evaluate('localStorage.getItem("estimate-last-saved:42")')
    assert snapshot_before is not None
    state['fail']=True
    submit()
    expect(page.get_by_text('承認を依頼しますか？',exact=True)).to_be_visible()
    expect(page.get_by_role('textbox',name='工事名',exact=True)).to_have_value('Latest edited title')
    assert state['requests'][-1]['p_estimate_id']==42
    assert state['row']['status']=='draft'
    assert page.evaluate('localStorage.getItem("estimate-last-saved:42")')==snapshot_before
    check('save failure keeps input modal and draft status with error notification')
    assert page.get_by_text('保存・申請に失敗しました: Injected item failure',exact=True).count()>=1
    state['fail']=False
    page.get_by_role('button',name='申請する',exact=True).click()
    expect(page.get_by_text('編集ロック中',exact=True)).to_be_visible()
    assert state['row']['title']=='Latest edited title'
    assert state['row']['total_with_tax']==220
    assert any(i['name']=='Latest edited item' and i['amount']==200 for i in state['row']['items'])
    assert state['requests'][-1]['p_estimate_id']==42
    check('retry submits unsaved existing changes using the original ID')

    state['user']=2
    open_editor(existing=True)
    page.get_by_role('button',name='承認',exact=True).click()
    # Approval modal button label is determined by its rendered DOM.
    page.get_by_role('button',name='承認する',exact=True).click()
    expect(page.get_by_text('Approver が承認（2026/10/01 11:00）',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='保存',exact=True)).to_be_disabled()
    check('approval refreshes database trail and stays locked')

    state['row']['status']='draft'
    state['row']['approved_by']=None
    state['row']['approved_at']=None
    state['user']=1
    open_editor(existing=True)
    expect(page.get_by_role('textbox',name='支払条件',exact=True)).to_have_value('')
    check('saved empty payment terms survive reloading')
    page.get_by_role('textbox',name='工事名',exact=True).fill('')
    count=len(state['requests'])
    submit()
    expect(page.get_by_text('保存・申請に失敗しました: 工事名を入力してください。',exact=True).first).to_be_visible()
    assert len(state['requests'])==count
    check('invalid input does not call save or change status')
    page.get_by_role('button',name='キャンセル',exact=True).click()
    page.evaluate('localStorage.clear()')
    open_editor()
    page.get_by_role('button',name='-- 選択してください --',exact=True).click()
    page.get_by_placeholder('顧客名で絞り込み').fill('Synthetic')
    page.get_by_text('Synthetic customer',exact=True).click()
    page.get_by_role('textbox',name='工事名',exact=True).fill('Saved new draft')
    page.locator('input[data-col="name"]').last.fill('Ordered item')
    page.locator('input[data-col="quantity"]').last.fill('1')
    page.locator('input[data-col="unit_price"]').last.fill('100')
    count=len(state['requests'])
    page.get_by_role('button',name='保存',exact=True).click()
    expect(page.get_by_text('見積書 編集',exact=True)).to_be_visible()
    expect(page.get_by_role('textbox',name='工事名',exact=True)).to_have_value('Saved new draft')
    assert len(state['requests'])==count+1
    assert not state['requests'][-1]['p_submit']
    page.get_by_role('textbox',name='工事名',exact=True).fill('After saved draft edit')
    submit()
    expect(page.get_by_text('編集ロック中',exact=True)).to_be_visible()
    assert state['requests'][-1]['p_estimate_id']==42
    assert state['row']['title']=='After saved draft edit'
    check('normal new draft save keeps ID and latest subsequent submission')
    state['user']=2
    open_editor(existing=True)
    page.get_by_role('button',name='承認',exact=True).click()
    page.get_by_role('button',name='承認する',exact=True).click()
    expect(page.get_by_role('button',name='提出済にする',exact=True)).to_be_visible()
    page.get_by_role('button',name='提出済にする',exact=True).click()
    page.get_by_role('dialog').get_by_role('button',name='提出済にする',exact=True).click()
    expect(page.get_by_role('button',name='受注',exact=True)).to_be_visible()
    page.get_by_role('button',name='受注',exact=True).click()
    page.get_by_role('dialog').get_by_role('button',name='受注にする',exact=True).click()
    expect(page.get_by_text('受注で確定済み',exact=True)).to_be_visible()
    expect(page.get_by_role('dialog')).not_to_be_visible()
    assert len(state['projects'])==1
    assert state['row']['project_id']==1
    assert state['tasks'][0]['name']=='Ordered item'
    assert state['tasks'][0]['estimated_amount']==100
    check('customer submission and order retain project and item synchronization')
    assert not errors, errors
    browser.close()
print(f'{len(passed)} browser regressions passed (Supabase completely stubbed)')
