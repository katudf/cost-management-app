import React, { useState, useMemo } from 'react';
import { Edit3, Plus, Trash2, Filter, Grid, List as ListIcon, ChevronLeft, ChevronRight } from 'lucide-react';

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
    const [companyHolidays, setCompanyHolidays] = useState([]);

    // 休日データの取得
    useEffect(() => {
        const fetchHolidays = async () => {
            const { data } = await supabase.from('CompanyHolidays').select('date, description');
            if (data) setCompanyHolidays(data);
        };
        fetchHolidays();
    }, []);

    // --- マトリックス表示用の計算 ---
    const matrixData = useMemo(() => {
        const [year, month] = currentMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const dates = Array.from({ length: daysInMonth }, (_, i) => {
            const d = new Date(year, month - 1, i + 1);
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
            const dow = d.getDay();
            
            // 休日判定 (配置表と同様)
            const registeredHoliday = companyHolidays.find(h => h.date === dateStr);
            const isActualHoliday = registeredHoliday && registeredHoliday.description !== '会議' && registeredHoliday.description !== '社員旅行';
            
            return {
                day: i + 1,
                dateStr,
                dow,
                isSunday: dow === 0,
                isSaturday: dow === 6,
                isHoliday: isActualHoliday,
                dayOfWeek: ['日', '月', '火', '水', '木', '金', '土'][dow]
            };
        });

        const masterWorkerNames = workers.filter(w => !w.resignation_date).map(w => w.name);
        const projectWorkerNames = [...new Set(activeProject.records.map(r => r.worker))].filter(Boolean);
        const displayWorkerNames = [
            ...masterWorkerNames,
            ...projectWorkerNames.filter(name => !masterWorkerNames.includes(name)).sort()
        ];

        const recordMap = {};
        activeProject.records.forEach(r => {
            if (!r.worker) return;
            if (!recordMap[r.worker]) recordMap[r.worker] = {};
            if (!recordMap[r.worker][r.date]) recordMap[r.worker][r.date] = [];
            recordMap[r.worker][r.date].push(r);
        });

        return { dates, displayWorkerNames, recordMap };
    }, [activeProject.records, workers, currentMonth, companyHolidays]);

    // 前日のデータをコピーする
    const copyFromPreviousDay = (targetDateStr) => {
        const targetDate = new Date(targetDateStr);
        const prevDate = new Date(targetDate);
        prevDate.setDate(targetDate.getDate() - 1);
        const prevDateStr = prevDate.toISOString().split('T')[0];

        const prevRecords = activeProject.records.filter(r => r.date === prevDateStr);
        if (prevRecords.length === 0) {
            alert('前日に実績データが見つかりません。');
            return;
        }

        if (confirm(`${prevDateStr} の実績データ ${prevRecords.length}件 を ${targetDateStr} にコピーしますか？`)) {
            // 一括追加
            prevRecords.forEach(r => {
                addRecord({ 
                    initialValues: { 
                        date: targetDateStr, 
                        worker: r.worker, 
                        hours: r.hours, 
                        taskId: r.taskId,
                        note: `(コピー) ${r.note || ''}`
                    } 
                });
            });
        }
    };

    const filteredRecords = useMemo(() => {
        return activeProject.records.filter(r => {
            const matchDate = filterDate ? r.date === filterDate : true;
            const matchWorker = filterWorker ? (r.worker || '').includes(filterWorker) : true;
            return matchDate && matchWorker;
        });
    }, [activeProject.records, filterDate, filterWorker]);

    // 月移動
    const shiftMonth = (dir) => {
        const [y, m] = currentMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + dir, 1);
        setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    };

    return (
        <div className={`p-6 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-lg font-bold flex items-center gap-2 text-blue-600"><Edit3 size={20} /> 日報実績入力</h2>
                    <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                        <button 
                            onClick={() => setViewMode('matrix')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'matrix' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Grid size={14} /> マトリックス
                        </button>
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <ListIcon size={14} /> 全リスト
                        </button>
                    </div>
                </div>
                
                {viewMode === 'list' ? (
                    <button onClick={addRecord} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-blue-700 shadow-md">
                        <Plus size={16} /> 日報1件追加
                    </button>
                ) : (
                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
                        <button onClick={() => shiftMonth(-1)} className="p-1.5 hover:bg-slate-50 rounded text-slate-500"><ChevronLeft size={18} /></button>
                        <span className="text-sm font-black px-2 text-slate-700">{currentMonth.replace('-', '年')}月</span>
                        <button onClick={() => shiftMonth(1)} className="p-1.5 hover:bg-slate-50 rounded text-slate-500"><ChevronRight size={18} /></button>
                        <button onClick={() => {
                             const d = new Date();
                             setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                        }} className="text-[10px] font-bold text-blue-600 px-2 border-l border-slate-100 ml-1">今月</button>
                    </div>
                )}
            </div>
            
            {viewMode === 'list' ? (
                <>
                    <div className="flex flex-col md:flex-row gap-4 mb-4 bg-slate-100 p-3 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2 font-bold text-slate-600">
                            <Filter size={16} /> 絞り込み:
                        </div>
                        <input 
                            type="date" 
                            value={filterDate}
                            onChange={(e) => setFilterDate(e.target.value)}
                            className="border rounded p-2 text-sm w-full md:w-auto"
                        />
                        <input 
                            type="text" 
                            placeholder="氏名で絞り込み..."
                            value={filterWorker}
                            onChange={(e) => setFilterWorker(e.target.value)}
                            className="border rounded p-2 text-sm w-full md:w-auto"
                        />
                        {(filterDate || filterWorker) && (
                            <button 
                                onClick={() => { setFilterDate(''); setFilterWorker(''); }}
                                className="text-sm text-slate-500 underline hover:text-slate-700"
                            >
                                クリア
                            </button>
                        )}
                    </div>

                    <div className="overflow-x-auto mb-8 bg-white border border-slate-200 rounded-xl shadow-sm">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-50 border-b text-slate-500 font-bold">
                                <tr>
                                    <th className="p-3 w-32 text-[11px] uppercase tracking-wider">日付</th>
                                    <th className="p-3 text-[11px] uppercase tracking-wider">作業項目</th>
                                    <th className="p-3 w-40 text-[11px] uppercase tracking-wider">名前</th>
                                    <th className="p-3 w-24 text-[11px] uppercase tracking-wider">実働時間(h)</th>
                                    <th className="p-3 text-[11px] uppercase tracking-wider">備考</th>
                                    <th className="p-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRecords.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="p-20 text-center text-slate-400 font-bold">
                                            表示する日報実績がありません
                                        </td>
                                    </tr>
                                ) : filteredRecords.map((r) => (
                                    <tr key={r.id} className="border-b last:border-0 hover:bg-blue-50/30 transition">
                                        <td className="p-2">
                                            <input
                                                type="date"
                                                value={r.date}
                                                className="border-slate-200 border rounded p-1 w-full text-xs font-bold focus:border-blue-400 outline-none"
                                                onChange={(e) => updateRecordField(r.id, 'date', e.target.value)}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <select
                                                value={r.taskId}
                                                className="border-slate-200 border rounded p-1 w-full font-bold text-xs focus:border-blue-400 outline-none"
                                                onChange={(e) => updateRecordField(r.id, 'taskId', Number(e.target.value))}
                                            >
                                                {activeProject.masterData.map(m => <option key={m.id} value={m.id}>{m.task}</option>)}
                                            </select>
                                        </td>
                                        <td className="p-2 relative">
                                            <input
                                                type="text"
                                                value={r.worker || ""}
                                                placeholder="名前"
                                                className="border-slate-200 border rounded p-1 w-full text-xs font-bold outline-none focus:border-blue-400 focus:bg-blue-50 transition"
                                                onFocus={(e) => {
                                                    e.target.select();
                                                    setFocusedWorkerRow(r.id);
                                                }}
                                                onBlur={() => setTimeout(() => setFocusedWorkerRow(null), 200)}
                                                onChange={(e) => updateRecordField(r.id, 'worker', e.target.value)}
                                            />
                                            {focusedWorkerRow === r.id && workers.length > 0 && (
                                                <ul className="absolute z-[100] left-2 right-2 top-[calc(100%-4px)] mt-1 bg-white border border-slate-200 shadow-2xl max-h-48 overflow-y-auto rounded-md py-1">
                                                    {workers.filter(w => !w.resignation_date).map(w => (
                                                        <li
                                                            key={w.id}
                                                            className="px-3 py-2 text-xs hover:bg-blue-100 cursor-pointer text-slate-800 font-bold"
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
                                                step="0.1"
                                                value={r.hours}
                                                className="border-slate-200 border rounded p-1 w-full text-right font-black text-xs text-blue-600 focus:border-blue-400 outline-none"
                                                onChange={(e) => updateRecordField(r.id, 'hours', Number(e.target.value))}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="text"
                                                value={r.note || ""}
                                                placeholder="内容"
                                                className="border-slate-200 border rounded p-1 w-full text-xs outline-none focus:border-blue-400"
                                                onChange={(e) => updateRecordField(r.id, 'note', e.target.value)}
                                            />
                                        </td>
                                        <td className="p-2 text-center">
                                            <button onClick={() => removeRecord(r.id)} className="text-slate-300 hover:text-red-500 transition">
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col mb-8">
                    <div className="overflow-auto max-h-[600px]">
                        <table className="w-full text-left text-xs border-collapse table-fixed min-w-[1200px]">
                            <thead className="sticky top-0 z-20">
                                <tr className="bg-slate-50 border-b border-slate-200 shadow-sm">
                                    <th className="p-3 w-32 min-w-[120px] sticky left-0 z-30 bg-slate-50 font-bold text-slate-500 border-r border-slate-200">作業員名</th>
                                    {matrixData.dates.map(d => {
                                        const isRed = d.isSunday || d.isHoliday;
                                        const isBlue = d.isSaturday && !d.isHoliday;
                                        
                                        return (
                                            <th key={d.day} className={`w-[48px] p-1.5 text-center border-r border-slate-100 font-bold group/th ${isRed ? 'bg-red-50 text-red-600' : isBlue ? 'bg-blue-50 text-blue-600' : 'text-slate-600'}`}>
                                                <div className="text-[9px] mb-0.5">{d.dayOfWeek}</div>
                                                <div className="text-[12px]">{d.day}</div>
                                                <button 
                                                    onClick={() => copyFromPreviousDay(d.dateStr)}
                                                    className="absolute bottom-1 right-1 opacity-0 group-hover/th:opacity-100 text-blue-500 hover:text-blue-700 transition"
                                                    title="前日のメンバーをコピー"
                                                >
                                                    <Plus size={10} className="border border-blue-200 rounded-full bg-white" />
                                                </button>
                                            </th>
                                        );
                                    })}
                                    <th className="p-3 w-20 text-center font-bold text-blue-600 bg-blue-50 border-l border-blue-100">合計</th>
                                </tr>
                            </thead>
                            <tbody>
                                {matrixData.displayWorkerNames.map(workerName => {
                                    let rowTotal = 0;
                                    return (
                                        <tr key={workerName} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                            <td className="p-3 font-bold text-sm text-slate-700 sticky left-0 z-10 bg-white border-r border-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.02)] truncate">
                                                {workerName}
                                            </td>
                                            {matrixData.dates.map(d => {
                                                const dayRecords = matrixData.recordMap[workerName]?.[d.dateStr] || [];
                                                const totalHours = dayRecords.reduce((s, r) => s + Number(r.hours || 0), 0);
                                                rowTotal += totalHours;
                                                
                                                const jumpToList = () => {
                                                    setFilterDate(d.dateStr);
                                                    setFilterWorker(workerName);
                                                    setViewMode('list');
                                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                                };

                                                const isOvertime = totalHours > 12;

                                                return (
                                                    <td key={d.day} className={`w-[48px] p-0 border-r border-slate-100 group relative ${d.isWeekend ? 'bg-slate-50/30' : ''}`}>
                                                        {dayRecords.length > 0 ? (
                                                            dayRecords.length === 1 ? (
                                                                <div className={`flex items-center w-full h-10 ${isOvertime ? 'bg-red-50' : ''}`}>
                                                                    <input 
                                                                        type="text"
                                                                        inputMode="decimal"
                                                                        value={dayRecords[0].hours}
                                                                        onChange={(e) => {
                                                                            const val = e.target.value.replace(/[^0-9.]/g, '');
                                                                            updateRecordField(dayRecords[0].id, 'hours', val === '' ? 0 : Number(val));
                                                                        }}
                                                                        className={`flex-1 min-w-0 h-full text-center bg-transparent font-bold text-[13px] outline-none focus:ring-1 focus:ring-blue-400 border-none px-0 ${isOvertime ? 'text-red-700' : 'text-blue-700'}`}
                                                                    />
                                                                    <button 
                                                                        onClick={jumpToList}
                                                                        className="w-3.5 h-full flex-shrink-0 opacity-0 group-hover:opacity-100 bg-black/5 hover:bg-black/10 transition-opacity flex items-center justify-center text-slate-400"
                                                                        title="リストで詳細を見る"
                                                                    >
                                                                        <ListIcon size={10} />
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div 
                                                                    onClick={jumpToList}
                                                                    className={`w-full h-10 flex flex-col justify-center items-center cursor-pointer transition-colors ${isOvertime ? 'bg-red-100 text-red-800' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'}`} 
                                                                    title={`複数レコードあり（合計 ${totalHours}h）`}
                                                                >
                                                                    <div className="text-[11px] font-black leading-none">{totalHours} <span className="text-[8px]">h</span></div>
                                                                    <div className="text-[10px] mt-0.5 opacity-60">x{dayRecords.length}</div>
                                                                </div>
                                                            )
                                                        ) : (
                                                            <button 
                                                                onClick={() => {
                                                                    addRecord({ initialValues: { date: d.dateStr, worker: workerName, hours: 8 } });
                                                                }}
                                                                className="w-full h-10 opacity-0 group-hover:opacity-100 flex items-center justify-center text-blue-300 hover:text-blue-600 hover:bg-blue-50 outline-none transition-all"
                                                            >
                                                                <Plus size={14} />
                                                            </button>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className={`p-2 text-center font-black italic bg-blue-50 border-l border-blue-100 ${rowTotal > 0 ? 'text-blue-700' : 'text-slate-300'}`}>
                                                {rowTotal > 0 ? rowTotal.toFixed(1) : '-'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-3 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500 flex items-center gap-4">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-50 border border-blue-200"></span> 入力済み</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-orange-50 border border-orange-200"></span> 複数タスクあり（クリックで詳細不可、直接編集不可）</span>
                        <span className="ml-auto">※セル内を直接クリックして数字を編集できます。レコードがない場合はホバーで＋ボタンが出ます。</span>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold flex items-center gap-2 text-orange-600"><Edit3 size={20} /> 協力業者実績入力</h2>
                <button onClick={addSubcontractorRecord} className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-orange-700 shadow-md">
                    <Plus size={16} /> 業者1件追加
                </button>
            </div>
            <div className="overflow-x-auto pb-32 bg-white border border-slate-200 rounded-xl shadow-sm">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-orange-50 border-b border-orange-200 text-orange-800 font-bold">
                        <tr>
                            <th className="p-3 w-32 text-[11px] uppercase tracking-wider">日付</th>
                            <th className="p-3 text-[11px] uppercase tracking-wider">会社名</th>
                            <th className="p-3 w-24 text-[11px] uppercase tracking-wider">人数(人)</th>
                            <th className="p-3 text-[11px] uppercase tracking-wider">入力者(任意)</th>
                            <th className="p-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {(activeProject.subcontractors || []).map((r) => (
                            <tr key={r.id} className="border-b last:border-0 hover:bg-orange-50/30 transition">
                                <td className="p-2">
                                    <input
                                        type="date"
                                        value={r.date}
                                        className="border border-orange-200 rounded p-1 w-full text-xs font-bold outline-none focus:border-orange-400"
                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'date', e.target.value)}
                                    />
                                </td>
                                <td className="p-2">
                                    <input
                                        type="text"
                                        value={r.company_name || ""}
                                        placeholder="会社名を入力"
                                        className="border border-orange-200 rounded p-1 w-full text-xs font-bold outline-none focus:border-orange-400"
                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'company_name', e.target.value)}
                                    />
                                </td>
                                <td className="p-2">
                                    <input
                                        type="number"
                                        min="0.1"
                                        step="0.1"
                                        value={r.worker_count}
                                        className="border border-orange-200 rounded p-1 w-full text-right font-black text-xs text-orange-600 outline-none focus:border-orange-400"
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
                                <td colSpan="5" className="p-10 text-center text-slate-400 font-bold border-b border-dashed">
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

export default React.memo(InputTab);


