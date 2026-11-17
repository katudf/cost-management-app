import { describe, it, expect } from 'vitest';
import {
  orderedSelection,
  rangeUids,
  replaceSheetRows,
  removeRows,
  duplicateRows,
  moveRows,
  insertRowsAfter,
  moveRowsTo,
  buildRowsClipboard,
  parseRowsClipboard,
  rowsFromTsv,
  pasteRowsInto,
  parseTsvCells,
} from './rowBulkOps';

const row = (uid, sheet = 'A', extra = {}) => ({ _uid: uid, sheet_id: sheet, item_type: 'item', name: uid, ...extra });
// シートA: a1..a4、シートB: b1..b2（フラット配列ではシートが連続）
const base = () => [row('a1'), row('a2'), row('a3'), row('a4'), row('b1', 'B'), row('b2', 'B')];
const uidsOf = (items, sheet) => items.filter(i => i.sheet_id === sheet).map(i => i._uid);
let n = 0;
const ids = { uid: () => `new${++n}`, catTempId: () => `cat${n}` };

describe('rowBulkOps 並び', () => {
  it('rangeUids はアンカーから対象までをシート内の表示順で返す（逆方向も可）', () => {
    expect(rangeUids(base(), 'A', 'a3', 'a1')).toEqual(['a1', 'a2', 'a3']);
    expect(rangeUids(base(), 'A', 'zz', 'a2')).toEqual(['a2']);
  });

  it('orderedSelection は選択順ではなく表示順', () => {
    expect(orderedSelection(base(), 'A', new Set(['a4', 'a1'])).map(r => r._uid)).toEqual(['a1', 'a4']);
  });

  it('replaceSheetRows は他シートの位置を保ち sort_order を振り直す', () => {
    const items = [row('b1', 'B'), row('a1'), row('a2'), row('b2', 'B')];
    const out = replaceSheetRows(items, 'A', [items[2], items[1]]);
    expect(out.map(i => i._uid)).toEqual(['b1', 'a2', 'a1', 'b2']);
    expect(out.filter(i => i.sheet_id === 'A').map(i => i.sort_order)).toEqual([0, 1]);
  });
});

describe('rowBulkOps 操作', () => {
  it('removeRows は選択行だけ消し、他シートに触れない', () => {
    const out = removeRows(base(), 'A', new Set(['a2', 'a3']), () => row('empty'));
    expect(uidsOf(out, 'A')).toEqual(['a1', 'a4']);
    expect(uidsOf(out, 'B')).toEqual(['b1', 'b2']);
  });

  it('removeRows でシートが空になる場合は空行を1行残す', () => {
    const out = removeRows(base(), 'A', new Set(['a1', 'a2', 'a3', 'a4']), (sid) => row('empty', sid));
    expect(uidsOf(out, 'A')).toEqual(['empty']);
  });

  it('何も消えなければ同じ配列を返す', () => {
    const items = base();
    expect(removeRows(items, 'A', new Set(['zz']), () => row('e'))).toBe(items);
  });

  it('duplicateRows は最後の選択行の下へ表示順で複製し、id を外して新しい _uid を振る', () => {
    const items = base();
    items[0] = { ...items[0], id: 99 };
    const { items: out, newUids } = duplicateRows(items, 'A', new Set(['a3', 'a1']), ids);
    expect(uidsOf(out, 'A')).toEqual(['a1', 'a2', 'a3', ...newUids, 'a4']);
    const copy = out.find(i => i._uid === newUids[0]);
    expect(copy.name).toBe('a1');
    expect(copy.id).toBeUndefined();
  });

  it('duplicateRows はカテゴリ行に新しい _tempId を振る', () => {
    const items = [row('c', 'A', { item_type: 'category', _tempId: 'old' })];
    const { items: out, newUids } = duplicateRows(items, 'A', new Set(['c']), ids);
    expect(out.find(i => i._uid === newUids[0])._tempId).not.toBe('old');
  });

  it('moveRows は離れた選択もそれぞれ1行動かし、端では止まる', () => {
    expect(uidsOf(moveRows(base(), 'A', new Set(['a2', 'a4']), 'up'), 'A')).toEqual(['a2', 'a1', 'a4', 'a3']);
    expect(uidsOf(moveRows(base(), 'A', new Set(['a1', 'a3']), 'down'), 'A')).toEqual(['a2', 'a1', 'a4', 'a3']);
    const items = base();
    expect(moveRows(items, 'A', new Set(['a1', 'a2']), 'up')).toBe(items);
  });

  it('insertRowsAfter はアンカーの直後、アンカーなしならシート末尾に入れる', () => {
    expect(uidsOf(insertRowsAfter(base(), 'A', 'a2', [row('x')]), 'A')).toEqual(['a1', 'a2', 'x', 'a3', 'a4']);
    expect(uidsOf(insertRowsAfter(base(), 'B', null, [row('x', 'B')]), 'B')).toEqual(['b1', 'b2', 'x']);
  });
});

describe('rowBulkOps ドラッグ移動 moveRowsTo', () => {
  const empty = (sid) => row('empty', sid);

  it('同じシート内でアンカーの前後へ移す', () => {
    expect(uidsOf(moveRowsTo(base(), new Set(['a1']), 'A', { uid: 'a3', position: 'after' }, empty), 'A'))
      .toEqual(['a2', 'a3', 'a1', 'a4']);
    expect(uidsOf(moveRowsTo(base(), new Set(['a4']), 'A', { uid: 'a2', position: 'before' }, empty), 'A'))
      .toEqual(['a1', 'a4', 'a2', 'a3']);
  });

  it('離れた行は表示順のまま詰めて並べる', () => {
    expect(uidsOf(moveRowsTo(base(), new Set(['a3', 'a1']), 'A', { uid: 'a4', position: 'after' }, empty), 'A'))
      .toEqual(['a2', 'a4', 'a1', 'a3']);
  });

  it('自分自身の中や、並びが変わらない位置に落としても同じ配列を返す', () => {
    const items = base();
    expect(moveRowsTo(items, new Set(['a2', 'a3']), 'A', { uid: 'a3', position: 'before' }, empty)).toBe(items);
    expect(moveRowsTo(items, new Set(['a2']), 'A', { uid: 'a1', position: 'after' }, empty)).toBe(items);
  });

  it('別シートへ移すと識別子を保ったまま所属シートと番号が変わる', () => {
    const items = base();
    items[1] = { ...items[1], id: 9, _tempId: 't' };
    const out = moveRowsTo(items, new Set(['a2']), 'B', { uid: 'b1', position: 'after' }, empty);
    expect(uidsOf(out, 'B')).toEqual(['b1', 'a2', 'b2']);
    expect(uidsOf(out, 'A')).toEqual(['a1', 'a3', 'a4']);
    expect(out.find(i => i._uid === 'a2')).toMatchObject({ sheet_id: 'B', id: 9, _tempId: 't', sort_order: 1 });
    expect(out.filter(i => i.sheet_id === 'A').map(i => i.sort_order)).toEqual([0, 1, 2]);
  });

  it('アンカーなしなら移動先シートの末尾。移動元が空になれば空行を1行残す', () => {
    const out = moveRowsTo(base(), new Set(['b1', 'b2']), 'A', null, empty);
    expect(uidsOf(out, 'A')).toEqual(['a1', 'a2', 'a3', 'a4', 'b1', 'b2']);
    expect(uidsOf(out, 'B')).toEqual(['empty']);
  });
});

describe('rowBulkOps クリップボード', () => {
  const src = { estimateId: 5, instanceKey: 'inst1' };
  const rows = [
    row('c', 'A', { item_type: 'category', category_symbol: 'A', name: '外壁' }),
    row('i', 'A', { name: '下地', spec: '高圧洗浄', quantity: 10, unit: 'm²', unit_price: 300, amount: 3000, note: '' }),
    row('k', 'A', { item_type: 'comment', name: '※別途' }),
    row('b', 'A', { category_symbol: '__blank__', name: '' }),
    row('l', 'A', { name: '内訳', quantity: 1, unit: '式', unit_price: 5000, amount: 5000, note: '明細書No.2', linked_sheet_id: 'S2' }),
  ];

  it('text は Excel 用のタブ区切り（名称・仕様・数量・単位・単価・摘要）', () => {
    const { text } = buildRowsClipboard(rows, src);
    expect(text.split('\n')).toEqual([
      'A 外壁',
      '下地\t高圧洗浄\t10\tm²\t300\t',
      '※別途',
      '',
      '内訳\t\t1\t式\t5000\t明細書No.2',
    ]);
  });

  it('html から行データを読み戻せる（行の種類・リンクを保つ）', () => {
    const { html, text } = buildRowsClipboard(rows, src);
    const p = parseRowsClipboard({ html, text }, null);
    expect(p.instanceKey).toBe('inst1');
    expect(p.rows.map(r => r.item_type)).toEqual(['category', 'item', 'comment', 'item', 'item']);
    expect(p.rows[4].linked_sheet_id).toBe('S2');
  });

  it('html が無くても直前のコピーと text が一致すれば行データを使う', () => {
    const copy = buildRowsClipboard(rows, src);
    expect(parseRowsClipboard({ html: '', text: copy.text + '\r\n' }, copy)).toBe(copy.payload);
    expect(parseRowsClipboard({ html: '', text: 'other' }, copy)).toBeNull();
    // 別アプリ（Excel 等）の html 付きコピーは、文字が同じでも行データとみなさない
    expect(parseRowsClipboard({ html: '<table><tr><td>x</td></tr></table>', text: copy.text }, copy)).toBeNull();
  });

  const noCycle = () => false;
  const sheets = [{ id: 'S1' }, { id: 'S2' }];

  it('pasteRowsInto: 同じ見積で参照先があればリンクを残し、行の種類も保つ', () => {
    const { payload } = buildRowsClipboard(rows, src);
    const target = [row('t1', 'S1')];
    const { items: out, newUids } = pasteRowsInto(target, sheets, 'S1', 't1', payload.rows, ids,
      { sameEstimate: true, wouldCreateCycle: noCycle });
    expect(uidsOf(out, 'S1')).toEqual(['t1', ...newUids]);
    const pasted = out.filter(i => newUids.includes(i._uid));
    expect(pasted[4].linked_sheet_id).toBe('S2');
    expect(pasted[0]._tempId).toBeDefined();
    expect(pasted[3].category_symbol).toBe('__blank__');
  });

  it('pasteRowsInto: 別の見積・参照先なし・循環になるリンクは外してコピー時点の値で固定する', () => {
    const { payload } = buildRowsClipboard(rows, src);
    const check = (opts) => pasteRowsInto([row('t1', 'S1')], opts.sheets ?? sheets, 'S1', null, payload.rows, ids, opts)
      .items.find(i => i.name === '内訳');
    const fixedValues = { linked_sheet_id: null, unit_price: 5000, amount: 5000, note: '明細書No.2' };
    expect(check({ sameEstimate: false, wouldCreateCycle: noCycle })).toMatchObject(fixedValues);
    expect(check({ sameEstimate: true, sheets: [{ id: 'S1' }], wouldCreateCycle: noCycle })).toMatchObject(fixedValues);
    expect(check({ sameEstimate: true, wouldCreateCycle: () => true })).toMatchObject(fixedValues);
  });

  it('pasteRowsInto: 保存で確定したシートIDに読み替えてリンクを残す', () => {
    const { payload } = buildRowsClipboard([row('l', 'A', { linked_sheet_id: 'tmp-sheet' })], src);
    const { items: out, newUids } = pasteRowsInto([row('t1', 'S1')], sheets, 'S1', null, payload.rows, ids, {
      sameEstimate: true, wouldCreateCycle: noCycle, mapSheetId: (id) => (id === 'tmp-sheet' ? 'S2' : id),
    });
    expect(out.find(i => i._uid === newUids[0]).linked_sheet_id).toBe('S2');
  });

  it('pasteRowsInto: 切り取った工種行は元の識別子を引き継ぎ、総括表の②リンクが切れない', () => {
    const cat = row('catA', 'S2', { item_type: 'category', name: '外壁', _tempId: 'tmpA', id: 7 });
    const summary = row('sum1', 'S1', { linked_category_item_id: 'catA' });
    const { payload } = buildRowsClipboard([cat], src);
    // 切り取り後（元の工種行は無い）に貼る
    const afterCut = [summary];
    const { items: out } = pasteRowsInto(afterCut, sheets, 'S1', null, payload.rows, ids,
      { sameEstimate: true, wouldCreateCycle: noCycle });
    const pastedCat = out.find(i => i.item_type === 'category');
    expect(pastedCat).toMatchObject({ _uid: 'catA', _tempId: 'tmpA', id: 7 });
    // 元が残っている（コピー）なら新しい識別子になる
    const { items: out2 } = pasteRowsInto([summary, cat], sheets, 'S1', null, payload.rows, ids,
      { sameEstimate: true, wouldCreateCycle: noCycle });
    expect(out2.filter(i => i._uid === 'catA')).toHaveLength(1);
  });

  it('parseTsvCells は改行の種類と末尾の改行を吸収する', () => {
    expect(parseTsvCells('a\tb\r\nc\r\n')).toEqual([['a', 'b'], ['c']]);
    expect(parseTsvCells('')).toEqual([]);
  });

  it('rowsFromTsv は数量×単価で金額を出し、数値でない値はそのまま', () => {
    const r = rowsFromTsv('足場\t\t1,000\tm²\t800\t\n養生\t\t一式\t\t\t\n');
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ name: '足場', quantity: 1000, unit_price: 800, amount: 800000, item_type: 'item' });
    expect(r[1]).toMatchObject({ name: '養生', quantity: '一式', amount: '' });
    expect(rowsFromTsv('')).toEqual([]);
  });
});
