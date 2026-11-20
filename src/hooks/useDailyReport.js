import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAllPages';
import { isMissingRpcError, isMissingRelationError } from '../utils/supabaseErrors';

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
    // 安全カラムのみのビューなので '*' でよい（subcontractor_id はマイグレーション適用後に加わる。列名で指定すると適用前に失敗する）
    supabase.from('workers_directory')
        .select('*')
        .order('display_order', { ascending: true, nullsFirst: false });

/**
 * 全工事案件。金額・顧客・PDF の列を含まない名簿ビュー projects_directory から読む
 * （docs/specs/daily-report-db-hardening.md §4.8 DB-9。作業員は Projects の基表を読めなくなる）。
 * ビューが無い DB（マイグレーション 20261120010000 の適用前）では、従来どおり基表から読む。
 */
export const fetchProjectsResult = async () => {
    const result = await supabase.from('projects_directory').select('*').order('created_at', { ascending: true });
    if (!isMissingRelationError(result.error)) return result;
    return supabase.from('Projects').select('*').order('created_at', { ascending: true });
};

/**
 * 配置表用: 期間内に日報がある（現場・作業員名・日付）の組。時間・メモは含まない（DB 関数 get_task_record_presence）。
 * 作業員は他の人の日報を直接読めなくなるため（§4.3 DB-2）。関数が無い DB では、従来どおり TaskRecords から読む。
 * 期間全体が未来なら（終わりが始まりより前）空を返す。
 * @param {string} startStr 'YYYY-MM-DD'
 * @param {string} endStr   'YYYY-MM-DD'（62 日まで）
 */
export const fetchTaskRecordPresenceResult = async (startStr, endStr) => {
    if (endStr < startStr) return { data: [], error: null };
    const result = await supabase.rpc('get_task_record_presence', { p_start: startStr, p_end: endStr });
    if (!isMissingRpcError(result.error)) return result;
    return supabase.from('TaskRecords').select('project_id, worker_name, date').gte('date', startStr).lte('date', endStr);
};

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

/**
 * 下請け会社の一覧（日報の協力業者入力で選ぶ）。標準単価を含まない安全列ビュー。
 * マイグレーション（20261112000000）の適用前はビューが無く error になる。呼び出し側で空扱いにする。
 */
export const fetchSubcontractorDirectoryResult = () =>
    supabase.from('subcontractors_directory').select('id, name, active')
        .eq('active', true)
        .order('id', { ascending: true });

/**
 * 職長向け: 現場の協力業者費の合計（常用 + 請負）。単価・契約は返さない（DB の RPC が集計する）。
 * マイグレーション適用前は関数が無く error になる。呼び出し側で従来の記録からの計算に戻す。
 */
export const fetchProjectSubcontractCostResult = (projectId, workerId, workerName) =>
    supabase.rpc('get_project_subcontract_cost', {
        p_project_id: Number(projectId),
        p_worker_id: workerId,
        p_worker_name: workerName,
    });

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

/**
 * 作業員・日付単位の休憩設定を保存する。
 * 休憩設定は save_daily_report が日報と同じトランザクションで保存する（payload の break_durations）。
 * これは DB 関数が休憩設定を保存しなかったとき（マイグレーション 20261120010000 の適用前）の予備。
 */
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
 * （DB 関数が無いときに TaskRecords を直接消す旧方式は削除した。作業員は TaskRecords に直接書けなくなるため。
 *   docs/specs/daily-report-db-hardening.md §4.2 DB-1）
 */
export async function deleteProjectDayRecords({ projectId, workerName, date }) {
    const { error } = await supabase.rpc('delete_worker_project_day', {
        p_project_id: Number(projectId),
        p_worker_name: workerName,
        p_date: date,
    });
    if (error) throw error;
}

/**
 * 日報の保存（DB 関数 save_daily_report で 1 トランザクション）。
 *
 * 日報の削除・更新・追加、職長の進捗・協力業者、残業／作業手当の承認申請の同期を
 * すべて 1 回で行う。途中で失敗した場合は何も保存されないため、そのまま再送してよい。
 * 応答だけが届かなかった場合の再送でも、時刻付きの日報は同じ時間枠の行が更新されるだけで
 * 二重登録にはならない（TaskRecords の一意索引 task_records_worker_slot_key）。
 *
 * 作業員名・作業員 ID は、作業員のログインでは DB 側でログイン中の本人に置き換えられる（担当者の代理入力では送った値）。
 * DB 側は「その作業員・この現場・この日の日報だけ」を削除・更新し（休憩の再計算は同じ日の他の現場も可）、
 * 進捗・協力業者は職長のみ受け付ける。
 *
 * payload の expected_versions（{ "<record_id>": "<読み込んだときの updated_at>" }）と progress[].expected_progress を送ると、
 * 画面を開いた後に他の人が直していたとき、何も保存せずに競合のエラー（code 'PT409'）になる。
 * break_durations を送ると、休憩設定も同じトランザクションで保存する。
 * （docs/specs/daily-report-db-hardening.md §4.4〜4.7。マイグレーション 20261120010000 の適用前の DB は、これらのキーを無視する）
 *
 * @param {object} payload save_daily_report の p_payload（キーは DB 関数のコメント参照）
 * @returns {Promise<{ insertedIds: number[], remapped: { old_id: number, new_id: number }[],
 *   approvalSyncFailed: boolean, breakSaved: boolean, versions: Record<string, string>|null }>}
 *   insertedIds は payload.inserts と同じ順。remapped は「更新対象が消えていたので追加し直した」行（版を送らなかったときだけ起きる）。
 *   breakSaved は休憩設定を保存したか（false なら DB が古いので、呼び出し側で saveWorkerDailyBreakSettings を呼ぶ）。
 *   versions は保存後のこの作業員・この日の全行の版（DB が古ければ null）。
 */
export async function saveDailyReport(payload) {
    const { data, error } = await supabase.rpc('save_daily_report', { p_payload: payload });
    if (error) throw error;
    return {
        insertedIds: data?.inserted_ids || [],
        remapped: data?.remapped || [],
        // 承認申請の同期だけ失敗した（日報は保存済み）
        approvalSyncFailed: data?.approval_sync_failed === true,
        breakSaved: data?.break_saved === true,
        versions: data?.versions && typeof data.versions === 'object' ? data.versions : null,
    };
}
