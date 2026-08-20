import React, { useState, useEffect, useCallback } from 'react';
import { FlaskConical, Layers, Settings2, Loader2, Database } from 'lucide-react';
import { useToast } from '../../Toast';
import { fetchPaintMasters } from '../../../features/paint/supabasePaint';
import PaintProductsPanel from './PaintProductsPanel';
import CoatingSystemsPanel from './CoatingSystemsPanel';
import PaintMastersPanel from './PaintMastersPanel';

const SUB_TABS = [
    { key: 'products', label: '塗料製品', Icon: FlaskConical },
    { key: 'systems', label: '塗装仕様', Icon: Layers },
    { key: 'masters', label: 'マスタ管理', Icon: Settings2 },
];

const PaintDatabaseTab = () => {
    const { showToast } = useToast();
    const [activeSub, setActiveSub] = useState('products');
    const [masters, setMasters] = useState({ manufacturers: [], processRoles: [], axes: [], standards: [], abbreviations: [] });
    const [isLoading, setIsLoading] = useState(true);

    const loadMasters = useCallback(async () => {
        try {
            const data = await fetchPaintMasters();
            setMasters(data);
        } catch (error) {
            console.error('塗料マスタ取得エラー:', error);
            showToast('マスタデータの取得に失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        loadMasters();
    }, [loadMasters]);

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-4">
                <Database className="text-blue-500" />
                <h2 className="text-lg font-bold text-slate-800">塗料データベース</h2>
            </div>

            {/* サブタブ */}
            <div className="flex gap-1 mb-4 border-b border-slate-200 overflow-x-auto">
                {SUB_TABS.map(({ key, label, Icon }) => (
                    <button
                        key={key}
                        onClick={() => setActiveSub(key)}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-t-lg transition whitespace-nowrap border-b-2 -mb-px ${
                            activeSub === key
                                ? 'text-blue-600 border-blue-600 bg-blue-50/50'
                                : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
                        }`}
                    >
                        <Icon size={16} />
                        {label}
                    </button>
                ))}
            </div>

            {isLoading ? (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    読み込み中...
                </div>
            ) : (
                <>
                    {activeSub === 'products' && <PaintProductsPanel masters={masters} />}
                    {activeSub === 'systems' && <CoatingSystemsPanel masters={masters} />}
                    {activeSub === 'masters' && <PaintMastersPanel masters={masters} onMastersChanged={loadMasters} />}
                </>
            )}
        </div>
    );
};

export default PaintDatabaseTab;
