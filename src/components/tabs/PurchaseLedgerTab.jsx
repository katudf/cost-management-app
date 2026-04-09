import React, { useState, useEffect, useMemo } from 'react';
import { Search, Loader2, Database, Plus, Edit3, Trash2, X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';

const initialFormData = {
    date: '',
    project_name: '',
    supplier: '',
    item_name: '',
    note: '',
    quantity: '',
    unit: '',
    unit_price: '',
    amount: ''
};

const PurchaseLedgerTab = () => {
    const { showToast } = useToast();
    const [data, setData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // 新規登録用ステート
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [addFormData, setAddFormData] = useState(initialFormData);
    const [isSaving, setIsSaving] = useState(false);

    // インライン編集用ステート
    const [editingRowId, setEditingRowId] = useState(null);
    const [editFormData, setEditFormData] = useState({});

    // ページネーション用ステート
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(100);

    const headers = [
        { key: 'date', label: '年/月/日', type: 'date' },
        { key: 'project_name', label: '工事名', type: 'text' },
        { key: 'supplier', label: '購入先', type: 'text' },
        { key: 'item_name', label: '名称', type: 'text' },
        { key: 'note', label: '備考', type: 'text' },
        { key: 'quantity', label: '数量', type: 'number' },
        { key: 'unit', label: '単位', type: 'text' },
        { key: 'unit_price', label: '単価', type: 'number' },
        { key: 'amount', label: '金額', type: 'number' }
    ];

    const fetchPurchaseData = async () => {
        try {
            setIsLoading(true);
            let allRecords = [];
            let from = 0;
            const limit = 1000;
            
            while (true) {
                const { data: dbData, error: dbError } = await supabase
                    .from('PurchaseRecords')
                    .select('*')
                    .order('id', { ascending: true })
                    .range(from, from + limit - 1);

                if (dbError) throw dbError;
                
                if (dbData && dbData.length > 0) {
                    allRecords = [...allRecords, ...dbData];
                    if (dbData.length < limit) break;
                    from += limit;
                } else {
                    break;
                }
            }

            setData(allRecords);
            setError(null);
        } catch (err) {
            console.error(err);
            setError('データの読み込み中にエラーが発生しました。');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchPurchaseData();
    }, []);

    // 検索語句が変わったら1ページ目に戻す
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    const filteredData = useMemo(() => {
        if (!searchTerm.trim()) return data;
        
        const term = searchTerm.toLowerCase();
        return data.filter(row => {
            return Object.values(row).some(val => 
                val !== null && val !== undefined && String(val).toLowerCase().includes(term)
            );
        });
    }, [data, searchTerm]);

    const totalPages = Math.ceil(filteredData.length / rowsPerPage) || 1;

    const paginatedData = useMemo(() => {
        const start = (currentPage === '' ? 0 : (currentPage - 1)) * rowsPerPage;
        return filteredData.slice(start, start + rowsPerPage);
    }, [filteredData, currentPage, rowsPerPage]);

    const formatCell = (key, value, row) => {
        if (key === 'amount') {
            const q = Number(row?.quantity);
            const p = Number(row?.unit_price);
            if (!isNaN(q) && !isNaN(p) && row?.quantity !== null && row?.unit_price !== null && row?.quantity !== '' && row?.unit_price !== '') {
                return `¥${(q * p).toLocaleString()}`;
            }
            // 数量か単価が不足している場合は、既存のamountを表示するか「-」を表示
            if (value === null || value === undefined || value === '') return '-';
            const num = Number(value);
            return isNaN(num) ? value : `¥${num.toLocaleString()}`;
        }
        
        if (value === null || value === undefined || value === '') return '-';
        
        if (key === 'unit_price') {
            const num = Number(value);
            return isNaN(num) ? value : `¥${num.toLocaleString()}`;
        }
        
        if (key === 'date') {
            const dateObj = new Date(value);
            if (!isNaN(dateObj.getTime())) {
                return `${dateObj.getFullYear()}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
            }
        }
        
        return String(value);
    };

    // --- 新規登録処理 ---
    const handleAddChange = (key, value) => {
        setAddFormData(prev => ({ ...prev, [key]: value }));
    };

    const handleSaveNewRecord = async () => {
        if (!addFormData.date || !addFormData.project_name || !addFormData.item_name) {
            showToast('月/日、工事名、名称は必須項目です。', 'error');
            return;
        }

        try {
            setIsSaving(true);
            const insertData = { ...addFormData };
            if (insertData.quantity === '') insertData.quantity = null;
            if (insertData.unit_price === '') insertData.unit_price = null;
            if (insertData.amount === '') insertData.amount = null;

            const { data: insertedData, error } = await supabase
                .from('PurchaseRecords')
                .insert([insertData])
                .select();

            if (error) throw error;

            if (insertedData) {
                // 先頭に追加するか、末尾に追加するか
                setData(prev => [...prev, insertedData[0]]);
                // 最後のページに切り替えるなど
            }
            setIsAddModalOpen(false);
            setAddFormData(initialFormData);
        } catch (err) {
            console.error(err);
            showToast('登録に失敗しました: ' + err.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // --- インライン編集処理 ---
    const handleEditClick = (row) => {
        setEditingRowId(row.id);
        const currentData = { ...row };
        // nullを空文字に変換
        Object.keys(currentData).forEach(key => {
            if (currentData[key] === null) currentData[key] = '';
        });
        setEditFormData(currentData);
    };

    const handleEditChange = (key, value) => {
        setEditFormData(prev => ({ ...prev, [key]: value }));
        
        // 単価と数量が変わったら金額を自動計算 (簡易的)
        if (key === 'quantity' || key === 'unit_price') {
            setEditFormData(prev => {
                const q = key === 'quantity' ? Number(value) : Number(prev.quantity);
                const u = key === 'unit_price' ? Number(value) : Number(prev.unit_price);
                if (!isNaN(q) && !isNaN(u) && q !== 0 && u !== 0) {
                    return { ...prev, amount: String(q * u) };
                }
                return prev;
            });
        }
    };

    const handleCancelEdit = () => {
        setEditingRowId(null);
        setEditFormData({});
    };

    const handleSaveEdit = async (id) => {
        try {
            setIsSaving(true);
            const updateData = { ...editFormData };
            delete updateData.id;
            delete updateData.created_at;

            if (updateData.quantity === '') updateData.quantity = null;
            if (updateData.unit_price === '') updateData.unit_price = null;
            if (updateData.amount === '') updateData.amount = null;

            const { data: updatedData, error } = await supabase
                .from('PurchaseRecords')
                .update(updateData)
                .eq('id', id)
                .select();

            if (error) throw error;

            if (updatedData) {
                setData(prev => prev.map(r => r.id === id ? updatedData[0] : r));
            }
            setEditingRowId(null);
        } catch (err) {
            console.error(err);
            showToast('更新に失敗しました: ' + err.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // --- 削除処理 ---
    const handleDelete = async (id) => {
        if (!window.confirm('本当にこのデータを削除しますか？\nこの操作は元に戻せません。')) {
            return;
        }

        try {
            setIsSaving(true);
            const { error } = await supabase
                .from('PurchaseRecords')
                .delete()
                .eq('id', id);

            if (error) throw error;

            setData(prev => prev.filter(r => r.id !== id));
            if (editingRowId === id) {
                handleCancelEdit();
            }
        } catch (err) {
            console.error(err);
            showToast('削除に失敗しました: ' + err.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading && data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 h-64 bg-white rounded-xl shadow-sm border border-slate-200">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-slate-500 font-bold">データベースから仕入帳を読み込んでいます...</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full max-h-[800px] relative">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Database className="text-blue-600" />
                    <h2 className="text-lg font-bold text-slate-800">仕入帳データ (DB)</h2>
                    <span className="text-sm text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full ml-2">
                        {filteredData.length.toLocaleString()} 件
                    </span>
                    <button 
                        onClick={() => setIsAddModalOpen(true)}
                        className="ml-4 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded flex items-center gap-1 text-sm font-bold transition shadow-sm"
                    >
                        <Plus size={16} /> 新規登録
                    </button>
                </div>
                
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="フリーワード検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none w-full md:w-64"
                    />
                </div>
            </div>
            
            <div className="overflow-x-auto overflow-y-auto flex-1 p-0">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-600 bg-slate-100 uppercase sticky top-0 shadow-sm z-10">
                        <tr>
                            <th className="px-4 py-3 font-bold whitespace-nowrap border-b border-slate-200 text-center w-24">操作</th>
                            {headers.map((h, i) => (
                                <th key={i} className="px-4 py-3 font-bold whitespace-nowrap border-b border-slate-200">
                                    {h.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedData.length === 0 ? (
                            <tr>
                                <td colSpan={headers.length + 1} className="px-4 py-8 text-center text-slate-500 font-bold">
                                    データがありません
                                </td>
                            </tr>
                        ) : (
                            paginatedData.map((row) => {
                                const isEditing = editingRowId === row.id;
                                return (
                                <tr key={row.id} className={`border-b border-slate-100 transition-colors ${isEditing ? 'bg-blue-50/30' : 'hover:bg-slate-50'}`}>
                                    <td className="px-2 py-2 whitespace-nowrap text-center">
                                        {isEditing ? (
                                            <div className="flex items-center justify-center gap-1">
                                                <button onClick={() => handleSaveEdit(row.id)} disabled={isSaving} className="p-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition" title="保存">
                                                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                                </button>
                                                <button onClick={handleCancelEdit} disabled={isSaving} className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 transition" title="キャンセル">
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center gap-1">
                                                <button onClick={() => handleEditClick(row)} className="p-1 rounded text-blue-600 hover:bg-blue-100 transition" title="編集">
                                                    <Edit3 size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(row.id)} className="p-1 rounded text-red-600 hover:bg-red-100 transition" title="削除">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    {headers.map((h, i) => (
                                        <td key={i} className="px-4 py-2 text-slate-700 whitespace-nowrap">
                                            {isEditing ? (
                                                <input
                                                    type={h.type === 'date' ? 'date' : h.type === 'number' ? 'number' : 'text'}
                                                    value={editFormData[h.key] || ''}
                                                    onChange={(e) => handleEditChange(h.key, e.target.value)}
                                                    className="w-full px-2 py-1 border border-blue-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                                    style={{ minWidth: h.type === 'number' ? '80px' : h.type === 'date' ? '120px' : '100px' }}
                                                />
                                            ) : (
                                                <div className="max-w-xs truncate" title={String(row[h.key] || '')}>
                                                    {formatCell(h.key, row[h.key], row)}
                                                </div>
                                            )}
                                        </td>
                                    ))}
                                </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* ページネーション Footer */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">Page</span>
                    <input 
                        type="number" 
                        value={currentPage} 
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') setCurrentPage('');
                            else setCurrentPage(Number(val));
                        }}
                        onBlur={() => {
                            if (currentPage === '' || currentPage < 1) setCurrentPage(1);
                            if (currentPage > totalPages) setCurrentPage(totalPages);
                        }}
                        className="w-16 px-2 py-1 border border-slate-300 rounded text-center focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        min={1}
                        max={totalPages}
                    />
                    <span className="font-semibold text-slate-700">of {totalPages}</span>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                        <button 
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage <= 1 || currentPage === ''}
                            className="p-1 rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            title="Previous Page"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <button 
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages || currentPage === ''}
                            className="p-1 rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            title="Next Page"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 border-l border-slate-300 pl-4">
                        <select 
                            value={rowsPerPage} 
                            onChange={(e) => {
                                setRowsPerPage(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="px-2 py-1 border border-slate-300 rounded font-semibold text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                        >
                            <option value={50}>50 rows</option>
                            <option value={100}>100 rows</option>
                            <option value={200}>200 rows</option>
                            <option value={500}>500 rows</option>
                        </select>
                    </div>

                    <div className="font-semibold text-slate-700 w-28 text-right">
                        {filteredData.length.toLocaleString()} records
                    </div>
                </div>
            </div>

            {/* 新規登録モーダル */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Plus className="text-blue-600" /> 仕入帳 新規登録
                            </h3>
                            <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {headers.filter(h => h.key !== 'amount').map((h) => (
                                    <div key={`add-${h.key}`}>
                                        <label className="block text-xs font-bold text-slate-500 mb-1">{h.label}</label>
                                        <input
                                            type={h.type === 'date' ? 'date' : h.type === 'number' ? 'number' : 'text'}
                                            value={addFormData[h.key] || ''}
                                            onChange={(e) => handleAddChange(h.key, e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                            placeholder={`${h.label}を入力`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                            <button 
                                onClick={() => setIsAddModalOpen(false)}
                                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100 font-bold text-sm transition"
                                disabled={isSaving}
                            >
                                キャンセル
                            </button>
                            <button 
                                onClick={handleSaveNewRecord}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition shadow-sm flex items-center gap-2"
                                disabled={isSaving}
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                保存する
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(PurchaseLedgerTab);

