import { describe, it, expect, vi } from 'vitest';
import {
    toFiniteOrNull, buildImportItems, buildEstimatePrefix,
    createEstimateWithRetry, importProjectCore, rollbackImport, MAX_NUMBER_RETRIES,
} from './projectExcelImport';
import { PROJECT_STATUS, ESTIMATE_STATUS } from './constants';

const makeDeps = (over = {}) => ({
    getNextEstimateSeq: vi.fn().mockResolvedValue(1),
    findAvailableBranchNumber: vi.fn().mockImplementation(async (p, s) => `${p}-${s}`),
    createEstimate: vi.fn().mockResolvedValue({ id: 'est1' }),
    buildSaveItemsPayload: vi.fn().mockReturnValue({ payloadSheets: ['s'], payloadItems: ['i'] }),
    saveEstimateItemsV2: vi.fn().mockResolvedValue(undefined),
    syncEstimateToProject: vi.fn().mockResolvedValue('proj1'),
    updateEstimate: vi.fn().mockResolvedValue(undefined),
    copyEstimateItemsToProjectTasks: vi.fn().mockResolvedValue(undefined),
    fetchProjectOrder: vi.fn().mockResolvedValue(7),
    fallbackOrder: vi.fn().mockReturnValue(99),
    ...over,
});

const parsed = { items: [{ name: '足場', quantity: '2', unit_price: '100', amount: '200' }, { name: '  ' }] };
const baseArgs = { parsed, fileName: 'abc.xlsx', customerId: 'c1', projectName: '', now: new Date(2026, 0, 5) };

describe('toFiniteOrNull / buildImportItems', () => {
    it('空・非数値はnull、数値は数に変換', () => {
        expect(toFiniteOrNull('')).toBeNull();
        expect(toFiniteOrNull(null)).toBeNull();
        expect(toFiniteOrNull('abc')).toBeNull();
        expect(toFiniteOrNull('12')).toBe(12);
        expect(toFiniteOrNull(0)).toBe(0);
    });
    it('名前の空行を除外し sort_order を振り直す', () => {
        const items = buildImportItems(parsed);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ name: '足場', sort_order: 0, sheet_id: null, quantity: 2, amount: 200 });
    });
    it('接頭辞は YYMMDD', () => {
        expect(buildEstimatePrefix(new Date(2026, 0, 5))).toBe('260105');
    });
});

describe('createEstimateWithRetry', () => {
    const uniq = Object.assign(new Error('dup'), { code: '23505' });
    it('23505 の後に再採番して成功する', async () => {
        const deps = makeDeps({ createEstimate: vi.fn().mockRejectedValueOnce(uniq).mockResolvedValueOnce({ id: 'ok' }) });
        const r = await createEstimateWithRetry(deps, 'P', (n) => ({ n }));
        expect(r.id).toBe('ok');
        expect(deps.getNextEstimateSeq).toHaveBeenCalledTimes(2);
    });
    it('その他のエラーは再試行しない', async () => {
        const deps = makeDeps({ createEstimate: vi.fn().mockRejectedValue(new Error('boom')) });
        await expect(createEstimateWithRetry(deps, 'P', () => ({}))).rejects.toThrow('boom');
        expect(deps.createEstimate).toHaveBeenCalledTimes(1);
    });
    it('上限回数で諦める', async () => {
        const deps = makeDeps({ createEstimate: vi.fn().mockRejectedValue(uniq) });
        await expect(createEstimateWithRetry(deps, 'P', () => ({}))).rejects.toBe(uniq);
        expect(deps.createEstimate).toHaveBeenCalledTimes(MAX_NUMBER_RETRIES);
    });
});

describe('importProjectCore', () => {
    it('顧客未指定ならDBに触れず失敗する（estimates.customer_idはNOT NULL）', async () => {
        const deps = makeDeps();
        await expect(importProjectCore(deps, { ...baseArgs, customerId: null })).rejects.toThrow('顧客');
        expect(deps.createEstimate).not.toHaveBeenCalled();
    });
    it('下書き見積＋予定の現場を作り、orderはDB値を使う', async () => {
        const deps = makeDeps();
        const r = await importProjectCore(deps, baseArgs);
        expect(deps.createEstimate.mock.calls[0][0]).toMatchObject({ status: ESTIMATE_STATUS.DRAFT, title: 'abc', customer_id: 'c1' });
        expect(deps.syncEstimateToProject).toHaveBeenCalledWith(expect.objectContaining({ status: PROJECT_STATUS.SCHEDULED }));
        expect(deps.updateEstimate).toHaveBeenCalledWith('est1', { project_id: 'proj1' });
        expect(r.projectId).toBe('proj1');
        expect(r.project).toMatchObject({ id: 'proj1', order: 7, siteName: 'abc', status: PROJECT_STATUS.SCHEDULED, customerId: 'c1', _isLoaded: false });
    });
    it('order取得失敗時はfallbackOrder', async () => {
        const deps = makeDeps({ fetchProjectOrder: vi.fn().mockRejectedValue(new Error('x')) });
        const r = await importProjectCore(deps, baseArgs);
        expect(r.project.order).toBe(99);
    });
    it('工事名の指定を優先する', async () => {
        const r = await importProjectCore(makeDeps(), { ...baseArgs, projectName: ' 本館 ' });
        expect(r.project.siteName).toBe('本館');
    });
    it('明細が無ければエラー（何も作らない）', async () => {
        const deps = makeDeps();
        await expect(importProjectCore(deps, { ...baseArgs, parsed: { items: [] } })).rejects.toThrow('取り込めるデータが見つかりませんでした');
        expect(deps.createEstimate).not.toHaveBeenCalled();
    });
    it('失敗時は作成済みidを createdIds に載せる', async () => {
        const deps = makeDeps({ copyEstimateItemsToProjectTasks: vi.fn().mockRejectedValue(new Error('fail')) });
        const err = await importProjectCore(deps, baseArgs).catch(e => e);
        expect(err.createdIds).toEqual({ estimateId: 'est1', projectId: 'proj1' });
    });
});

describe('rollbackImport', () => {
    it('子→紐付け解除→現場→見積の順に実行する', async () => {
        const order = [];
        const deps = {
            deleteProjectTasks: vi.fn(async () => { order.push('tasks'); }),
            updateEstimate: vi.fn(async () => { order.push('unlink'); }),
            deleteProject: vi.fn(async () => { order.push('project'); }),
            deleteEstimate: vi.fn(async () => { order.push('estimate'); }),
        };
        const errs = await rollbackImport(deps, { estimateId: 'e', projectId: 'p' });
        expect(order).toEqual(['tasks', 'unlink', 'project', 'estimate']);
        expect(errs).toEqual([]);
    });
    it('失敗したステップ（throw / res.error）を集める', async () => {
        const deps = {
            deleteProjectTasks: vi.fn().mockResolvedValue({ error: { message: 'e1' } }),
            updateEstimate: vi.fn().mockResolvedValue(undefined),
            deleteProject: vi.fn().mockRejectedValue(new Error('e2')),
            deleteEstimate: vi.fn().mockResolvedValue(undefined),
        };
        const errs = await rollbackImport(deps, { estimateId: 'e', projectId: 'p' });
        expect(errs).toEqual(['工種削除: e1', '現場削除: e2']);
        expect(deps.deleteEstimate).not.toHaveBeenCalled();
    });
    it('projectId が無ければ見積のみ削除', async () => {
        const deps = { deleteProjectTasks: vi.fn(), updateEstimate: vi.fn(), deleteProject: vi.fn(), deleteEstimate: vi.fn().mockResolvedValue(undefined) };
        await rollbackImport(deps, { estimateId: 'e', projectId: null });
        expect(deps.deleteProject).not.toHaveBeenCalled();
        expect(deps.deleteEstimate).toHaveBeenCalledWith('e');
    });
});
