import React, { useState, useEffect } from 'react';
import { Settings, Save, CheckCircle2, Award, Activity, UserCheck, Building2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import { getDailyApiUsage } from '../../utils/aiOptimizeUtils';
import HolidayCalendar from '../HolidayCalendar';
import CustomerSettings from './CustomerSettings';
import StaffSettings from './StaffSettings';
import CertificationManager from './settings/CertificationManager';
import CompanyInfoSettings from './settings/CompanyInfoSettings';

const SystemSettingsTab = ({ 
    hourlyWage, 
    setHourlyWage, 
    isGeminiEnabled, 
    setIsGeminiEnabled, 
    isLoading, 
    setIsLoading, 
    workers = [], 
    fetchAllData 
}) => {
    const { showToast } = useToast();
    const [localWage, setLocalWage] = useState(hourlyWage);
    const [validDays, setValidDays] = useState(30);
    const [initialValidDays, setInitialValidDays] = useState(30);
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [apiUsage, setApiUsage] = useState(null);
    const [activeSubTab, setActiveSubTab] = useState('general'); // 'general', 'calendar', 'certs', 'customers', 'company'

    useEffect(() => {
        setApiUsage(getDailyApiUsage());
    }, []);

    useEffect(() => {
        const fetchValidDays = async () => {
            const { data, error } = await supabase
                .from('system_settings')
                .select('est_default_valid_days')
                .eq('id', 1)
                .single();
            if (!error && data) {
                setValidDays(data.est_default_valid_days ?? 30);
                setInitialValidDays(data.est_default_valid_days ?? 30);
            }
        };
        fetchValidDays();
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('system_settings')
                .update({
                    hourly_wage: localWage,
                    est_default_valid_days: validDays,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', 1);

            if (error) throw error;

            setHourlyWage(localWage);
            setInitialValidDays(validDays);
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        } catch (error) {
            console.error('設定の保存に失敗しました:', error);
            showToast('設定の保存に失敗しました: ' + error.message, 'error');
        } finally {
            setIsSaving(false);
            setIsLoading(false);
        }
    };

    return (
        <div className={`p-6 bg-slate-50 min-h-[600px] ${isLoading && !isSaving ? 'opacity-50 pointer-events-none' : ''}`}>
            {/* サブタブナビゲーション */}
            <div className="flex items-center gap-2 mb-8 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm w-fit">
                <button
                    onClick={() => setActiveSubTab('general')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeSubTab === 'general' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                >
                    <Settings size={18} /> 基本設定
                </button>
                <button
                    onClick={() => setActiveSubTab('calendar')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeSubTab === 'calendar' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                >
                    <Activity size={18} /> 休日設定
                </button>
                <button
                    onClick={() => setActiveSubTab('certs')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeSubTab === 'certs' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                >
                    <Award size={18} /> 資格管理
                </button>
                <button
                    onClick={() => setActiveSubTab('customers')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeSubTab === 'customers' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                >
                    <UserCheck size={18} /> 顧客情報
                </button>
                <button
                    onClick={() => setActiveSubTab('staff')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeSubTab === 'staff' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                >
                    <UserCheck size={18} /> 担当者
                </button>
                <button
                    onClick={() => setActiveSubTab('company')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeSubTab === 'company' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                >
                    <Building2 size={18} /> 自社情報
                </button>
            </div>

            {activeSubTab === 'general' && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <Settings className="text-slate-600" /> システム共通設定
                        </h2>
                    </div>

                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-4xl">
                        <div className="mb-8">
                            <label className="block text-sm font-bold text-slate-700 mb-2">
                                1人あたりの人工費用 (円/時間)
                            </label>
                            <div className="flex items-center gap-3">
                                <div className="relative flex-1 max-w-xs">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={localWage}
                                        onChange={(e) => setLocalWage(Number(e.target.value))}
                                        className="w-full pl-8 pr-4 py-3 rounded-lg border-2 border-slate-200 font-bold text-xl outline-none focus:border-blue-500 transition"
                                    />
                                </div>
                                <span className="text-slate-500 text-sm font-bold">円 / 1時間</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-2 italic px-1">
                                現在入力中の値: 1日(8時間)あたり <strong className="text-blue-600 text-sm font-black">¥{(localWage * 8).toLocaleString()}</strong> 相当
                            </p>
                        </div>

                        <div className="mb-8 pt-8 border-t border-slate-100">
                            <label className="block text-sm font-bold text-slate-700 mb-2">
                                見積書の有効期限（発行日からの日数）
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="number"
                                    min="0"
                                    value={validDays}
                                    onChange={(e) => setValidDays(Number(e.target.value))}
                                    className="w-32 px-4 py-3 rounded-lg border-2 border-slate-200 font-bold text-xl outline-none focus:border-blue-500 transition"
                                />
                                <span className="text-slate-500 text-sm font-bold">日間</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-2 italic px-1">
                                新規見積作成時、見積日から自動でこの日数後を有効期限に設定します。
                            </p>
                        </div>

                        <div className="mb-8 pt-8 border-t border-slate-100">
                            <label className="block text-sm font-bold text-slate-700 mb-4 text-slate-800">
                                Gemini AI 機能
                            </label>
                            <div className="flex flex-col gap-6">
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        {isGeminiEnabled ? (
                                            <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-50 text-green-700 font-black text-xs border border-green-200 shadow-sm">
                                                <CheckCircle2 size={16} /> Gemini AI 有効
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-400 font-bold text-xs border border-slate-200">
                                                Gemini AI 未設定
                                            </span>
                                        )}
                                        <p className="text-xs text-slate-500 leading-relaxed">
                                            APIキーはサーバー側 (Edge Functions) の環境変数にて保護されています。<br/>
                                            Excel読み込み時の項目名最適化が利用可能です。
                                        </p>
                                    </div>
                                    <a 
                                        href="https://aistudio.google.com/app/apikey" 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-[10px] text-blue-600 font-bold hover:underline flex items-center gap-1"
                                    >
                                        キーの取得はこちら
                                    </a>
                                </div>

                                {apiUsage && (
                                    <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-4 shadow-sm">
                                        <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                                            <Activity size={18} className="text-blue-500" />
                                            本日のAPI利用状況 (無料枠内)
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="flex flex-col">
                                                <div className="flex justify-between items-end mb-2">
                                                    <span className="text-xs font-bold text-slate-500">リクエスト回数</span>
                                                    <div className="flex items-end gap-1">
                                                        <span className={`text-2xl font-black ${apiUsage.requestCount >= apiUsage.limitRequests * 0.8 ? 'text-red-500' : 'text-slate-800'}`}>
                                                            {apiUsage.requestCount.toLocaleString()}
                                                        </span>
                                                        <span className="text-xs text-slate-400 mb-1">/ {apiUsage.limitRequests.toLocaleString()} 回</span>
                                                    </div>
                                                </div>
                                                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                                                    <div className={`h-full transition-all duration-1000 ${apiUsage.requestCount >= apiUsage.limitRequests * 0.8 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, (apiUsage.requestCount / apiUsage.limitRequests) * 100)}%` }} />
                                                </div>
                                            </div>
                                            <div className="flex flex-col">
                                                <div className="flex justify-between items-end mb-2">
                                                    <span className="text-xs font-bold text-slate-500">消費トークン数</span>
                                                    <div className="flex items-end gap-1">
                                                        <span className={`text-2xl font-black ${apiUsage.totalTokens >= apiUsage.limitTokens * 0.8 ? 'text-red-500' : 'text-slate-800'}`}>
                                                            {apiUsage.totalTokens.toLocaleString()}
                                                        </span>
                                                        <span className="text-xs text-slate-400 mb-1">/ {(apiUsage.limitTokens / 10000).toLocaleString()}万</span>
                                                    </div>
                                                </div>
                                                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                                                    <div className={`h-full transition-all duration-1000 ${apiUsage.totalTokens >= apiUsage.limitTokens * 0.8 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, (apiUsage.totalTokens / apiUsage.limitTokens) * 100)}%` }} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-4 pt-6 border-t border-slate-100">
                            <button
                                onClick={handleSave}
                                disabled={isSaving || (localWage === hourlyWage && validDays === initialValidDays)}
                                className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={18} />
                                {isSaving ? '保存中...' : '設定を反映する'}
                            </button>

                            {showSuccess && (
                                <span className="text-green-600 font-bold text-sm flex items-center gap-1 animate-bounce">
                                    <CheckCircle2 size={18} /> 保存完了
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {activeSubTab === 'calendar' && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <HolidayCalendar />
                </div>
            )}

            {activeSubTab === 'certs' && (
                <CertificationManager
                    workers={workers}
                    isLoading={isLoading}
                    setIsLoading={setIsLoading}
                    fetchAllData={fetchAllData}
                />
            )}

            {activeSubTab === 'customers' && (
                <CustomerSettings />
            )}

            {activeSubTab === 'staff' && (
                <StaffSettings />
            )}

            {activeSubTab === 'company' && (
                <CompanyInfoSettings
                    isLoading={isLoading}
                    setIsLoading={setIsLoading}
                />
            )}
        </div>
    );
};

export default React.memo(SystemSettingsTab);
