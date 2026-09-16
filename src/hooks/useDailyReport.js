import { supabase } from '../lib/supabase';

/**
 * 作業員アプリ（WorkerApp）の日報データアクセスを一箇所に集約するモジュール。
 *
 * フェーズ2 手順6。以前は WorkerApp.jsx の中に supabase 直呼びが22件散らばっていた。
 *
 * ここではデータの読み書きだけを行い、
 * トースト通知・ローディング表示・オフライン下書きキューの操作は呼び出し側の責務とする
 * （手順2で確立した規約）。
 *
 * ## fetchWithCache との関係
 * src/utils/offlineCache.js の fetchWithCache(key, fetcher) は
 * 「Promise<{data, error}> を返す関数」を要求し、内部で if (error) throw error; した上で
 * 失敗時は localStorage のキャッシュへフォールバックする。
 * そのため参照系は await 済みの結果ではなく {data, error} を返すサンクとして公開する。
 * await して throw する形にすると、オフライン時のキャッシュフォールバックが効かなくなる。
 *
 * 一方、書き込み系と「キャッシュに載せない参照」は throw する通常の async 関数とする。
 */

// ============================================================
// 参照系（fetchWithCache に渡すサンク。{data, error} を返す）
// ============================================================

/** 作業員名簿。workerロールはWorkers基表を直接読めない（機微カラム遮蔽）ため安全カラムのみのビューを使う。 */
export const fetchWorkersDirectoryResult = () =>
    supabase.from('workers_directory')
        .select('id, name, resignation_date, worker_type')
        .order('display_order', { ascending: true, nullsFirst: false });

/** 全工事案件。 */
export const fetchProjectsResult = () =>
    supabase.from('Projects').select('*').order('created_at', { ascending: true });

/** 指定作業員・指定日の全日報レコード（現場を問わない）。 */
export const fetchWorkerDailyRecordsResult = (workerName, date) =>
    supabase.from('TaskRecords').select('*')
        .eq('worker_name', workerName)
        .eq('date', date);

/** 指定現場の工種一覧。 */
export const fetchProjectTasksResult = (projectId) =>
    supabase.from('ProjectTasks').select('*')
        .eq('projectId', projectId)
        .order('order', { ascending: true });

/** 指定現場・指定作業員・指定日の日報レコード。 */
export const fetchTaskRecordsResult = (projectId, workerName, date) =>
    supabase.from('TaskRecords').select('*')
        .eq('project_id', projectId)
        .eq('worker_name', workerName)
        .eq('date', date);

/** 指定現場・指定日の協力業者レコード。 */
export const fetchSubcontractorRecordsResult = (projectId, date) =>
    supabase.from('SubcontractorRecords').select('*')
        .eq('project_id', projectId)
        .eq('date', date);

/** 指定現場の全日報レコード（職長の進捗確認用）。 */
export const fetchAllProjectRecordsResult = (projectId) =>
    supabase.from('TaskRecords').select('*').eq('project_id', projectId);

/** 指定現場の全協力業者レコード（職長の進捗確認用）。 */
export const fetchAllSubcontractorRecordsResult = (projectId) =>
    supabase.from('SubcontractorRecords').select('*').eq('project_id', projectId);

// ============================================================
// 参照系（throw する通常の async 関数）
// ============================================================

/**
 * 指定日より前で、その作業員・その現場に実績がある最新の日付を1件返す。
 * @returns {Promise<string|null>} 'YYYY-MM-DD'。見つからなければ null。
 */
export async function fetchLatestRecordDateBefore(projectId, workerName, date) {
    const { data, error } = await supabase.from('TaskRecords')
        .select('date')
        .eq('project_id', projectId)
        .eq('worker_name', workerName)
        .lt('date', date)
        .order('date', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0].date : null;
}

/** 指定現場・作業員・日付の日報レコードを取得する（コピー元の読み出しなど）。 */
export async function fetchTaskRecords(projectId, workerName, date) {
    const { data, error } = await supabase.from('TaskRecords').select('*')
        .eq('project_id', projectId)
        .eq('worker_name', workerName)
        .eq('date', date);
    if (error) throw error;
    return data || [];
}

/** 指定作業員・指定日の全日報レコードを取得する（保存・削除後の再読込用）。 */
export async function fetchWorkerDailyRecords(workerName, date) {
    const { data, error } = await supabase.from('TaskRecords').select('*')
        .eq('worker_name', workerName)
        .eq('date', date);
    if (error) throw error;
    return data || [];
}

// ============================================================
// 書き込み系
// ============================================================

/**
 * 工種を1件追加する。
 * @returns {Promise<object>} 追加された行
 */
export async function insertProjectTask({ projectId, name, order }) {
    const { data, error } = await supabase.from('ProjectTasks').insert([{
        projectId,
        name,
        target_hours: 0,
        estimated_amount: 0,
        order,
        progress_percentage: 0,
    }]).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('作業項目の追加結果が取得できませんでした。');
    return data[0];
}

/**
 * 共通現場（社内業務・有給など）に既定の工種を自動生成する。
 * 表示の補助であり必須ではないため、失敗しても throw せず null を返す。
 * @returns {Promise<object[]|null>} 追加された行の配列。失敗時は null。
 */
export async function insertDefaultProjectTask({ projectId, name }) {
    const { data, error } = await supabase.from('ProjectTasks').insert([{
        projectId: Number(projectId),
        name,
        target_hours: 0,
        estimated_amount: 0,
        order: 1,
        progress_percentage: 0,
    }]).select();
    if (error || !data || data.length === 0) return null;
    return data;
}

/** 指定作業員・指定日・指定現場の日報レコードをすべて削除する。 */
export async function deleteProjectDayRecords({ projectId, workerName, date }) {
    const { error } = await supabase.from('TaskRecords').delete()
        .eq('worker_name', workerName)
        .eq('date', date)
        .eq('project_id', projectId);
    if (error) throw error;
}

/**
 * 日報の保存トランザクション。
 *
 * 削除 → 更新（並列） → 追加 → 協力業者の削除/更新/追加 の順で実行する。
 * 途中で失敗した場合は throw し、呼び出し側がオフライン下書きへの退避を判断する。
 * この一体性を保つため、個々のクエリ単位ではなくまとめて1関数として公開している。
 *
 * @returns {Promise<object[]>} 追加された TaskRecords の行（返り順は入力順と一致する）
 */
export async function saveDailyReport({
    deleteIds = [],
    updateOps = [],
    insertPayloads = [],
    progressUpdates = [],
    deletedSubcontractorIds = [],
    subcontractorUpdates = [],
    subcontractorInsertPayloads = [],
}) {
    // 削除はまとめて1回
    if (deleteIds.length > 0) {
        const { error } = await supabase.from('TaskRecords').delete().in('id', deleteIds);
        if (error) throw error;
    }

    // 更新・進捗更新は並列実行
    const parallelOps = updateOps.map(u => supabase.from('TaskRecords').update(u.data).eq('id', u.id));
    progressUpdates.forEach(t => {
        parallelOps.push(supabase.from('ProjectTasks').update({ progress_percentage: t.progress_percentage }).eq('id', t.id));
    });
    if (parallelOps.length > 0) {
        const results = await Promise.all(parallelOps);
        const failed = results.find(r => r.error);
        if (failed) throw failed.error;
    }

    // 新規 insert はまとめて1回（返り順は入力順と一致するため呼び出し側で id を書き戻せる）
    let insertedRecords = [];
    if (insertPayloads.length > 0) {
        const { data, error } = await supabase.from('TaskRecords').insert(insertPayloads).select();
        if (error) throw error;
        insertedRecords = data || [];
    }

    // 協力業者
    if (deletedSubcontractorIds.length > 0) {
        const { error } = await supabase.from('SubcontractorRecords').delete().in('id', deletedSubcontractorIds);
        if (error) throw error;
    }
    const subOps = subcontractorUpdates.map(s =>
        supabase.from('SubcontractorRecords')
            .update({ company_name: s.company_name, worker_count: s.worker_count })
            .eq('id', s.id)
    );
    if (subcontractorInsertPayloads.length > 0) {
        subOps.push(supabase.from('SubcontractorRecords').insert(subcontractorInsertPayloads));
    }
    if (subOps.length > 0) {
        const subResults = await Promise.all(subOps);
        const subFailed = subResults.find(r => r.error);
        if (subFailed) throw subFailed.error;
    }

    return insertedRecords;
}
