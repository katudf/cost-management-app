import React, { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Edit3, Trash2, Save, X, User, MapPin, Phone, UserCheck, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';

const CustomerSettings = () => {
    const { showToast } = useToast();
    const [customers, setCustomers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [form, setForm] = useState({ id: null, name: '', address: '', contactPerson: '', phone: '' });

    const fetchCustomers = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('Customers')
                .select('*')
                .order('name', { ascending: true });
            
            if (error) throw error;
            setCustomers(data || []);
        } catch (error) {
            console.error('顧客情報取得エラー:', error);
            showToast('顧客情報の取得に失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    const handleSave = async () => {
        if (!form.name.trim()) {
            showToast('顧客名は必須です', 'error');
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                address: form.address.trim(),
                contactPerson: form.contactPerson.trim(),
                phone: form.phone.trim()
            };

            if (form.id) {
                const { error } = await supabase.from('Customers').update(payload).eq('id', form.id);
                if (error) throw error;
                showToast('顧客情報を更新しました', 'success');
            } else {
                const { error } = await supabase.from('Customers').insert([payload]);
                if (error) throw error;
                showToast('顧客情報を追加しました', 'success');
            }

            setForm({ id: null, name: '', address: '', contactPerson: '', phone: '' });
            fetchCustomers();
        } catch (error) {
            console.error('顧客情報保存エラー:', error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('この顧客情報を削除してもよろしいですか？')) return;

        setIsSaving(true);
        try {
            const { error } = await supabase.from('Customers').delete().eq('id', id);
            if (error) throw error;
            showToast('顧客情報を削除しました', 'success');
            fetchCustomers();
        } catch (error) {
            console.error('顧客情報削除エラー:', error);
            showToast('削除に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const filteredCustomers = customers.filter(c => 
        c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.contactPerson?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <UserCheck className="text-blue-500" />
                        顧客情報管理
                    </h3>
                </div>

                {/* 入力フォーム */}
                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 mb-8 shadow-sm">
                    <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                        {form.id ? <Edit3 size={18} className="text-blue-600" /> : <Plus size={18} className="text-green-600" />}
                        {form.id ? '顧客情報の編集' : '新規顧客の追加'}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="lg:col-span-1">
                            <label className="block text-xs font-bold text-slate-500 mb-1">顧客名 <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="株式会社〇〇"
                                />
                            </div>
                        </div>
                        <div className="lg:col-span-1">
                            <label className="block text-xs font-bold text-slate-500 mb-1">住所</label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="text"
                                    value={form.address}
                                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="東京都港区..."
                                />
                            </div>
                        </div>
                        <div className="lg:col-span-1">
                            <label className="block text-xs font-bold text-slate-500 mb-1">担当者名</label>
                            <div className="relative">
                                <UserCheck className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="text"
                                    value={form.contactPerson}
                                    onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="山田 太郎"
                                />
                            </div>
                        </div>
                        <div className="lg:col-span-1">
                            <label className="block text-xs font-bold text-slate-500 mb-1">電話番号</label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="text"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="00-0000-0000"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-5">
                        {form.id && (
                            <button
                                onClick={() => setForm({ id: null, name: '', address: '', contactPerson: '', phone: '' })}
                                disabled={isSaving}
                                className="px-5 py-2.5 rounded-lg font-bold text-sm text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 transition flex items-center gap-1 disabled:opacity-50"
                            >
                                <X size={16} /> キャンセル
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={!form.name || isSaving}
                            className="px-5 py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-100"
                        >
                            <Save size={16} /> {form.id ? '更新する' : '追加する'}
                        </button>
                    </div>
                </div>

                {/* 検索バー */}
                <div className="mb-4 relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="顧客名や住所で検索..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:border-blue-400 focus:bg-white outline-none font-bold text-slate-700 transition-all"
                    />
                </div>

                {/* 顧客一覧テーブル */}
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left font-bold text-slate-700">
                        <thead>
                            <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wider">
                                <th className="p-4 font-bold border-b border-slate-200">顧客名</th>
                                <th className="p-4 font-bold border-b border-slate-200">住所</th>
                                <th className="p-4 font-bold border-b border-slate-200">担当者</th>
                                <th className="p-4 font-bold border-b border-slate-200">電話番号</th>
                                <th className="p-4 font-bold border-b border-slate-200 text-center">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {isLoading ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400">
                                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                        読み込み中...
                                    </td>
                                </tr>
                            ) : filteredCustomers.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400 font-bold text-sm">
                                        顧客情報が見つかりません
                                    </td>
                                </tr>
                            ) : (
                                filteredCustomers.map(customer => (
                                    <tr key={customer.id} className={`hover:bg-slate-50 transition ${form.id === customer.id ? 'bg-blue-50' : ''}`}>
                                        <td className="p-4 text-sm text-slate-800">{customer.name}</td>
                                        <td className="p-4 text-sm text-slate-500">{customer.address || '-'}</td>
                                        <td className="p-4 text-sm text-slate-500">{customer.contactPerson || '-'}</td>
                                        <td className="p-4 text-sm text-slate-500 font-mono">{customer.phone || '-'}</td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => setForm({ ...customer })}
                                                    disabled={isSaving}
                                                    className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                    title="編集"
                                                >
                                                    <Edit3 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(customer.id)}
                                                    disabled={isSaving}
                                                    className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                    title="削除"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default CustomerSettings;
