import React, { useMemo } from 'react';
import { FolderGit2 } from 'lucide-react';
import { PROJECT_STATUS, PROJECT_STATUS_LIST, PROJECT_STATUS_COLOR } from '../../utils/constants';

const formatProfitLoss = (value) => {
    const v = Number(value) || 0;
    return `${v >= 0 ? '+' : '-'}¥${Math.abs(Math.round(v)).toLocaleString()}`;
};

/**
 * ホーム画面：コンパクト（タイル）表示
 * ステータスごとのセクションに小さなタイルを敷き詰め、
 * 1画面でより多くの工事を俯瞰できる高密度ビュー。タイルクリックで詳細へ遷移。
 */
const ProjectCompactView = ({ projects, onOpenProject }) => {
    const grouped = useMemo(() => {
        return PROJECT_STATUS_LIST
            .map(status => ({
                status,
                items: projects.filter(p => (p.status || PROJECT_STATUS.ESTIMATE) === status),
            }))
            .filter(g => g.items.length > 0);
    }, [projects]);

    if (projects.length === 0) {
        return (
            <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
                <FolderGit2 className="mx-auto w-12 h-12 text-slate-300 mb-3" />
                <p className="text-slate-400 font-bold text-sm">該当する条件の現場がありません。</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {grouped.map(({ status, items }) => (
                <section key={status}>
                    <h3 className="flex items-center gap-2 mb-2 px-1 font-bold text-slate-700 text-sm">
                        <span className={`w-3 h-3 rounded-full ${PROJECT_STATUS_COLOR[status] || 'bg-slate-400'}`}></span>
                        {status}
                        <span className="text-xs font-bold text-slate-500 bg-white px-2 py-0.5 rounded-full shadow-sm">{items.length}件</span>
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                        {items.map(proj => {
                            const progress = Math.min(100, Math.max(0, Number(proj.overallProgress) || 0));
                            const profitLoss = Number(proj.predictedProfitLoss) || 0;
                            return (
                                <button
                                    key={proj.id}
                                    type="button"
                                    onClick={() => onOpenProject(proj.id)}
                                    title={proj.siteName || '無題の現場'}
                                    className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 hover:-translate-y-0.5 transition-all text-left p-2.5 flex flex-col gap-1.5 group"
                                >
                                    <span className="font-bold text-slate-800 group-hover:text-blue-700 text-xs leading-tight line-clamp-2 transition-colors">
                                        {proj.siteName || '無題の現場'}
                                    </span>
                                    <span className="mt-auto flex items-center justify-between gap-1 text-[10px] font-bold">
                                        <span className="text-slate-500">{Number(proj.overallProgress) || 0}%</span>
                                        <span className={profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}>
                                            {formatProfitLoss(profitLoss)}
                                        </span>
                                    </span>
                                    <span className="block h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                                        <span
                                            className={`block h-full rounded-full ${PROJECT_STATUS_COLOR[status] || 'bg-slate-400'}`}
                                            style={{ width: `${progress}%` }}
                                        ></span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            ))}
        </div>
    );
};

export default ProjectCompactView;
