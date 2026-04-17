import React, { useState, useEffect } from 'react';
import { AlertCircle, Edit3, PlusCircle, Wand2 } from 'lucide-react';

const ImportModal = ({ info, isLoading, aliasName, setAliasName, onChoice, onCancel, onOptimize }) => {
    const [localData, setLocalData] = useState([]);

    useEffect(() => {
        if (info && info.data) {
            setLocalData(info.data);
        }
    }, [info]);

    if (!info) return null;

    const handleChoice = (choiceType) => {
        onChoice(choiceType, { ...info, data: localData });
    };

    const handleToggleExclude = (index) => {
        const newData = [...localData];
        newData[index].isExcluded = !newData[index].isExcluded;
        setLocalData(newData);
    };

    const handleTaskNameChange = (index, newName) => {
        const newData = [...localData];
        newData[index].task = newName;
        setLocalData(newData);
    };

    const isLg = info.aiOptimized;

    // Filter status to show in subhead
    const validCount = localData.filter(d => !d.isExcluded).length;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className={`bg-white rounded-xl shadow-2xl p-6 flex flex-col max-h-[95vh] w-full ${isLg ? 'max-w-4xl' : 'max-w-lg'}`}>
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2 shrink-0">
                    <AlertCircle className="text-blue-500" />
                    インポートの確認
                </h3>
                <p className="text-slate-600 mb-4 shrink-0">
                    Excelファイルから <span className="font-bold text-blue-600 text-lg">{info.count}件</span> の作業項目データを読み込みました。<br />
                    {info.type === 'duplicate' ? (
                        <span className="text-red-500 font-bold mt-2 inline-block">「{info.fileName}」は既に登録されています。</span>
                    ) : (
                        !info.isEmpty && "既存のデータが存在するため、処理方法を選択してください。"
                    )}
                </p>

                {info.aiOptimized ? (
                    <div className="mb-6 flex-1 min-h-[200px] overflow-auto border border-slate-200 rounded-lg bg-slate-50 relative">
                        <div className="sticky top-0 bg-blue-100 p-3 text-sm font-bold text-blue-800 flex items-center justify-between border-b border-blue-200 z-10 shadow-sm">
                            <div className="flex items-center gap-2">
                                <Wand2 size={16} className="text-blue-600" /> 
                                <span>AIによる項目名の最適化結果</span>
                            </div>
                            <span className="text-blue-600 bg-white px-2 py-0.5 rounded-full border border-blue-200 text-xs">
                                取込対象: {validCount}件 / 全{localData.length}件
                            </span>
                        </div>
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="bg-slate-100 border-b border-slate-200">
                                    <th className="p-3 font-bold w-1/3 text-slate-500">元の名称</th>
                                    <th className="p-3 font-bold text-slate-700">システム登録名称 (編集可)</th>
                                    <th className="p-3 font-bold w-20 text-center text-slate-700">取込</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {localData.map((row, i) => (
                                    <tr key={i} className={`hover:bg-blue-50/50 transition ${row.isExcluded ? 'opacity-60 bg-slate-100' : 'bg-white'}`}>
                                        <td className="p-3 text-xs text-slate-500 break-words" title={row.originalTask || row.task}>
                                            {row.originalTask || row.task}
                                        </td>
                                        <td className="p-3 bg-white">
                                            <input
                                                type="text"
                                                value={row.task}
                                                onChange={(e) => handleTaskNameChange(i, e.target.value)}
                                                disabled={row.isExcluded}
                                                className={`w-full p-2 border rounded font-bold outline-none focus:border-blue-500 transition ${row.isExcluded ? 'bg-slate-50 border-transparent text-slate-400' : 'bg-white border-blue-300 text-slate-800'}`}
                                            />
                                        </td>
                                        <td className="p-3 text-center bg-white">
                                            <input 
                                                type="checkbox" 
                                                checked={!row.isExcluded}
                                                onChange={() => handleToggleExclude(i)}
                                                className="w-5 h-5 accent-blue-600 cursor-pointer"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    info.canOptimize && (
                        <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-5 flex flex-col items-center justify-center gap-3">
                            <Wand2 className="text-blue-500" size={32} />
                            <div className="text-center">
                                <p className="text-sm font-bold text-slate-800">
                                    項目名をAIで自動整理しますか？
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                    長すぎる名前を短縮し、不要な間接経費などを自動で除外します。
                                </p>
                            </div>
                            <button
                                onClick={onOptimize}
                                disabled={isLoading}
                                className="mt-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50"
                            >
                                {isLoading ? '最適化中...' : 'AIを使用して項目を整理する'}
                            </button>
                        </div>
                    )
                )}

                <div className="flex flex-col gap-3 shrink-0">
                    {info.type === 'duplicate' ? (
                        <>
                            <button
                                onClick={() => handleChoice('overwrite_duplicate')}
                                className="p-4 border-2 border-red-300 rounded-lg hover:bg-red-50 transition text-left group disabled:opacity-50"
                                disabled={isLoading}
                            >
                                <div className="font-bold text-red-700 text-lg mb-1 group-hover:underline flex items-center gap-2">
                                    <Edit3 size={20} /> 既存の現場に上書き
                                </div>
                                <div className="text-sm text-slate-500">
                                    既に登録されている「{info.fileName}」を今回のデータで上書きします。
                                </div>
                            </button>
                            <div className="p-4 border-2 border-blue-500 rounded-lg bg-blue-50 text-left flex flex-col gap-2">
                                <div className="font-bold text-blue-700 text-lg flex items-center gap-2">
                                    <PlusCircle size={20} /> 別名で新規登録
                                </div>
                                <div className="text-sm text-slate-600 mb-1">
                                    重複を避けるため、別の名前で新しい現場として登録します。
                                </div>
                                <input
                                    type="text"
                                    value={aliasName}
                                    onChange={(e) => setAliasName(e.target.value)}
                                    className="w-full p-2 border border-blue-300 rounded font-bold"
                                />
                                <button
                                    onClick={() => handleChoice('create_alias')}
                                    disabled={!aliasName.trim() || isLoading}
                                    className="w-full bg-blue-600 text-white font-bold py-2 mt-1 rounded hover:bg-blue-700 transition disabled:opacity-50"
                                >
                                    {isLoading ? '保存中...' : 'この名前で登録する'}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            {(!info.isEmpty || info.aiOptimized) && (
                                <button
                                    onClick={() => handleChoice(info.isEmpty ? 'overwrite_empty' : 'create_new')}
                                    className="p-4 border-2 border-blue-500 rounded-lg hover:bg-blue-50 transition text-left group disabled:opacity-50"
                                    disabled={isLoading}
                                >
                                    <div className="font-bold text-blue-700 text-lg mb-1 group-hover:underline flex items-center gap-2">
                                        <PlusCircle size={20} /> {info.isEmpty ? 'この内容でインポート' : '新規作成 (新しい現場として作成)'}
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        {info.isEmpty ? 'AIの最適化結果を保存して現場にデータを追加します。' : `新しい現場「${info.fileName}」を作成し、そこにデータをインポートします。現在の現場データは一切変更されません。`}
                                    </div>
                                </button>
                            )}

                            {!info.isEmpty && (
                                <button
                                    onClick={() => handleChoice('overwrite')}
                                    className="p-4 border-2 border-slate-300 rounded-lg hover:bg-slate-50 transition text-left group disabled:opacity-50"
                                    disabled={isLoading}
                                >
                                    <div className="font-bold text-slate-700 text-lg mb-1 group-hover:underline flex items-center gap-2">
                                        <Edit3 size={20} /> 現在の現場を上書き
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        現在表示している現場の「工事設定（作業項目）」をこのExcelデータで置き換えます。
                                    </div>
                                </button>
                            )}
                        </>
                    )}

                    <button
                        onClick={onCancel}
                        disabled={isLoading}
                        className="mt-2 p-3 text-slate-500 font-bold hover:bg-slate-100 rounded-lg transition text-center disabled:opacity-50"
                    >
                        キャンセル
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImportModal;
