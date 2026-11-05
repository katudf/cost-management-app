/**
 * 配置表の表示規則（管理画面の配置表・工程表の共有表示・作業員画面の配置表で共通）。
 *
 * 以前は画面ごとに「どの案件をバーに出すか」「色をどう決めるか」「1マス内の並び順」を
 * 別々に書いていて、同じ現場が画面によって違う色・順番で表示されていた。
 * DB 関数 get_public_schedule の bar_index も、ここと同じ規則で計算すること。
 */
import { DEFAULT_COLORS, PROJECT_STATUS } from './constants';

/** 有給用の案件はバーに出さない */
export const BAR_EXCLUDED_NAMES = ['【会社】有給', '有給', '【有給】'];

/** バーに出さない案件（完了・見積など）の配置セルの色 */
export const NON_BAR_PROJECT_COLOR = '#94A3B8';

/** 配置表の上部にバーとして並べる案件か（予定・施工中で、有給用でない） */
export const isBarProject = (project) =>
    [PROJECT_STATUS.SCHEDULED, PROJECT_STATUS.IN_PROGRESS].includes(project?.status)
    && !BAR_EXCLUDED_NAMES.includes(project?.name);

/** バーの並び順（表示順 → 作成日時。表示順が無いものは後ろ） */
export const compareBarOrder = (a, b) => {
    const ao = a.display_order, bo = b.display_order;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
};

/**
 * バーに出す案件の並び位置（0 始まり）を id ごとに返す。色の既定値はこの位置で決まる。
 * @param {object[]} projects status / name / display_order / created_at を持つ案件
 * @returns {Map<number, number>}
 */
export function buildBarIndexMap(projects) {
    const map = new Map();
    (projects || [])
        .filter(isBarProject)
        .sort(compareBarOrder)
        .forEach((p, idx) => map.set(p.id, idx));
    return map;
}

/**
 * 案件の表示色。個別に色が設定されていればそれを使い、無ければバーの並び位置から既定色を選ぶ。
 * バーに出さない案件は灰色。
 */
export function projectColor(project, barIndex) {
    if (project?.bar_color) return project.bar_color;
    if (barIndex != null) return DEFAULT_COLORS[barIndex % DEFAULT_COLORS.length];
    return NON_BAR_PROJECT_COLOR;
}

/**
 * 配置レコード配列から workerId_date → 配置配列（assignment_order 順）のルックアップを作る。
 * 並び順が未設定（null）の配置は先頭に置く（管理画面の配置表と同じ）。
 */
export function buildAssignmentLookup(assignments) {
    const lookup = {};
    (assignments || []).forEach(a => {
        const key = `${a.workerId}_${a.date}`;
        if (!lookup[key]) lookup[key] = [];
        lookup[key].push(a);
    });
    Object.keys(lookup).forEach(key => {
        lookup[key].sort((a, b) => (a.assignment_order || 0) - (b.assignment_order || 0));
    });
    return lookup;
}
