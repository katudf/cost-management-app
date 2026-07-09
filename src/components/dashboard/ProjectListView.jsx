import React, { useState, useMemo } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, User, FolderGit2 } from 'lucide-react';
import { PROJECT_STATUS, PROJECT_STATUS_LIST, PROJECT_STATUS_COLOR } from '../../utils/constants';

const SORT_NONE = null;

const COLUMNS = [
    { key: 'siteName', label: '工事名', sortable: true },
    { key: 'status', label: 'ステータス', sortable: true },
    { key: 'foremanName', label: '職長', sortable: true },
    { key: 'overallProgress', label: '進捗', sortable: true, align: 'right' },
    { key: 'predictedProfitLoss', label: '予測損益', sortable: true, align: 'right' },
];

const formatProfitLoss = (value) => {
    const v = Number(value) || 0;
    return `${v >= 0 ? '+' : '-'}¥${Math.abs(Math.round(v)).toLocaleString()}`;
};

/**
 * ホーム画面：リスト（詳細）表示
 * テーブル形式で工事を一覧し、列ヘッダークリックでソートできる。
 * 行クリックで工事詳細へ遷移。ステータスはセレクトでインライン変更可能。
 */
const ProjectListView = ({ projects, workers, onOpenProject, onStatusChange }) => {
    // sort: { key, dir: 'asc' | 'desc' } / null = 既定の並び順（order順）
    const [sort, setSort] = useState(SORT_NONE);

    const rows = useMemo(() => {
        return projects.map(p => ({
            ...p,
            foremanName: p.foreman_worker_id
                ? (workers.find(w => w.id === p.foreman_worker_id)?.name || '未設定')
                : '',
        }));
    }, [projects, workers]);

    const sortedRows = useMemo(() => {
        if (!sort) return rows;
        const dir = sort.dir === 'asc' ? 1 : -1;
        const sorted = [...rows].sort((a, b) => {
            switch (sort.key) {
                case 'siteName':
                    return (a.siteName || '').localeCompare(b.siteName || '', 'ja') * dir;
                case 'foremanName':
                    return (a.foremanName || '').localeCompare(b.foremanName || '', 'ja') * dir;
                case 'status': {
                    const ia = PROJECT_STATUS_LIST.indexOf(a.status || PROJECT_STATUS.ESTIMATE);
                    const ib = PROJECT_STATUS_LIST.indexOf(b.status || PROJECT_STATUS.ESTIMATE);
                    return (ia - ib) * dir;
                }
                case 'overallProgress':
                    return ((Number(a.overallProgress) || 0) - (Number(b.overallProgress) || 0)) * dir;
                case 'predictedProfitLoss':
                    return ((Number(a.predictedProfitLoss) || 0) - (Number(b.predictedProfitLoss) || 0)) * dir;
                default:
                    return 0;
            }
        });
        return sorted;
    }, [rows, sort]);

    // クリックで 昇順 → 降順 → 解除（既定順） を循環
    const handleSortClick = (key) => {
        setSort(prev => {
            if (!prev || prev.key !== key) return { key, dir: 'asc' };
            if (prev.dir === 'asc') return { key, dir: 'desc' };
            return SORT_NONE;
        });
    };

    const renderSortIcon = (key) => {
        if (!sort || sort.key !== key) {
            return <ArrowUpDown size={12} className="text-slate-300 group-hover:text-slate-400" />;
        }
        return sort.dir === 'asc'
            ? <ArrowUp size={12} className="text-blue-600" />
            : <ArrowDown size={12} className="text-blue-600" />;
    };

    if (projects.length === 0) {
        return (
            <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
                <FolderGit2 className="mx-auto w-12 h-12 text-slate-300 mb-3" />
                <p className="text-slate-400 font-bold text-sm">該当する条件の現場がありません。</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            {COLUMNS.map(col => (
                                <th
                                    key={col.key}
                                    className={`px-4 py-3 font-bold text-xs whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleSortClick(col.key)}
                                        title={`${col.label}で並べ替え`}
                                        className={`group inline-flex items-center gap-1 hover:text-slate-700 transition-colors ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
                                    >
                                        {col.label}
                                        {renderSortIcon(col.key)}
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.map(proj => {
                            const status = proj.status || PROJECT_STATUS.ESTIMATE;
                            const progress = Math.min(100, Math.max(0, Number(proj.overallProgress) || 0));
                            return (
                                <tr
                                    key={proj.id}
                                    onClick={() => onOpenProject(proj.id)}
                                    className="border-b border-slate-100 last:border-b-0 hover:bg-blue-50/50 cursor-pointer transition-colors group"
                                >
                                    <td className="px-4 py-3">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); onOpenProject(proj.id); }}
                                            className="font-bold text-slate-800 group-hover:text-blue-700 text-left leading-tight transition-colors"
                                        >
                                            {proj.siteName || '無題の現場'}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PROJECT_STATUS_COLOR[status] || 'bg-slate-400'}`}></span>
                                            <select
                                                value={status}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => { e.stopPropagation(); onStatusChange(proj.id, e.target.value); }}
                                                aria-label="ステータスを変更"
                                                title="ステータスを変更"
                                                className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-blue-400 cursor-pointer"
                                            >
                                                {PROJECT_STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                                            <User size={12} className="text-slate-400 shrink-0" />
                                            {proj.foremanName || '職長未設定'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex items-center justify-end gap-2">
                                            <div className="h-1.5 w-20 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                                                <div
                                                    className={`h-full rounded-full ${PROJECT_STATUS_COLOR[status] || 'bg-slate-400'}`}
                                                    style={{ width: `${progress}%` }}
                                                ></div>
                                            </div>
                                            <span className="text-xs font-bold text-slate-600 w-9 text-right">{Number(proj.overallProgress) || 0}%</span>
                                        </div>
                                    </td>
                                    <td className={`px-4 py-3 text-right whitespace-nowrap text-xs font-bold ${(Number(proj.predictedProfitLoss) || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {formatProfitLoss(proj.predictedProfitLoss)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[11px] font-bold text-slate-400 text-right">
                {projects.length}件
            </div>
        </div>
    );
};

export default ProjectListView;
