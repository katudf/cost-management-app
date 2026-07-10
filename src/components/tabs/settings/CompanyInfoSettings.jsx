import React, { useState, useEffect } from 'react';
import { Building2, Upload, X, Save, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../components/Toast';
import { getStampSignedUrl } from '../../../utils/stampStorage';

const CompanyInfoSettings = ({ isLoading, setIsLoading }) => {
    const { showToast } = useToast();
    
    // 自社情報ステート
    const [companyInfo, setCompanyInfo] = useState({
        company_name: '',
        company_zip: '',
        company_address: '',
        company_tel: '',
        company_fax: '',
        stamp_company_url: '',
        stamp_representative_url: '',
    });
    const [companyLoaded, setCompanyLoaded] = useState(false);
    const [companySaving, setCompanySaving] = useState(false);
    const [companySuccess, setCompanySuccess] = useState(false);
    // stamps バケットは private のため、プレビュー表示には署名付きURLを使う
    // （companyInfo にはバケット内パスを保持し、そのままDBへ保存する）
    const [stampPreviews, setStampPreviews] = useState({ company: '', representative: '' });

    useEffect(() => {
        let cancelled = false;
        const resolvePreviews = async () => {
            const [company, representative] = await Promise.all([
                getStampSignedUrl(companyInfo.stamp_company_url).catch(() => ''),
                getStampSignedUrl(companyInfo.stamp_representative_url).catch(() => ''),
            ]);
            if (!cancelled) {
                setStampPreviews({ company: company || '', representative: representative || '' });
            }
        };
        resolvePreviews();
        return () => { cancelled = true; };
    }, [companyInfo.stamp_company_url, companyInfo.stamp_representative_url]);

    // 自社情報取得
    useEffect(() => {
        const fetchCompanyInfo = async () => {
            try {
                const { data } = await supabase
                    .from('system_settings')
                    .select('company_name, company_zip, company_address, company_tel, company_fax, stamp_company_url, stamp_representative_url')
                    .eq('id', 1)
                    .single();
                if (data) {
                    setCompanyInfo({
                        company_name: data.company_name || '',
                        company_zip: data.company_zip || '',
                        company_address: data.company_address || '',
                        company_tel: data.company_tel || '',
                        company_fax: data.company_fax || '',
                        stamp_company_url: data.stamp_company_url || '',
                        stamp_representative_url: data.stamp_representative_url || '',
                    });
                }
            } catch (e) {
                console.error('自社情報取得エラー:', e);
            } finally {
                setCompanyLoaded(true);
            }
        };
        fetchCompanyInfo();
    }, []);

    // 自社情報保存
    const handleSaveCompany = async () => {
        setCompanySaving(true);
        try {
            const { error } = await supabase
                .from('system_settings')
                .update({
                    ...companyInfo,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', 1);
            if (error) throw error;
            setCompanySuccess(true);
            setTimeout(() => setCompanySuccess(false), 3000);
            showToast('自社情報を保存しました', 'success');
        } catch (e) {
            console.error('自社情報保存エラー:', e);
            showToast('保存に失敗しました: ' + e.message, 'error');
        } finally {
            setCompanySaving(false);
        }
    };

    // 画像アップロード処理
    const handleFileUpload = async (e, type) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsLoading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${type}_${Date.now()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('stamps')
                .upload(fileName, file, { upsert: true });

            if (uploadError) throw uploadError;

            // stamps バケットは private のため公開URLは使えない。
            // バケット内パスを保存し、表示・PDF生成時に署名付きURLへ変換する
            setCompanyInfo(prev => ({
                ...prev,
                [type === 'company' ? 'stamp_company_url' : 'stamp_representative_url']: fileName
            }));
            showToast(`画像をアップロードしました。「自社情報を保存」ボタンを押して確定してください。`, 'success');
        } catch (error) {
            console.error('アップロードエラー:', error);
            showToast('画像のアップロードに失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-3xl">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Building2 className="text-blue-500" />
                        自社情報設定
                    </h3>
                    <p className="text-xs text-slate-400">見積書PDF表紙に反映されます</p>
                </div>

                {!companyLoaded ? (
                    <div className="text-center text-slate-400 py-8">読み込み中...</div>
                ) : (
                    <>
                        <div className="space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">会社名 <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={companyInfo.company_name}
                                    onChange={e => setCompanyInfo({ ...companyInfo, company_name: e.target.value })}
                                    className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="例: 株式会社○○建設"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">郵便番号</label>
                                    <input
                                        type="text"
                                        value={companyInfo.company_zip}
                                        onChange={e => setCompanyInfo({ ...companyInfo, company_zip: e.target.value })}
                                        className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500 transition"
                                        placeholder="例: 123-4567"
                                    />
                                </div>
                                <div className="md:col-span-1">
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">住所</label>
                                <input
                                    type="text"
                                    value={companyInfo.company_address}
                                    onChange={e => setCompanyInfo({ ...companyInfo, company_address: e.target.value })}
                                    className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="例: 東京都○○区○○町1-2-3"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">電話番号</label>
                                    <input
                                        type="text"
                                        value={companyInfo.company_tel}
                                        onChange={e => setCompanyInfo({ ...companyInfo, company_tel: e.target.value })}
                                        className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500 transition"
                                        placeholder="例: 03-1234-5678"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">FAX番号</label>
                                    <input
                                        type="text"
                                        value={companyInfo.company_fax}
                                        onChange={e => setCompanyInfo({ ...companyInfo, company_fax: e.target.value })}
                                        className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500 transition"
                                        placeholder="例: 03-1234-5679"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6 border-t border-slate-100 pt-6">
                                {/* 社印 */}
                                <div className="flex flex-col gap-2">
                                    <label className="block text-sm font-bold text-slate-700">社印（角印など）</label>
                                    <p className="text-xs text-slate-400">背景透過のPNG形式を推奨。見積書の社名部分に重なって表示されます。</p>
                                    
                                    <div className="mt-2 border-2 border-dashed border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center bg-slate-50 relative group min-h-[140px]">
                                        {companyInfo.stamp_company_url ? (
                                            <div className="relative w-20 h-20">
                                                {stampPreviews.company && (
                                                    <img src={stampPreviews.company} alt="社印" className="w-full h-full object-contain mix-blend-multiply" />
                                                )}
                                                <button 
                                                    onClick={() => setCompanyInfo({ ...companyInfo, stamp_company_url: '' })}
                                                    className="absolute -top-2 -right-2 bg-white rounded-full p-1 text-red-500 shadow-sm border border-red-100 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="text-center">
                                                <Upload size={24} className="mx-auto text-slate-400 mb-2" />
                                                <span className="text-xs text-slate-500 font-bold">クリックしてアップロード</span>
                                            </div>
                                        )}
                                        <input 
                                            type="file" 
                                            accept="image/png,image/jpeg"
                                            onChange={(e) => handleFileUpload(e, 'company')}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                    </div>
                                </div>

                                {/* 代表印 */}
                                <div className="flex flex-col gap-2">
                                    <label className="block text-sm font-bold text-slate-700">担当者印・代表印（丸印など）</label>
                                    <p className="text-xs text-slate-400">背景透過のPNG形式を推奨。見積書上部の「検印枠」に表示されます。</p>
                                    
                                    <div className="mt-2 border-2 border-dashed border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center bg-slate-50 relative group min-h-[140px]">
                                        {companyInfo.stamp_representative_url ? (
                                            <div className="relative w-16 h-16">
                                                {stampPreviews.representative && (
                                                    <img src={stampPreviews.representative} alt="代表印" className="w-full h-full object-contain mix-blend-multiply" />
                                                )}
                                                <button 
                                                    onClick={() => setCompanyInfo({ ...companyInfo, stamp_representative_url: '' })}
                                                    className="absolute -top-2 -right-2 bg-white rounded-full p-1 text-red-500 shadow-sm border border-red-100 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="text-center">
                                                <Upload size={24} className="mx-auto text-slate-400 mb-2" />
                                                <span className="text-xs text-slate-500 font-bold">クリックしてアップロード</span>
                                            </div>
                                        )}
                                        <input 
                                            type="file" 
                                            accept="image/png,image/jpeg"
                                            onChange={(e) => handleFileUpload(e, 'representative')}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 pt-6 mt-6 border-t border-slate-100">
                            <button
                                onClick={handleSaveCompany}
                                disabled={companySaving || !companyInfo.company_name.trim()}
                                className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={18} />
                                {companySaving ? '保存中...' : '自社情報を保存'}
                            </button>
                            {companySuccess && (
                                <span className="text-green-600 font-bold text-sm flex items-center gap-1 animate-bounce">
                                    <CheckCircle2 size={18} /> 保存完了
                                </span>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default React.memo(CompanyInfoSettings);
