import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAllPages';

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
        .select('id, name, resignation_date, worker_type, show_in_assignment')
        .order('display_order', { ascending: true, nullsFirst: false });

/** 全工事案件。 */
export const fetchProjectsResult = () =>
    supabase.from('Projects').select('*').order('created_at', { ascending: true });

/** 指定作業員・指定日の全日報レコード（現場を問わない）。 */
export const fetchWorkerDailyRecordsResult = (workerName, date) =>
    supabase.from('TaskRecords').select('*')
        .eq('worker_name', workerName)
        .eq('date', date);

/** 作業員・日付単位の休憩設定。 */
export const fetchWorkerDailyBreakSettingsResult = (workerName, date) =>
    supabase.from('WorkerDailyBreakSettings').select('*')
        .eq('worker_name', workerName)
        .eq('date', date)
        .maybeSingle();

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
    // 長期の現場では取得上限（1000件）を超えるため、ページを分けて全件取得する
    fetchAllPages(() => supabase.from('TaskRecords').select('*')
        .eq('project_id', projectId)
        .order('id', { ascending: true }));

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

/** 作業員・日付単位の休憩設定を保存する。 */
export async function saveWorkerDailyBreakSettings(workerName, date, breakDurations) {
    const { data, error } = await supabase.from('WorkerDailyBreakSettings').upsert({
        worker_name: workerName,
        date,
        break_durations: breakDurations,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'worker_name,date' }).select().single();
    if (error) throw error;
    return data;
}

// ============================================================
// 書き込み系
// ============================================================

/**
 * DB 関数がまだ無い（マイグレーション 20261105020000 の適用前）ときのエラーか。
 * PostgREST は、名前・引数の組が合う関数が無いと PGRST202 を返す。
 * 画面（PWA）が DB より先に新しくなっても動くよう、適用前は旧方式で処理するために使う。
 * 本番への適用が済んだら、この判定と旧方式の処理は消してよい。
 */
const isMissingRpcError = (error) => error?.code === 'PGRST202';

/** add_project_task を呼ぶ。新しい DB では作業員名も渡して職長を判定し、適用前の DB には旧引数で呼び直す。 */
async function callAddProjectTask({ projectId, name, order, workerId, workerName }) {
    const base = {
        p_project_id: Number(projectId),
        p_name: name,
        p_order: order,
        p_worker_id: workerId ?? null,
    };
    const result = await supabase.rpc('add_project_task', { ...base, p_worker_name: workerName ?? null });
    if (isMissingRpcError(result.error)) return supabase.rpc('add_project_task', base);
    return result;
}

/**
 * 工種を1件追加する。
 * @returns {Promise<object>} 追加された行
 */
export async function insertProjectTask({ projectId, name, order, workerId, workerName }) {
    // worker ロールは ProjectTasks に直接書けないため、職長かどうかを DB 側で確認する RPC を使う
    const { data, error } = await callAddProjectTask({ projectId, name, order, workerId, workerName });
    if (error) throw error;
    if (!data) throw new Error('作業項目の追加結果が取得できませんでした。');
    return data;
}

/**
 * 共通現場（社内業務・有給など）に既定の工種を自動生成する。
 * 表示の補助であり必須ではないため、失敗しても throw せず null を返す。
 * @returns {Promise<object[]|null>} 追加された行の配列。失敗時は null。
 */
export async function insertDefaultProjectTask({ projectId, name, workerId, workerName }) {
    const { data, error } = await callAddProjectTask({ projectId, name, order: 1, workerId, workerName });
    if (error || !data) return null;
    return [data];
}

/**
 * 指定作業員・指定日・指定現場の日報レコードをすべて削除する（DB 関数 delete_worker_project_day）。
 * 同じ現場・日付の残業／作業手当の承認申請も同じトランザクションで削除する。
 */
export async function deleteProjectDayRecords({ projectId, workerName, date }) {
    const { error } = await supabase.rpc('delete_worker_project_day', {
        p_project_id: Number(projectId),
        p_worker_name: workerName,
        p_date: date,
    });
    if (!isMissingRpcError(error)) {
        if (error) throw error;
        return;
    }
    // DB 関数の適用前は旧方式（日報だけを削除。承認申請は残る）
    const { error: fallbackError } = await supabase.from('TaskRecords').delete()
        .eq('worker_name', workerName)
        .eq('date', date)
        .eq('project_id', projectId);
    if (fallbackError) throw fallbackError;
}

/**
 * 日報の保存（DB 関数 save_daily_report で 1 トランザクション）。
 *
 * 日報の削除・更新・追加、職長の進捗・協力業者、残業／作業手当の承認申請の同期を
 * すべて 1 回で行う。途中で失敗した場合は何も保存されないため、そのまま再送してよい。
 * 応答だけが届かなかった場合の再送でも、時刻付きの日報は同じ時間枠の行が更新されるだけで
 * 二重登録にはならない（TaskRecords の一意索引 task_records_worker_slot_key）。
 *
 * 作業員名・作業員 ID は画面で選んだ作業員（共有アカウントのため申告値）。
 * DB 側は「その作業員の日報だけ」を削除・更新し、進捗・協力業者は職長のみ受け付ける。
 *
 * @param {object} payload save_daily_report の p_payload（キーは DB 関数のコメント参照）
 * @returns {Promise<{ insertedIds: number[], remapped: { old_id: number, new_id: number }[] }>}
 *   insertedIds は payload.inserts と同じ順。remapped は「更新対象が消えていたので追加し直した」行。
 */
export async function saveDailyReport(payload) {
    const { data, error } = await supabase.rpc('save_daily_report', { p_payload: payload });
    if (error) throw error;
    return {
        insertedIds: data?.inserted_ids || [],
        remapped: data?.remapped || [],
        // 承認申請の同期だけ失敗した（日報は保存済み）
        approvalSyncFailed: data?.approval_sync_failed === true,
    };
}
