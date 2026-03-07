import React from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';

const InputTab = ({
    activeProject,
    isLoading,
    addRecord,
    updateRecordField,
    removeRecord,
    workers,
    focusedWorkerRow,
    setFocusedWorkerRow,
    addSubcontractorRecord,
    updateSubcontractorRecordField,
    removeSubcontractorRecord
}) => {
    return (
        <div className={`p-6 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold flex items-center gap-2 text-blue-600"><Edit3 size={20} /> 日報実績入力</h2>
                <button onClick={addRecord} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-blue-700 shadow-md">
                    <Plus size={16} /> 日報1件追加
                </button>
            </div>
            <div className="overflow-x-auto mb-8">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b text-slate-500 font-bold">
                        <tr>
                            <th className="p-3 w-32">日付</th>
                            <th className="p-3">作業</th>
                            <th className="p-3 w-24">名前</th>
                            <th className="p-3 w-20">時間</th>
                            <th className="p-3">備考</th>
                            <th className="p-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {activeProject.records.map((r) => (
                            <tr key={r.id} className="border-b hover:bg-slate-50">
                                <td className="p-2">
                                    <input
                                        type="date"
                                        value={r.date}
                                        className="border rounded p-1 w-full text-xs"
                                        onChange={(e) => updateRecordField(r.id, 'date', e.target.value)}
                                    />
                                </td>
                                <td className="p-2">
                                    <select
                                        value={r.taskId}
                                        className="border rounded p-1 w-full font-bold text-xs"
                                        onChange={(e) => updateRecordField(r.id, 'taskId', Number(e.target.value))}
                                    >
                                        {activeProject.masterData.map(m => <option key={m.id} value={m.id}>{m.task}</option>)}
                                    </select>
                                </td>
                                <td className="p-2 relative">
                                    <input
                                        type="text"
                                        value={r.worker || ""}
                                        placeholder="氏名を入力・選択"
                                        className="border rounded p-1 w-full text-xs outline-none focus:border-blue-400 focus:bg-blue-50 transition"
                                        onFocus={(e) => {
                                            e.target.select();
                                            setFocusedWorkerRow(r.id);
                                        }}
                                        onBlur={() => setTimeout(() => setFocusedWorkerRow(null), 200)}
                                        onChange={(e) => updateRecordField(r.id, 'worker', e.target.value)}
                                    />
                                    {focusedWorkerRow === r.id && workers.length > 0 && (
                                        <ul className="absolute z-[100] left-2 right-2 top-[calc(100%-4px)] mt-1 bg-white border border-slate-200 shadow-2xl max-h-48 overflow-y-auto rounded-md py-1">
                                            {workers.map(w => (
                                                <li
                                                    key={w.id}
                                                    className="px-3 py-2 text-xs hover:bg-blue-100 cursor-pointer text-slate-800 font-medium"
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        updateRecordField(r.id, 'worker', w.name);
                                                        setFocusedWorkerRow(null);
                                                    }}
                                                >
                                                    {w.name}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </td>
                                <td className="p-2">
                                    <input
                                        type="number"
                                        value={r.hours}
                                        className="border rounded p-1 w-full text-right font-bold text-xs"
                                        onChange={(e) => updateRecordField(r.id, 'hours', Number(e.target.value))}
                                    />
                                </td>
                                <td className="p-2">
                                    <input
                                        type="text"
                                        value={r.note || ""}
                                        placeholder="内容"
                                        className="border rounded p-1 w-full text-xs"
                                        onChange={(e) => updateRecordField(r.id, 'note', e.target.value)}
                                    />
                                </td>
                                <td className="p-2 text-center">
                                    <button onClick={() => removeRecord(r.id)} className="text-slate-300 hover:text-red-500">
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold flex items-center gap-2 text-orange-600"><Edit3 size={20} /> 協力業者実績入力</h2>
                <button onClick={addSubcontractorRecord} className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-orange-700 shadow-md">
                    <Plus size={16} /> 業者1件追加
                </button>
            </div>
            <div className="overflow-x-auto pb-32">
                <table className="w-full text-left text-sm">
                    <thead className="bg-orange-50 border-b border-orange-200 text-orange-800 font-bold">
                        <tr>
                            <th className="p-3 w-32">日付</th>
                            <th className="p-3">会社名</th>
                            <th className="p-3 w-24">人数(人)</th>
                            <th className="p-3">入力者(任意)</th>
                            <th className="p-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {(activeProject.subcontractors || []).map((r) => (
                            <tr key={r.id} className="border-b hover:bg-orange-50 transition">
                                <td className="p-2">
                                    <input
                                        type="date"
                                        value={r.date}
                                        className="border border-orange-200 rounded p-1 w-full text-xs"
                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'date', e.target.value)}
                                    />
                                </td>
                                <td className="p-2">
                                    <input
                                        type="text"
                                        value={r.company_name || ""}
                                        placeholder="会社名を入力"
                                        className="border border-orange-200 rounded p-1 w-full text-xs outline-none focus:border-orange-400"
                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'company_name', e.target.value)}
                                    />
                                </td>
                                <td className="p-2">
                                    <input
                                        type="number"
                                        min="0.1"
                                        step="0.1"
                                        value={r.worker_count}
                                        className="border border-orange-200 rounded p-1 w-full text-right font-bold text-xs"
                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'worker_count', Number(e.target.value))}
                                    />
                                </td>
                                <td className="p-2">
                                    <input
                                        type="text"
                                        value={r.worker_name || ""}
                                        placeholder="職長名など"
                                        className="border border-orange-200 rounded p-1 w-full text-xs outline-none focus:border-orange-400"
                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'worker_name', e.target.value)}
                                    />
                                </td>
                                <td className="p-2 text-center">
                                    <button onClick={() => removeSubcontractorRecord(r.id)} className="text-orange-300 hover:text-red-500 transition">
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {(!activeProject.subcontractors || activeProject.subcontractors.length === 0) && (
                            <tr>
                                <td colSpan="5" className="p-6 text-center text-slate-400 font-bold border-b border-dashed">
                                    協力業者の実績データはありません
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default InputTab;
