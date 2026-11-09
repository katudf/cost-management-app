import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toDateStr } from '../utils/dateUtils';
import { applyTargetNinku, restoreNinkuEntry, createLatestGuard } from '../utils/ninkuState';

/**
 * 現場ごとの「消化人工 / 目標人工」を取得する。
 * 消化人工は当面、配置表の基準日（既定は今日）までの配置実績から DB 関数 get_project_ninku_summary で求める
 * （日報ベースへ切り替えるときは、この関数とDB関数の中身だけを差し替える）。
 * 目標人工は配置表で現場ごとに入力した値（Projects.assignment_target_ninku。未設定は null）。
 *
 * @param {Array<number>|null} [projectIds] 集計する現場（null なら全現場）
 * @param {string} [asOf] 'YYYY-MM-DD'（既定は今日・端末の日付）
 * @returns {Promise<Record<number, {consumedNinku: number, targetNinku: number|null}>>}
 */
export async function fetchProjectNinkuSummary(projectIds = null, asOf = toDateStr(new Date())) {
    const { data, error } = await supabase.rpc('get_project_ninku_summary', {
        p_as_of: asOf,
        p_project_ids: projectIds
    });
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => {
        map[r.project_id] = {
            consumedNinku: Number(r.consumed_ninku) || 0,
            targetNinku: r.target_ninku === null || r.target_ninku === undefined ? null : Number(r.target_ninku)
        };
    });
    return map;
}

/**
 * 配置表の目標人工を保存する（管理者・事務のみ。RLS で制御）。
 * @param {number} projectId
 * @param {number|null} targetNinku 0以上の整数。null で未設定に戻す
 */
export async function saveProjectTargetNinku(projectId, targetNinku) {
    const { error } = await supabase
        .from('Projects')
        .update({ assignment_target_ninku: targetNinku })
        .eq('id', projectId);
    if (error) throw error;
}

const EMPTY = {};

/**
 * fetchProjectNinkuSummary をフックで使う。
 * - projectIds（null なら全現場）か refreshKey が変わるたびに取り直す。
 *   続けて変わるときは delayMs だけ待ってまとめて1回にする。
 * - asOf（'YYYY-MM-DD'。省略時は取得した日の今日）時点の消化人工を求める。asOf が変わったらすぐ取り直す。
 * - loadedAsOf は今表示している値がどの日時点のものか（取り直し中は前の日付のまま）。
 * - 取得の応答が前後しても、最後に始めた取得の応答だけを使う。
 * - 取得に失敗したら onError を呼ぶ（失敗が続く間は1回だけ。成功したらまた知らせる）。
 * - updateTargetNinku で目標人工を保存し、画面の値もすぐ書き換える
 *   （取得中の古い応答は捨て、保存後に取り直す。失敗したら元に戻して例外を投げる）。
 */
export function useProjectNinku({ projectIds = null, asOf = null, refreshKey, delayMs = 800, enabled = true, onError } = {}) {
    const [ninkuByProject, setNinkuByProject] = useState(EMPTY);
    const [loadError, setLoadError] = useState(null);
    const [loadedAsOf, setLoadedAsOf] = useState(null);
    const isFirst = useRef(true);
    const guardRef = useRef(null);
    if (!guardRef.current) guardRef.current = createLatestGuard();
    const errorNotifiedRef = useRef(false);

    // reload から最新の値を見るため ref に持つ（reload の参照を変えずに済む）
    const projectIdsRef = useRef(projectIds);
    projectIdsRef.current = projectIds;
    const asOfRef = useRef(asOf);
    asOfRef.current = asOf;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const latestRef = useRef(ninkuByProject);
    latestRef.current = ninkuByProject;

    const reload = useCallback(async () => {
        const guard = guardRef.current;
        const ids = projectIdsRef.current;
        const day = asOfRef.current || toDateStr(new Date());
        const n = guard.start();
        if (ids && ids.length === 0) {
            setNinkuByProject(EMPTY);
            setLoadError(null);
            setLoadedAsOf(day);
            return EMPTY;
        }
        try {
            const map = await fetchProjectNinkuSummary(ids, day);
            if (!guard.isLatest(n)) return null;
            setNinkuByProject(map);
            setLoadError(null);
            setLoadedAsOf(day);
            errorNotifiedRef.current = false;
            return map;
        } catch (e) {
            if (!guard.isLatest(n)) return null;
            console.error('人工集計の取得に失敗しました:', e);
            setLoadError(e);
            if (!errorNotifiedRef.current) {
                errorNotifiedRef.current = true;
                onErrorRef.current?.(e);
            }
            return null;
        }
    }, []);

    const projectIdsKey = projectIds ? projectIds.join(',') : '*';
    // 基準日の切り替えはクリック1回ごとなので、待たずに取り直す
    const lastAsOfRef = useRef(asOf);
    useEffect(() => {
        if (!enabled) return undefined;
        const asOfChanged = lastAsOfRef.current !== asOf;
        lastAsOfRef.current = asOf;
        if (isFirst.current) {
            isFirst.current = false;
            reload();
            return undefined;
        }
        if (delayMs <= 0 || asOfChanged) {
            reload();
            return undefined;
        }
        const timer = setTimeout(reload, delayMs);
        return () => clearTimeout(timer);
    }, [enabled, refreshKey, projectIdsKey, asOf, delayMs, reload]);

    const updateTargetNinku = useCallback(async (projectId, targetNinku) => {
        const previous = latestRef.current[projectId];
        // 保存前に読んだ集計が後から届いて、新しい目標を古い値で上書きしないようにする
        guardRef.current.invalidate();
        setNinkuByProject(prev => applyTargetNinku(prev, projectId, targetNinku));
        try {
            await saveProjectTargetNinku(projectId, targetNinku);
        } catch (e) {
            setNinkuByProject(prev => restoreNinkuEntry(prev, projectId, previous));
            throw e;
        }
        // 取得中だった分を捨てたので、保存後の値で取り直す
        reload();
    }, [reload]);

    return { ninkuByProject, loadError, loadedAsOf, reload, updateTargetNinku };
}
