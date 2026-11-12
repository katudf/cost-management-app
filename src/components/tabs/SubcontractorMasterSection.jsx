import React, { useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { useToast } from '../Toast';

const inputClass = 'border border-slate-300 rounded p-1.5 text-sm outline-none focus:border-orange-400 bg-white';

/**
 * 下請け会社マスタ（docs/specs/subcontractors.md §5.2）。
 * 会社を登録すると、配置表・工程表に出す配置行（Workers）が自動で作られる。
 * 取引が終わった会社は削除せず「取引中」を外す（過去の契約・記録を残すため）。
 */
const SubcontractorMasterSection = ({ subcontractorOps }) => {
    const { showToast } = useToast();
    const { subcontractors, isSubcontractorsLoading, addSubcontractor, updateSubcontractor } = subcontractorOps;
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');

    const handleAdd = async () => {
        if (!name.trim()) {
            showToast('会社名を入力してください', 'error');
            return;
        }
        if (await addSubcontractor({ name, standardUnitPrice: price === '' ? 0 : price })) {
            setName('');
            setPrice('');
        }
    };

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mt-8">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
                <Building2 size={18} className="text-orange-500" /> 下請け会社
            </h3>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                登録した会社は、配置表・工程表に表示され、日報の協力業者入力で選べます。標準単価は、常用契約が自動で作られるときの単価になります。
            </p>

            <div className={`space-y-2 ${isSubcontractorsLoading ? 'opacity-50' : ''}`}>
                {subcontractors.map(s => (
                    <div key={s.id} className={`flex flex-wrap items-center gap-3 border rounded-lg p-2 ${s.active ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                        <input
                            key={`${s.id}-name-${s.name}`}
                            type="text"
                            defaultValue={s.name}
                            aria-label="会社名"
                            className={`${inputClass} w-56 font-bold`}
                            onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (!v) { e.target.value = s.name; return; }
                                if (v !== s.name) updateSubcontractor(s.id, { name: v });
                            }}
                        />
                        <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
                            標準単価
                            <input
                                key={`${s.id}-price-${s.standard_unit_price}`}
                                type="number"
                                min="0"
                                defaultValue={s.standard_unit_price}
                                aria-label="標準単価（円/人工）"
                                className={`${inputClass} w-28 text-right`}
                                onBlur={(e) => {
                                    const v = Number(e.target.value);
                                    if (e.target.value !== '' && v !== Number(s.standard_unit_price)) updateSubcontractor(s.id, { standard_unit_price: v });
                                }}
                            />
                            円/人工
                        </label>
                        <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
                            <input
                                type="checkbox"
                                checked={s.show_in_assignment}
                                onChange={(e) => updateSubcontractor(s.id, { show_in_assignment: e.target.checked })}
                                className="w-4 h-4 rounded accent-blue-600"
                            />
                            配置表に表示
                        </label>
                        <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
                            <input
                                type="checkbox"
                                checked={s.active}
                                onChange={(e) => updateSubcontractor(s.id, { active: e.target.checked })}
                                className="w-4 h-4 rounded accent-orange-600"
                            />
                            取引中
                        </label>
                    </div>
                ))}
                {subcontractors.length === 0 && (
                    <div className="text-center py-6 text-slate-400 font-bold text-sm">下請け会社が登録されていません</div>
                )}
            </div>

            <div className="flex flex-wrap items-end gap-3 mt-4 pt-4 border-t border-slate-100">
                <label className="text-xs font-bold text-slate-600">
                    会社名
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: ㈲○○塗装" className={`${inputClass} block mt-1 w-56`} />
                </label>
                <label className="text-xs font-bold text-slate-600">
                    標準単価（円/人工）
                    <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputClass} block mt-1 w-28 text-right`} />
                </label>
                <button
                    onClick={handleAdd}
                    className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-orange-700 shadow-md"
                >
                    <Plus size={16} /> 会社を追加
                </button>
            </div>
        </div>
    );
};

export default SubcontractorMasterSection;
