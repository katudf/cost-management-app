import React, { useState } from 'react';
import { Settings, Save, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const SystemSettingsTab = ({ hourlyWage, setHourlyWage, isLoading, setIsLoading }) => {
    const [localWage, setLocalWage] = useState(hourlyWage);
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('system_settings')
                .update({ hourly_wage: localWage, updated_at: new Date().toISOString() })
                .eq('id', 1);

            if (error) throw error;

            setHourlyWage(localWage);
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        } catch (error) {
            console.error('設定の保存に失敗しました:', error);
            alert('設定の保存に失敗しました: ' + error.message);
        } finally {
            setIsSaving(false);
            setIsLoading(false);
        }
    };

    return (
        <div className={`p-6 bg-slate-50 min-h-[500px] ${isLoading && !isSaving ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Settings className="text-slate-600" /> システム共通設定
                </h2>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-2xl">
                <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                        1人あたりの人工費用 (円/時間)
                    </label>
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 max-w-xs">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                            <input
                                type="number"
                                value={localWage}
                                onChange={(e) => setLocalWage(Number(e.target.value))}
                                className="w-full pl-8 pl-8 pr-4 py-3 rounded-lg border-2 border-slate-200 font-bold text-lg outline-none focus:border-blue-500 transition"
                            />
                        </div>
                        <span className="text-slate-500 text-sm font-bold">円 / 1時間</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                        現在入力中の値: 1日(8時間)あたり <strong>¥{(localWage * 8).toLocaleString()}</strong> 相当
                    </p>
                </div>

                <div className="flex items-center gap-4 pt-4 border-t border-slate-100">
                    <button
                        onClick={handleSave}
                        disabled={isSaving || localWage === hourlyWage}
                        className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save size={18} />
                        {isSaving ? '保存中...' : '設定を保存する'}
                    </button>

                    {showSuccess && (
                        <span className="text-green-600 font-bold text-sm flex items-center gap-1 animate-fade-in">
                            <CheckCircle2 size={16} /> 保存しました
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SystemSettingsTab;
