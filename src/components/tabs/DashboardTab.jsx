import React from 'react';
import { Layout, TrendingUp, TrendingDown, Clipboard } from 'lucide-react';

const DashboardTab = ({
    activeProject,
    summaryData,
    updateLayer,
    saveProgressDB,
    handleExportToExcel,
    isLoading
}) => {
    return (
        <div className={`p-6 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            {/* 全体の予測損益サマリーを表示 */}
            <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={`p-6 rounded-2xl border-2 flex flex-col justify-center transition-all shadow-lg ${summaryData.totalPredictedProfitLoss >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200 animate-pulse'}`}>
                    <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">現場全体の予測粗利</div>
                    <div className={`text-3xl font-black flex items-center gap-2 ${summaryData.totalPredictedProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summaryData.totalPredictedProfitLoss >= 0 ? <TrendingUp size={32} /> : <TrendingDown size={32} />}
                        ¥{Math.abs(Math.round(summaryData.totalPredictedProfitLoss)).toLocaleString()}
                    </div>
                    <div className={`text-[10px] font-bold mt-1 ${summaryData.totalPredictedProfitLoss >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {summaryData.totalPredictedProfitLoss >= 0 ? '現在の進捗ペースなら目標粗利を確保可能だ！会社経費もカバーできるぞ！' : 'このままだと現場粗利がマイナスだ。至急対策を！'}
                    </div>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 flex flex-col justify-center">
                    <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">消化済工数 / 全体目標</div>
                    <div className="text-2xl font-black text-slate-800 flex items-baseline gap-2">
                        {summaryData.totalActual}<span className="text-sm font-normal text-slate-500">h</span>
                        <span className="text-slate-300 font-light mx-1">/</span>
                        {summaryData.totalTarget}<span className="text-sm font-normal text-slate-500">h</span>
                    </div>
                </div>

                <div className="bg-orange-50 p-6 rounded-2xl border border-orange-200 flex flex-col justify-center">
                    <div className="text-xs font-bold text-orange-600 mb-1 uppercase tracking-wider">協力業者 発生コスト (累計)</div>
                    <div className="text-2xl font-black text-orange-600 flex items-baseline gap-2">
                        ¥{Math.round(summaryData.subcontractorCost || 0).toLocaleString()}
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between mb-4 border-b pb-4">
                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800"><Layout className="text-blue-500 w-5 h-5" /> 項目別詳細予測</h2>
                <button
                    onClick={handleExportToExcel}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-green-700 shadow-sm border border-green-700"
                >
                    <Clipboard size={16} /> Excel出力
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b text-slate-600 text-sm">
                            <th className="p-4 font-bold">作業項目</th>
                            <th className="p-4 font-bold text-right">見積金額</th>
                            <th className="p-4 font-bold">目標/実績</th>
                            <th className="p-4 font-bold w-40">進捗</th>
                            <th className="p-4 font-bold text-center">工数差異</th>
                            <th className="p-4 font-bold text-right">項目別予測粗利</th>
                        </tr>
                    </thead>
                    <tbody>
                        {summaryData.items.map(item => (
                            <tr key={item.id} className={`border-b transition ${item.status === 'danger' ? 'bg-red-50' : 'hover:bg-slate-50'}`}>
                                <td className="p-4">
                                    <div className="font-bold text-sm">{item.task}</div>
                                </td>
                                <td className="p-4 text-right">
                                    <div className="font-mono font-bold text-slate-800">¥{Math.round(item.estimatedAmount).toLocaleString()}</div>
                                </td>
                                <td className="p-4">
                                    <div className="text-[10px] text-slate-500 tracking-tighter">目標: {item.target}h</div>
                                    <div className="font-mono font-bold text-slate-700">{item.actual}h <span className="text-[10px] font-normal">消化</span></div>
                                </td>
                                <td className="p-4">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="range" min="0" max="100" step="5"
                                            value={item.progress}
                                            onChange={(e) => {
                                                const val = Number(e.target.value);
                                                updateLayer(p => ({ progressData: { ...p.progressData, [item.id]: val } }));
                                            }}
                                            onMouseUp={(e) => saveProgressDB(item.id, Number(e.target.value))}
                                            onTouchEnd={(e) => saveProgressDB(item.id, Number(e.target.value))}
                                            className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                        />
                                        <span className="text-xs font-black text-blue-700 w-8">{item.progress}%</span>
                                    </div>
                                </td>
                                <td className="p-4 text-center">
                                    <div className={`text-lg font-black ${item.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {item.variance > 0 ? '+' : ''}{item.variance.toFixed(1)}%
                                    </div>
                                </td>
                                <td className="p-4 text-right">
                                    <div className={`flex items-center justify-end gap-1 font-black ${item.predictedProfitLoss < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {item.progress > 0 ? `¥${Math.abs(Math.round(item.predictedProfitLoss)).toLocaleString()}` : '-'}
                                    </div>
                                    <div className="text-[9px] text-slate-400 font-bold">{item.predictedProfitLoss < 0 ? '損失予知' : '利益見込'}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default DashboardTab;
