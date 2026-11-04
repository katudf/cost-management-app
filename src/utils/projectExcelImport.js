// src/utils/projectExcelImport.js
// 現場管理タブのExcel取込の中核ロジック（DB操作は deps で注入。テスト容易性のため hook から分離）
// 下書き見積(ESTIMATE_STATUS.DRAFT。DBトリガーが新規見積を下書きに限定) + 予定の現場(PROJECT_STATUS.SCHEDULED) を作成する。

import { PROJECT_STATUS, ESTIMATE_STATUS } from './constants';

export const MAX_NUMBER_RETRIES = 5;
const UNIQUE_VIOLATION = '23505';

// 空・非数値は null、有限な数値のみ Number で返す（NaN を DB に送らない）
export const toFiniteOrNull = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export const buildImportItems = (parsed) => (parsed.items || [])
    .filter(it => it.name?.trim())
    .map((it, idx) => ({
        ...it,
        sheet_id: null,
        sort_order: idx,
        quantity: toFiniteOrNull(it.quantity),
        unit_price: toFiniteOrNull(it.unit_price),
        amount: toFiniteOrNull(it.amount),
    }));

export const buildEstimatePrefix = (now) =>
    `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

// 見積番号の採番〜作成を、番号の一意制約違反(23505)のときだけ再試行する
export async function createEstimateWithRetry(deps, prefix, buildData) {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
        const seq = await deps.getNextEstimateSeq(prefix);
        const estimateNumber = await deps.findAvailableBranchNumber(prefix, seq, 1);
        try {
            return await deps.createEstimate(buildData(estimateNumber));
        } catch (e) {
            if (e?.code !== UNIQUE_VIOLATION) throw e;
            lastError = e;
        }
    }
    throw lastError;
}

// 戻り値: { projectId, project }（project は useSupabaseData の未ロード時の形）。失敗時は throw し、
// 作成済みの id を error.createdIds = { estimateId, projectId } に載せる。
export async function importProjectCore(deps, { parsed, fileName, customerId, projectName, now = new Date() }) {
    const ids = { estimateId: null, projectId: null };
    try {
        if (!customerId) throw new Error('顧客が指定されていないため取り込めません');
        const title = (projectName || '').trim() || fileName.replace(/\.[^/.]+$/, '');
        const items = buildImportItems(parsed);
        if (items.length === 0) throw new Error('取り込めるデータが見つかりませんでした');

        const created = await createEstimateWithRetry(deps, buildEstimatePrefix(now), (estimateNumber) => ({
            estimate_number: estimateNumber, customer_id: customerId, customer_honorific: '御中',
            title, site_location: null, work_period: null,
            issue_date: now.toISOString().split('T')[0], valid_until: null, payment_terms: '従来通り',
            notes: parsed.notes || null, tax_rate: 0.10, status: ESTIMATE_STATUS.DRAFT,
            show_net: false, show_subtotals: false, stamp_header: 'company', show_approver: true,
            staff_id: null, net_calc_type: 'perc', net_perc: 95, net_amount: null, total_with_tax: 0,
        }));
        ids.estimateId = created.id;

        const { payloadSheets, payloadItems } = deps.buildSaveItemsPayload([{ id: null, title: null }], items);
        await deps.saveEstimateItemsV2(ids.estimateId, payloadSheets, payloadItems);

        ids.projectId = await deps.syncEstimateToProject({
            projectId: null, title, customerId, status: PROJECT_STATUS.SCHEDULED,
        });
        await deps.updateEstimate(ids.estimateId, { project_id: ids.projectId });
        await deps.copyEstimateItemsToProjectTasks(ids.projectId, items);

        // order は DB 採番値を採用（取得に失敗しても取込自体は成功扱い）
        let order = null;
        try { order = await deps.fetchProjectOrder(ids.projectId); } catch (_) { /* フォールバックに任せる */ }

        return {
            projectId: ids.projectId,
            project: {
                id: ids.projectId, order: order ?? deps.fallbackOrder(),
                siteName: title, short_name: '', status: PROJECT_STATUS.SCHEDULED,
                foreman_worker_id: null, customerId, is_prime_contractor: false,
                startDate: null, endDate: null, bar_color: null, show_on_home: true,
                masterData: [], records: [], progressData: {}, subcontractors: [], _isLoaded: false,
            },
        };
    } catch (e) {
        e.createdIds = ids;
        throw e;
    }
}

// 失敗時のロールバック（子 → 見積の紐付け解除 → 現場 → 見積(ソフト削除) の順）。失敗したステップのメッセージ配列を返す。
export async function rollbackImport(deps, { estimateId, projectId }) {
    const rollbackErrors = [];
    // 成功なら true。失敗は rollbackErrors に積んで false を返す
    const run = async (label, fn) => {
        try {
            const res = await fn();
            if (res?.error) {
                rollbackErrors.push(`${label}: ${res.error.message}`);
                return false;
            }
            return true;
        } catch (err) {
            rollbackErrors.push(`${label}: ${err.message || err}`);
            return false;
        }
    };
    let projectRemoved = true;
    if (projectId) {
        await run('工種削除', () => deps.deleteProjectTasks(projectId));
        if (estimateId) await run('見積の紐付け解除', () => deps.updateEstimate(estimateId, { project_id: null }));
        projectRemoved = await run('現場削除', () => deps.deleteProject(projectId));
    }
    // 現場が残った場合は見積も残す（見積だけ消えて現場が孤立するのを防ぐ）
    if (estimateId && projectRemoved) await run('見積削除', () => deps.deleteEstimate(estimateId));
    return rollbackErrors;
}
