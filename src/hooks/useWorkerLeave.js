import { supabase } from '../lib/supabase';
import { LEAVE_TITLES } from '../utils/leaveUtils';

/**
 * 日報画面から入力する有給・振休（配置表 Assignments の「現場なし」行）のデータアクセス。
 *
 * 作業員アカウントは Assignments に書き込めないため、保存は DB 関数 save_worker_day_leave を通す。
 * 作業員の決め方は save_daily_report と同じ（個人アカウントは DB 側で本人に固定）。
 * 休みの保存はオンライン時だけ行う（オフライン下書きには載せない）ため、どれも throw する async 関数。
 * トースト通知は呼び出し側の責務。
 */

/**
 * その作業員・その日の有給・振休の行。
 * @param {number} workerId
 * @param {string} date 'YYYY-MM-DD'
 * @returns {Promise<Array<{ id: number, title: string, substitute_for_date: string|null, assignment_order: number|null }>>}
 */
export async function fetchWorkerDayLeave(workerId, date) {
    const { data, error } = await supabase
        .from('Assignments')
        .select('id, title, substitute_for_date, assignment_order')
        .eq('workerId', workerId)
        .eq('date', date)
        .is('projectId', null)
        .in('title', LEAVE_TITLES)
        .order('assignment_order', { ascending: true });
    if (error) throw error;
    return data || [];
}

/**
 * 振替元の候補（休業日に日報がある日と、その残り日数 1 / 0.5）。新しい順。
 * date の休み（これから置き換える分）が使っている分は残りに含めて返る。
 * @param {{ id: number, name: string }} worker
 * @param {string} date 休みを取る日 'YYYY-MM-DD'
 * @returns {Promise<Array<{ work_date: string, remaining: number }>>}
 */
export async function fetchSubstituteHolidayCandidates(worker, date) {
    const { data, error } = await supabase.rpc('get_substitute_holiday_candidates', {
        p_worker_id: worker.id,
        p_worker_name: worker.name,
        p_date: date,
    });
    if (error) throw error;
    return (data || []).map(r => ({ work_date: r.work_date, remaining: Number(r.remaining) }));
}

/**
 * その日の有給・振休を entries で置き換える（空配列で取り消し）。
 * @param {{ id: number, name: string }} worker
 * @param {string} date 'YYYY-MM-DD'
 * @param {Array<{ title: string, substitute_for_date: string|null }>} entries
 * @returns {Promise<Array<{ id: number, title: string, substitute_for_date: string|null, assignment_order: number }>>} 保存後の行
 */
export async function saveWorkerDayLeave(worker, date, entries) {
    const { data, error } = await supabase.rpc('save_worker_day_leave', {
        p_worker_id: worker.id,
        p_worker_name: worker.name,
        p_date: date,
        p_entries: entries,
    });
    if (error) throw error;
    return data || [];
}
