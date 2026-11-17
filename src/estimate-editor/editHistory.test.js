import { describe, it, expect } from 'vitest';
import {
  createHistory,
  pushEntry,
  breakCoalesce,
  undoHistory,
  redoHistory,
  remapHistorySheetIds,
  prepareSnapshotForRestore,
  createHistoryController,
} from './editHistory';

const snap = (n, extra = {}) => ({
  header: { title: `t${n}`, status: 'draft', ...extra.header },
  sheets: extra.sheets || [{ id: 's1', title: null }],
  items: extra.items || [{ _uid: 'r1', sheet_id: 's1', name: `n${n}` }],
});

describe('editHistory', () => {
  it('同じキーの連続入力は1件にまとめ、キーが変わると別の1件になる', () => {
    let h = createHistory();
    h = pushEntry(h, { snapshot: snap(0), label: 'セルの入力', key: 'cell:r1:name' }).history;
    h = pushEntry(h, { snapshot: snap(1), label: 'セルの入力', key: 'cell:r1:name' }).history;
    expect(h.past).toHaveLength(1);
    expect(h.past[0].snapshot.header.title).toBe('t0');
    h = pushEntry(h, { snapshot: snap(2), label: 'セルの入力', key: 'cell:r1:spec' }).history;
    expect(h.past).toHaveLength(2);
  });

  it('breakCoalesce の後は同じキーでも別の1件になる', () => {
    let h = createHistory();
    h = pushEntry(h, { snapshot: snap(0), label: 'a', key: 'k' }).history;
    h = breakCoalesce(h);
    h = pushEntry(h, { snapshot: snap(1), label: 'a', key: 'k' }).history;
    expect(h.past).toHaveLength(2);
  });

  it('キーなしの操作は毎回1件になる', () => {
    let h = createHistory();
    h = pushEntry(h, { snapshot: snap(0), label: '行の削除' }).history;
    h = pushEntry(h, { snapshot: snap(1), label: '行の削除' }).history;
    expect(h.past).toHaveLength(2);
  });

  it('undo/redo で状態を行き来でき、新しい操作でやり直し履歴は消える', () => {
    let h = createHistory();
    h = pushEntry(h, { snapshot: snap(0), label: 'A' }).history;
    h = pushEntry(h, { snapshot: snap(1), label: 'B' }).history;
    const u = undoHistory(h, snap(2));
    expect(u.entry.snapshot.header.title).toBe('t1');
    expect(u.history.future[0].snapshot.header.title).toBe('t2');
    const r = redoHistory(u.history, snap(1));
    expect(r.entry.snapshot.header.title).toBe('t2');
    expect(r.history.past).toHaveLength(2);
    const u2 = undoHistory(r.history, snap(2));
    const p = pushEntry(u2.history, { snapshot: snap(1), label: 'C' }).history;
    expect(p.future).toHaveLength(0);
  });

  it('空の履歴では undo/redo は null', () => {
    expect(undoHistory(createHistory(), snap(0))).toBeNull();
    expect(redoHistory(createHistory(), snap(0))).toBeNull();
  });

  it('上限を超えたら古い履歴から捨てる', () => {
    let h = createHistory();
    for (let i = 0; i < 5; i++) h = pushEntry(h, { snapshot: snap(i), label: 'x' }, 3).history;
    expect(h.past.map(e => e.snapshot.header.title)).toEqual(['t2', 't3', 't4']);
  });

  it('保存で確定したシートIDを履歴内にも反映する', () => {
    let h = createHistory();
    const s = snap(0, {
      sheets: [{ id: 'tmp1', title: null }],
      items: [{ _uid: 'r1', sheet_id: 'tmp1', linked_sheet_id: 'tmp1' }],
    });
    h = pushEntry(h, { snapshot: s, label: 'x' }).history;
    h = remapHistorySheetIds(h, new Map([['tmp1', 'uuid-1']]));
    expect(h.past[0].snapshot.sheets[0].id).toBe('uuid-1');
    expect(h.past[0].snapshot.items[0].sheet_id).toBe('uuid-1');
    expect(h.past[0].snapshot.items[0].linked_sheet_id).toBe('uuid-1');
  });

  it('復元時はステータス等を現在値のまま維持し、DBに無い保存済みシートは仮IDへ振り替える', () => {
    const gone = '11111111-1111-1111-1111-111111111111';
    const alive = '22222222-2222-2222-2222-222222222222';
    const s = snap(0, {
      header: { status: 'draft', approved_by: '' },
      sheets: [{ id: alive, title: null }, { id: gone, title: '内訳' }],
      items: [
        { _uid: 'r1', sheet_id: alive, linked_sheet_id: gone },
        { _uid: 'r2', sheet_id: gone },
      ],
    });
    const out = prepareSnapshotForRestore(
      s, { status: 'pending', approved_by: '山田', project_id: 9 }, new Set([alive]), () => 'tmp-new',
    );
    expect(out.header.title).toBe('t0');
    expect(out.header.status).toBe('pending');
    expect(out.header.approved_by).toBe('山田');
    expect(out.header.project_id).toBe(9);
    expect(out.sheets.map(x => x.id)).toEqual([alive, 'tmp-new']);
    expect(out.items[0]).toMatchObject({ sheet_id: alive, linked_sheet_id: 'tmp-new' });
    expect(out.items[1].sheet_id).toBe('tmp-new');
    expect(out.sheets).not.toBe(s.sheets);
    expect(out.items).not.toBe(s.items);
  });
});

describe('createHistoryController', () => {
  const setup = (initial = snap(0), known = []) => {
    const applied = [];
    const views = [];
    let n = 0;
    const ctrl = createHistoryController({
      apply: (next) => applied.push(next),
      newSheetId: () => `tmp${++n}`,
      onView: (v) => views.push(v),
    });
    ctrl.setKnownSheetIds(known);
    ctrl.sync(initial);
    // 画面側の描画を模して、反映された状態を sync する
    const render = () => { if (applied.length) ctrl.sync(applied[applied.length - 1]); };
    return { ctrl, applied, views, render };
  };
  const setTitle = (t) => ({ header: h }) => ({ header: { ...h, title: t } });

  it('edit は同期的に履歴へ積み、状態を反映して entry を返す', () => {
    const { ctrl, applied, views } = setup();
    const entry = ctrl.edit('鑑の入力', {}, setTitle('A'));
    expect(entry.label).toBe('鑑の入力');
    expect(applied.at(-1).header.title).toBe('A');
    expect(views.at(-1).undoLabel).toBe('鑑の入力');
  });

  it('非同期処理の後に呼んでも記録が落ちない（描画タイミングに依存しない）', async () => {
    const { ctrl, applied } = setup();
    await new Promise(r => setTimeout(r, 5));
    const entry = ctrl.edit('顧客の選択', {}, ({ header: h }) => ({ header: { ...h, customer_id: 7 } }));
    expect(entry).not.toBeNull();
    ctrl.undo();
    expect(applied.at(-1).header.customer_id).toBeUndefined();
  });

  it('変化のない操作（拒否された操作）は履歴に積まず null を返し、やり直し履歴も消さない', () => {
    const { ctrl, render } = setup();
    ctrl.edit('a', {}, setTitle('A')); render();
    ctrl.undo(); render();
    expect(ctrl.edit('行の削除', {}, () => null)).toBeNull();
    expect(ctrl.edit('行の削除', {}, (st) => ({ items: st.items }))).toBeNull();
    expect(ctrl.redo()).not.toBeNull();
  });

  it('描画前に連続で edit しても直前の結果に積み重なる', () => {
    const { ctrl, applied } = setup();
    ctrl.edit('a', {}, setTitle('A'));
    ctrl.edit('b', {}, ({ header: h }) => ({ header: { ...h, title: h.title + 'B' } }));
    expect(applied.at(-1).header.title).toBe('AB');
  });

  it('同じキーの連続入力は1件にまとまるが、間に保存などの別の変化があれば区切る', () => {
    const { ctrl, applied, render } = setup();
    ctrl.edit('セルの入力', { key: 'k' }, setTitle('A')); render();
    ctrl.edit('セルの入力', { key: 'k' }, setTitle('AB')); render();
    // 保存などの edit 以外の変化
    ctrl.sync({ ...applied.at(-1), header: { ...applied.at(-1).header, status: 'draft' } });
    ctrl.edit('セルの入力', { key: 'k' }, setTitle('ABC')); render();
    ctrl.undo(); render();
    expect(applied.at(-1).header.title).toBe('AB');
    ctrl.undo(); render();
    expect(applied.at(-1).header.title).toBe('t0');
  });

  it('戻すときステータス等は現在値のまま', () => {
    const { ctrl, applied, render } = setup();
    ctrl.edit('a', {}, setTitle('A')); render();
    ctrl.sync({ ...applied.at(-1), header: { ...applied.at(-1).header, status: 'pending' } });
    ctrl.undo();
    expect(applied.at(-1).header).toMatchObject({ title: 't0', status: 'pending' });
  });

  it('undoIfTop は直近の操作のときだけ戻す', () => {
    const { ctrl, render } = setup();
    const e1 = ctrl.edit('a', {}, setTitle('A')); render();
    ctrl.edit('b', {}, setTitle('B')); render();
    expect(ctrl.undoIfTop(e1.id)).toBeNull();
  });
});
