import React from 'react';
import { AlertCircle, Edit3, PlusCircle } from 'lucide-react';

const ImportModal = ({ info, isLoading, aliasName, setAliasName, onChoice, onCancel }) => {
    if (!info) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full">
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <AlertCircle className="text-blue-500" />
                    インポート方法の選択
                </h3>
                <p className="text-slate-600 mb-6">
                    Excelファイルから <span className="font-bold text-blue-600 text-lg">{info.count}件</span> の作業項目データを読み込みました。<br />
                    {info.type === 'duplicate' ? (
                        <span className="text-red-500 font-bold mt-2 inline-block">「{info.fileName}」は既に登録されています。</span>
                    ) : (
                        "既存のデータが存在するため、処理方法を選択してください。"
                    )}
                </p>

                <div className="flex flex-col gap-3">
                    {info.type === 'duplicate' ? (
                        <>
                            <button
                                onClick={() => onChoice('overwrite_duplicate')}
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
                                    onClick={() => onChoice('create_alias')}
                                    disabled={!aliasName.trim() || isLoading}
                                    className="w-full bg-blue-600 text-white font-bold py-2 mt-1 rounded hover:bg-blue-700 transition disabled:opacity-50"
                                >
                                    {isLoading ? '保存中...' : 'この名前で登録する'}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => onChoice('create_new')}
                                className="p-4 border-2 border-blue-500 rounded-lg hover:bg-blue-50 transition text-left group disabled:opacity-50"
                                disabled={isLoading}
                            >
                                <div className="font-bold text-blue-700 text-lg mb-1 group-hover:underline flex items-center gap-2">
                                    <PlusCircle size={20} /> 新規作成 (新しい現場として作成)
                                </div>
                                <div className="text-sm text-slate-500">
                                    新しい現場「{info.fileName}」を作成し、そこにデータをインポートします。現在の現場データは一切変更されません。
                                </div>
                            </button>

                            <button
                                onClick={() => onChoice('overwrite')}
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
