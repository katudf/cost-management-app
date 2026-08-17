import React, { useState } from 'react';
import { Plus, Edit3, Trash2, Save, Loader2, X, Factory, ListOrdered, Tags } from 'lucide-react';
import { useToast } from '../../Toast';
import ConfirmModal from '../../ConfirmModal';
import {
    createManufacturer,
    updateManufacturer,
    deleteManufacturer,
    createProcessRole,
    updateProcessRole,
    deleteProcessRole,
    createClassificationTag,
    updateClassificationTag,
    deleteClassificationTag,
} from '../../../features/paint/supabasePaint';

const inputClass = 'px-3 py-2 rounded-lg border-2 border-slate-200 font-bold text-slate-700 text-sm outline-none focus:border-blue-500 transition';

const isFkViolation = (error) => error?.code === '23503';

const PaintMastersPanel = ({ masters, onMastersChanged }) => {
    const { showToast } = useToast();
    const { manufacturers, processRoles, axes } = masters;

    const [isSaving, setIsSaving] = useState(false);
    // confirmDelete: { kind: 'manufacturer'|'role'|'tag', id, label }
    const [confirmDelete, setConfirmDelete] = useState(null);

    // --- メーカー ---
    const [makerForm, setMakerForm] = useState({ id: null, name: '' });

    const saveMaker = async () => {
        if (!makerForm.name.trim()) {
            showToast('メーカー名を入力してください', 'error');
            return;
        }
        setIsSaving(true);
        try {
            if (makerForm.id) {
                await updateManufacturer(makerForm.id, makerForm.name.trim());
                showToast('メーカーを更新しました', 'success');
            } else {
                await createManufacturer(makerForm.name.trim());
                showToast('メーカーを登録しました', 'success');
            }
            setMakerForm({ id: null, name: '' });
            onMastersChanged();
        } catch (error) {
            console.error('メーカー保存エラー:', error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // --- 工程区分 ---
    const [roleForm, setRoleForm] = useState({ id: null, name: '', sort_order: '' });

    const saveRole = async () => {
        if (!roleForm.name.trim()) {
            showToast('工程区分名を入力してください', 'error');
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                name: roleForm.name.trim(),
                sort_order: roleForm.sort_order === '' ? 0 : Number(roleForm.sort_order),
            };
            if (roleForm.id) {
                await updateProcessRole(roleForm.id, payload);
                showToast('工程区分を更新しました', 'success');
            } else {
                await createProcessRole(payload);
                showToast('工程区分を登録しました', 'success');
            }
            setRoleForm({ id: null, name: '', sort_order: '' });
            onMastersChanged();
        } catch (error) {
            console.error('工程区分保存エラー:', error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // --- 分類タグ（軸ごと） ---
    // tagForms: { [axisId]: { id, value, sort_order } }
    const [tagForms, setTagForms] = useState({});

    const getTagForm = (axisId) => tagForms[axisId] || { id: null, value: '', sort_order: '' };
    const setTagForm = (axisId, form) => setTagForms((prev) => ({ ...prev, [axisId]: form }));

    const saveTag = async (axisId) => {
        const form = getTagForm(axisId);
        if (!form.value.trim()) {
            showToast('タグ名を入力してください', 'error');
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                value: form.value.trim(),
                sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
            };
            if (form.id) {
                await updateClassificationTag(form.id, payload);
                showToast('タグを更新しました', 'success');
            } else {
                await createClassificationTag({ axis_id: axisId, ...payload });
                showToast('タグを登録しました', 'success');
            }
            setTagForm(axisId, { id: null, value: '', sort_order: '' });
            onMastersChanged();
        } catch (error) {
            console.error('タグ保存エラー:', error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // --- 削除（物理削除、FK参照中はエラー） ---
    const handleDelete = async () => {
        if (!confirmDelete) return;
        const { kind, id } = confirmDelete;
        setConfirmDelete(null);
        setIsSaving(true);
        try {
            if (kind === 'manufacturer') await deleteManufacturer(id);
            else if (kind === 'role') await deleteProcessRole(id);
            else await deleteClassificationTag(id);
            showToast('削除しました', 'success');
            onMastersChanged();
        } catch (error) {
            console.error('マスタ削除エラー:', error);
            if (isFkViolation(error)) {
                showToast('使用中のため削除できません', 'error');
            } else {
                showToast('削除に失敗しました', 'error');
            }
        } finally {
            setIsSaving(false);
        }
    };

    const editBtnClass = 'bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50';
    const deleteBtnClass = 'bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50';
    const saveBtnClass = 'px-4 py-2 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-1 disabled:opacity-50 shrink-0';
    const cancelBtnClass = 'px-3 py-2 rounded-lg font-bold text-sm text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 transition shrink-0';

    return (
        <div className="space-y-6">
            {/* メーカー管理 */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-4">
                    <Factory size={18} className="text-blue-500" />
                    メーカー管理
                    <span className="text-xs font-bold text-slate-400">{manufacturers.length}件</span>
                </h3>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        value={makerForm.name}
                        onChange={(e) => setMakerForm({ ...makerForm, name: e.target.value })}
                        placeholder="メーカー名（例: 日本ペイント）"
                        className={`${inputClass} flex-1 min-w-[200px]`}
                    />
                    <button onClick={saveMaker} disabled={isSaving} className={saveBtnClass}>
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : makerForm.id ? <Save size={16} /> : <Plus size={16} />}
                        {makerForm.id ? '更新' : '追加'}
                    </button>
                    {makerForm.id && (
                        <button onClick={() => setMakerForm({ id: null, name: '' })} className={cancelBtnClass}>
                            キャンセル
                        </button>
                    )}
                </div>
                {manufacturers.length === 0 ? (
                    <p className="text-sm font-bold text-slate-400 text-center py-4">メーカーが未登録です。上のフォームから追加してください。</p>
                ) : (
                    <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                        {manufacturers.map((m) => (
                            <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50 transition">
                                <span className="font-bold text-slate-700 text-sm">{m.name}</span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => setMakerForm({ id: m.id, name: m.name })}
                                        disabled={isSaving}
                                        className={editBtnClass}
                                        aria-label={`${m.name}を編集`} title="編集"
                                    >
                                        <Edit3 size={14} />
                                    </button>
                                    <button
                                        onClick={() => setConfirmDelete({ kind: 'manufacturer', id: m.id, label: m.name })}
                                        disabled={isSaving}
                                        className={deleteBtnClass}
                                        aria-label={`${m.name}を削除`} title="削除"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* 工程区分管理 */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-4">
                    <ListOrdered size={18} className="text-blue-500" />
                    工程区分管理
                    <span className="text-xs font-bold text-slate-400">{processRoles.length}件</span>
                </h3>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        value={roleForm.name}
                        onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                        placeholder="工程区分名（例: 下塗）"
                        className={`${inputClass} flex-1 min-w-[160px]`}
                    />
                    <input
                        type="number"
                        min="0"
                        value={roleForm.sort_order}
                        onChange={(e) => setRoleForm({ ...roleForm, sort_order: e.target.value })}
                        placeholder="表示順"
                        className={`${inputClass} w-24`}
                        aria-label="表示順"
                    />
                    <button onClick={saveRole} disabled={isSaving} className={saveBtnClass}>
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : roleForm.id ? <Save size={16} /> : <Plus size={16} />}
                        {roleForm.id ? '更新' : '追加'}
                    </button>
                    {roleForm.id && (
                        <button onClick={() => setRoleForm({ id: null, name: '', sort_order: '' })} className={cancelBtnClass}>
                            キャンセル
                        </button>
                    )}
                </div>
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                    {processRoles.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50 transition">
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-slate-400 w-6 text-center">{r.sort_order}</span>
                                <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-full text-sm font-bold">{r.name}</span>
                            </div>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setRoleForm({ id: r.id, name: r.name, sort_order: String(r.sort_order ?? '') })}
                                    disabled={isSaving}
                                    className={editBtnClass}
                                    aria-label={`${r.name}を編集`} title="編集"
                                >
                                    <Edit3 size={14} />
                                </button>
                                <button
                                    onClick={() => setConfirmDelete({ kind: 'role', id: r.id, label: r.name })}
                                    disabled={isSaving}
                                    className={deleteBtnClass}
                                    aria-label={`${r.name}を削除`} title="削除"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            {/* 分類タグ管理 */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
                    <Tags size={18} className="text-blue-500" />
                    分類タグ管理
                </h3>
                <p className="text-xs font-bold text-slate-400 mb-4">分類軸（用途系統・樹脂種別など）は固定です。各軸のタグ値を追加・編集できます。</p>
                <div className="space-y-5">
                    {axes.map((axis) => {
                        const form = getTagForm(axis.id);
                        return (
                            <div key={axis.id} className="border border-slate-200 rounded-xl p-4">
                                <h4 className="text-sm font-bold text-slate-700 mb-3">
                                    {axis.name}
                                    <span className="ml-2 text-xs font-bold text-slate-400">{axis.tags.length}件</span>
                                </h4>
                                <div className="flex flex-wrap items-center gap-2 mb-3">
                                    <input
                                        type="text"
                                        value={form.value}
                                        onChange={(e) => setTagForm(axis.id, { ...form, value: e.target.value })}
                                        placeholder={`${axis.name}のタグ名`}
                                        className={`${inputClass} flex-1 min-w-[160px]`}
                                    />
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.sort_order}
                                        onChange={(e) => setTagForm(axis.id, { ...form, sort_order: e.target.value })}
                                        placeholder="表示順"
                                        className={`${inputClass} w-24`}
                                        aria-label={`${axis.name}のタグ表示順`}
                                    />
                                    <button onClick={() => saveTag(axis.id)} disabled={isSaving} className={saveBtnClass}>
                                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : form.id ? <Save size={16} /> : <Plus size={16} />}
                                        {form.id ? '更新' : '追加'}
                                    </button>
                                    {form.id && (
                                        <button onClick={() => setTagForm(axis.id, { id: null, value: '', sort_order: '' })} className={cancelBtnClass}>
                                            キャンセル
                                        </button>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {axis.tags.map((t) => (
                                        <span key={t.id} className="inline-flex items-center gap-1 pl-3 pr-1 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-bold">
                                            {t.value}
                                            <button
                                                onClick={() => setTagForm(axis.id, { id: t.id, value: t.value, sort_order: String(t.sort_order ?? '') })}
                                                disabled={isSaving}
                                                className="p-1 rounded-full text-blue-500 hover:bg-blue-100 transition disabled:opacity-50"
                                                aria-label={`${t.value}を編集`} title="編集"
                                            >
                                                <Edit3 size={12} />
                                            </button>
                                            <button
                                                onClick={() => setConfirmDelete({ kind: 'tag', id: t.id, label: t.value })}
                                                disabled={isSaving}
                                                className="p-1 rounded-full text-red-400 hover:bg-red-100 transition disabled:opacity-50"
                                                aria-label={`${t.value}を削除`} title="削除"
                                            >
                                                <X size={12} />
                                            </button>
                                        </span>
                                    ))}
                                    {axis.tags.length === 0 && (
                                        <span className="text-xs font-bold text-slate-400">タグ未登録</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <ConfirmModal
                isOpen={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={handleDelete}
                title="マスタを削除"
                message={confirmDelete ? `「${confirmDelete.label}」を削除してもよろしいですか？（製品や仕様で使用中の場合は削除できません）` : ''}
            />
        </div>
    );
};

export default PaintMastersPanel;
