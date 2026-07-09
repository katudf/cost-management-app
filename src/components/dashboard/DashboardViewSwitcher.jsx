import React from 'react';
import { Kanban, List, LayoutGrid } from 'lucide-react';
import { DASHBOARD_VIEW_MODE } from '../../utils/constants';

const MODES = [
    { key: DASHBOARD_VIEW_MODE.KANBAN, label: 'カンバン表示', Icon: Kanban },
    { key: DASHBOARD_VIEW_MODE.LIST, label: 'リスト表示', Icon: List },
    { key: DASHBOARD_VIEW_MODE.COMPACT, label: 'コンパクト表示', Icon: LayoutGrid },
];

/**
 * ホーム画面の工事一覧 表示モード切替（エクスプローラーの表示切替風）
 * 選択中のモードは背景色でハイライトされる。
 */
const DashboardViewSwitcher = ({ viewMode, onChange }) => {
    return (
        <div
            role="group"
            aria-label="工事一覧の表示モード切替"
            className="inline-flex items-center bg-white border border-slate-200 rounded-lg shadow-sm p-1 gap-0.5 shrink-0"
        >
            {MODES.map(({ key, label, Icon }) => (
                <button
                    key={key}
                    type="button"
                    onClick={() => onChange(key)}
                    aria-label={label}
                    title={label}
                    aria-pressed={viewMode === key}
                    className={`p-1.5 rounded-md transition-colors active:scale-95 ${
                        viewMode === key
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                    }`}
                >
                    <Icon size={18} />
                </button>
            ))}
        </div>
    );
};

export default DashboardViewSwitcher;
