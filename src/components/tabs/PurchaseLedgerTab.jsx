import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Loader2, Database, Plus, Edit3, Trash2, X, Check, ChevronLeft, ChevronRight, FlaskConical, Upload, FileDown, ArrowUp, ArrowDown, ArrowUpDown, Filter, RotateCcw, CheckSquare, Square, MinusSquare, Copy } from 'lucide-react';
import {
    usePurchaseLedger,
    insertPurchaseRecord,
    insertPurchaseRecords,
    updatePurchaseRecord,
    deletePurchaseRecord,
    deletePurchaseRecords
} from '../../hooks/usePurchaseLedger';
import { useToast } from '../../components/Toast';
import ConfirmModal from '../ConfirmModal';
import { searchPaintProductsByName, fetchPaintProductsByIds } from '../../features/paint/supabasePaint';

// 登録用CSVフォーマットの列（順序どおりにテンプレートへ出力する）
const CSV_COLUMNS = ['年/月/日', '工事名', '購入先', '名称', '備考', '数量', '単位', '単価', '金額'];
const CSV_SAMPLE_ROW = ['2026/4/1', '〇〇邸新築工事', '△△建材', 'コンパネ 12mm', '', '10', '枚', '1500', '15000'];
const CSV_INSERT_CHUNK_SIZE = 500;

// ヘッダー文字列 → PurchaseRecords カラムの対応（scripts/upload_purchase_ledger.js と同じ突き合わせ方針）
const buildCsvColMap = (headerCells) => ({
    date: headerCells.findIndex(h => h.includes('月/日') || h.includes('日付')),
    project_name: headerCells.findIndex(h => h.includes('工事名')),
    supplier: headerCells.findIndex(h => h.includes('購入先') || h.includes('仕入先')),
    item_name: headerCells.findIndex(h => h.includes('名称') || h.includes('品名')),
    note: headerCells.findIndex(h => h.includes('備考')),
    quantity: headerCells.findIndex(h => h.includes('数量')),
    unit: headerCells.findIndex(h => h === '単位' || (h.includes('単位') && !h.includes('単価'))),
    unit_price: headerCells.findIndex(h => h.includes('単価')),
    amount: headerCells.findIndex(h => h.includes('金額'))
});

// RFC4180 準拠の簡易CSVパーサ（ダブルクォート内のカンマ・改行・"" を扱う）
const parseCsv = (text) => {
    const clean = text.replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (inQuotes) {
            if (c === '"') {
                if (clean[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\r') {
            // \r\n の \r は無視
        } else if (c === '\n') {
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
};

// 各種日付表記を ISO(YYYY-MM-DD) へ正規化。空・不正なら null
const normalizeCsvDate = (raw) => {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;
    // Excelシリアル値
    if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 40000) {
        const d = new Date((Number(s) - 25569) * 86400 * 1000);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    }
    const m = s.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m) {
        const [, y, mo, d] = m;
        const pad = (n) => String(n).padStart(2, '0');
        const iso = `${y}-${pad(mo)}-${pad(d)}`;
        const dd = new Date(iso);
        return isNaN(dd.getTime()) ? null : iso;
    }
    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
};

// 数値セル → number | null（カンマ・円記号・空白を許容）
const parseNumericCell = (raw) => {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).replace(/[,¥\s]/g, '').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};

const initialFormData = {
    date: '',
    project_name: '',
    supplier: '',
    item_name: '',
    note: '',
    quantity: '',
    unit: '',
    unit_price: '',
    amount: '',
    paint_product_id: null
};

const PurchaseLedgerTab = () => {
    const { showToast } = useToast();
    // 一覧の取得・保持は usePurchaseLedger に集約（従来の data / isLoading と同じ役割）
    const {
        records: data,
        setRecords: setData,
        isLoading,
        refetch: refetchPurchaseData
    } = usePurchaseLedger({
        onError: () => showToast('データの読み込み中にエラーが発生しました。', 'error')
    });
    const [searchTerm, setSearchTerm] = useState('');

    // 新規登録用ステート
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [addFormData, setAddFormData] = useState(initialFormData);
    const [isSaving, setIsSaving] = useState(false);

    // 塗料製品リンク用ステート
    const [paintSearch, setPaintSearch] = useState('');
    const [paintCandidates, setPaintCandidates] = useState([]);
    const [selectedPaint, setSelectedPaint] = useState(null);
    const [linkedPaintMap, setLinkedPaintMap] = useState({});

    // インライン編集用ステート
    const [editingRowId, setEditingRowId] = useState(null);
    const [editFormData, setEditFormData] = useState({});
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    // 重複行の洗い出し・一括削除用ステート
    const [showDupOnly, setShowDupOnly] = useState(false); // true: 重複キーが2件以上ある行だけ表示
    const [selectedIds, setSelectedIds] = useState(() => new Set()); // チェックした行の id
    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

    // ページネーション用ステート
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(100);

    // ソート用ステート（key: headers の key / null は未ソート、direction: 'asc' | 'desc'）
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

    // フィルター用ステート
    const [showFilters, setShowFilters] = useState(false);
    const [dateFrom, setDateFrom] = useState(''); // YYYY-MM-DD
    const [dateTo, setDateTo] = useState('');     // YYYY-MM-DD
    // 項目フィルター: text 系は完全一致の選択値、number 系は { min, max } の文字列
    const [colFilters, setColFilters] = useState({
        project_name: '',
        supplier: '',
        item_name: '',
        note: '',
        unit: '',
        quantity: { min: '', max: '' },
        unit_price: { min: '', max: '' },
        amount: { min: '', max: '' },
    });

    // CSVインポート用ステート
    const csvInputRef = useRef(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importResult, setImportResult] = useState(null); // { total, inserted, skipped, errors: [{line, reason}] }

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

    // 再取得。失敗時のメッセージ表示は usePurchaseLedger の onError に集約している
    const fetchPurchaseData = async () => {
        try {
            await refetchPurchaseData();
        } catch {
            // onError で showToast 済み
        }
    };

    // 検索語句・ソート条件・フィルターが変わったら1ページ目に戻す
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, sortConfig, dateFrom, dateTo, colFilters, showDupOnly]);

    // データが変わったら、すでに存在しない id を選択状態から取り除く
    useEffect(() => {
        setSelectedIds(prev => {
            if (prev.size === 0) return prev;
            const alive = new Set(data.map(r => r.id));
            let changed = false;
            const next = new Set();
            for (const id of prev) {
                if (alive.has(id)) next.add(id);
                else changed = true;
            }
            return changed ? next : prev;
        });
    }, [data]);

    // 塗料製品の部分一致検索（300ms debounce）
    useEffect(() => {
        if (!isAddModalOpen || selectedPaint) return;
        const term = paintSearch.trim();
        if (!term) {
            setPaintCandidates([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const results = await searchPaintProductsByName(term);
                setPaintCandidates(results);
            } catch (err) {
                console.error('塗料製品検索エラー:', err);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [paintSearch, isAddModalOpen, selectedPaint]);

    // 紐付け済み塗料製品の表示用情報を取得
    useEffect(() => {
        const ids = [...new Set(data.map(r => r.paint_product_id).filter(Boolean))];
        const missing = ids.filter(id => !(id in linkedPaintMap));
        if (missing.length === 0) return;
        fetchPaintProductsByIds(missing)
            .then(products => {
                setLinkedPaintMap(prev => {
                    const next = { ...prev };
                    products.forEach(p => { next[p.id] = p; });
                    return next;
                });
            })
            .catch(err => console.error('塗料製品取得エラー:', err));
    }, [data, linkedPaintMap]);

    // amount の実効値（表示と同じく 数量 × 単価 のフォールバック込み）
    const effectiveAmount = (row) => {
        let v = row?.amount;
        if (v === null || v === undefined || v === '') {
            const q = Number(row?.quantity);
            const p = Number(row?.unit_price);
            if (!isNaN(q) && !isNaN(p) && row?.quantity !== null && row?.unit_price !== null) {
                v = q * p;
            }
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    // 項目フィルターの選択肢（テキスト系カラムの重複を除いた実データ値）
    const filterOptions = useMemo(() => {
        const keys = ['project_name', 'supplier', 'item_name', 'note', 'unit'];
        const sets = Object.fromEntries(keys.map(k => [k, new Set()]));
        for (const row of data) {
            for (const k of keys) {
                const v = row?.[k];
                if (v !== null && v !== undefined && String(v).trim() !== '') {
                    sets[k].add(String(v));
                }
            }
        }
        return Object.fromEntries(
            keys.map(k => [k, [...sets[k]].sort((a, b) => a.localeCompare(b, 'ja'))])
        );
    }, [data]);

    // 有効なフィルター件数（バッジ表示用）
    const activeFilterCount = useMemo(() => {
        let n = 0;
        if (dateFrom) n++;
        if (dateTo) n++;
        for (const [, v] of Object.entries(colFilters)) {
            if (typeof v === 'string') {
                if (v !== '') n++;
            } else {
                if (v.min !== '') n++;
                if (v.max !== '') n++;
            }
        }
        return n;
    }, [dateFrom, dateTo, colFilters]);

    const resetFilters = () => {
        setDateFrom('');
        setDateTo('');
        setColFilters({
            project_name: '', supplier: '', item_name: '', note: '', unit: '',
            quantity: { min: '', max: '' },
            unit_price: { min: '', max: '' },
            amount: { min: '', max: '' },
        });
        setShowDupOnly(false);
    };

    const filteredData = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();

        const numMatch = (value, { min, max }) => {
            if (min === '' && max === '') return true;
            if (value === null || value === undefined) return false;
            const n = Number(value);
            if (!Number.isFinite(n)) return false;
            if (min !== '' && n < Number(min)) return false;
            if (max !== '' && n > Number(max)) return false;
            return true;
        };

        return data.filter(row => {
            // フリーワード検索
            if (term) {
                const hit = Object.values(row).some(val =>
                    val !== null && val !== undefined && String(val).toLowerCase().includes(term)
                );
                if (!hit) return false;
            }

            // 期間フィルター（date カラム）
            if (dateFrom || dateTo) {
                const raw = row?.date;
                if (!raw) return false;
                const d = new Date(raw);
                if (isNaN(d.getTime())) return false;
                const iso = d.toISOString().split('T')[0];
                if (dateFrom && iso < dateFrom) return false;
                if (dateTo && iso > dateTo) return false;
            }

            // 項目フィルター（テキスト系は完全一致）
            for (const k of ['project_name', 'supplier', 'item_name', 'note', 'unit']) {
                const sel = colFilters[k];
                if (sel !== '' && String(row?.[k] ?? '') !== sel) return false;
            }

            // 項目フィルター（数値系は範囲）
            if (!numMatch(row?.quantity, colFilters.quantity)) return false;
            if (!numMatch(row?.unit_price, colFilters.unit_price)) return false;
            if (!numMatch(effectiveAmount(row), colFilters.amount)) return false;

            return true;
        });
    }, [data, searchTerm, dateFrom, dateTo, colFilters]);

    // 重複判定キー（備考・金額は含めない: 備考は運用メモ、金額は数量×単価の派生値のため）
    const dupKeyOf = (row) => {
        const norm = (v) => (v === null || v === undefined ? '' : String(v).trim());
        return [
            norm(row?.date),
            norm(row?.project_name),
            norm(row?.supplier),
            norm(row?.item_name),
            norm(row?.quantity),
            norm(row?.unit_price),
        ].join('|');
    };

    // 絞り込み後のデータからキーごとの件数を集計（2件以上あれば重複）
    const dupCountByKey = useMemo(() => {
        const map = new Map();
        for (const row of filteredData) {
            const k = dupKeyOf(row);
            map.set(k, (map.get(k) || 0) + 1);
        }
        return map;
    }, [filteredData]);

    // 「重複行のみ表示」トグルが ON のときは件数2件以上のキーの行だけに絞る
    const dupFilteredData = useMemo(() => {
        if (!showDupOnly) return filteredData;
        return filteredData.filter(row => (dupCountByKey.get(dupKeyOf(row)) || 0) >= 2);
    }, [filteredData, showDupOnly, dupCountByKey]);

    // 重複グループが存在するか（トグルボタンの活性判定に使用）
    const hasDuplicates = useMemo(() => {
        for (const count of dupCountByKey.values()) {
            if (count >= 2) return true;
        }
        return false;
    }, [dupCountByKey]);

    // 表示中の行を指定カラムで並べ替え（未ソート時は dupFilteredData をそのまま返す）
    const sortedData = useMemo(() => {
        const { key, direction } = sortConfig;
        if (!key) return dupFilteredData;

        const header = headers.find(h => h.key === key);
        const type = header?.type || 'text';
        const dir = direction === 'desc' ? -1 : 1;

        const getComparable = (row) => {
            let v = row?.[key];
            // 金額は quantity * unit_price のフォールバックを表示と揃える
            if (key === 'amount' && (v === null || v === undefined || v === '')) {
                const q = Number(row?.quantity);
                const p = Number(row?.unit_price);
                if (!isNaN(q) && !isNaN(p) && row?.quantity !== null && row?.unit_price !== null) {
                    v = q * p;
                }
            }
            return v;
        };

        const isEmpty = (v) => v === null || v === undefined || v === '';

        return [...dupFilteredData].sort((a, b) => {
            const va = getComparable(a);
            const vb = getComparable(b);

            // 空値は昇順・降順にかかわらず常に末尾
            if (isEmpty(va) && isEmpty(vb)) return 0;
            if (isEmpty(va)) return 1;
            if (isEmpty(vb)) return -1;

            if (type === 'number') {
                return (Number(va) - Number(vb)) * dir;
            }
            if (type === 'date') {
                return (new Date(va).getTime() - new Date(vb).getTime()) * dir;
            }
            return String(va).localeCompare(String(vb), 'ja') * dir;
        });
    }, [dupFilteredData, sortConfig]);

    const totalPages = Math.ceil(sortedData.length / rowsPerPage) || 1;

    const paginatedData = useMemo(() => {
        const start = (currentPage === '' ? 0 : (currentPage - 1)) * rowsPerPage;
        return sortedData.slice(start, start + rowsPerPage);
    }, [sortedData, currentPage, rowsPerPage]);

    // カラムヘッダーのソートボタン: 同じカラムを押すたび 昇順 -> 降順 -> 解除 を巡回
    const handleSort = (key) => {
        setSortConfig(prev => {
            if (prev.key !== key) return { key, direction: 'asc' };
            if (prev.direction === 'asc') return { key, direction: 'desc' };
            return { key: null, direction: 'asc' };
        });
    };

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

    const closeAddModal = () => {
        setIsAddModalOpen(false);
        setAddFormData(initialFormData);
        setPaintSearch('');
        setPaintCandidates([]);
        setSelectedPaint(null);
    };

    const handleSelectPaint = (product) => {
        setSelectedPaint(product);
        setAddFormData(prev => ({ ...prev, paint_product_id: product.id }));
        setPaintSearch('');
        setPaintCandidates([]);
    };

    const handleClearPaint = () => {
        setSelectedPaint(null);
        setAddFormData(prev => ({ ...prev, paint_product_id: null }));
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

            const insertedRecord = await insertPurchaseRecord(insertData);

            if (insertedRecord) {
                // 先頭に追加するか、末尾に追加するか
                setData(prev => [...prev, insertedRecord]);
                // 最後のページに切り替えるなど
            }
            closeAddModal();
        } catch (err) {
            console.error(err);
            showToast('登録に失敗しました: ' + err.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // --- CSVインポート処理 ---

    // 登録用CSVフォーマット（テンプレート）をダウンロード
    const handleDownloadTemplate = () => {
        const lines = [CSV_COLUMNS.join(','), CSV_SAMPLE_ROW.join(',')];
        // Excelでの文字化けを防ぐため UTF-8 BOM を付与
        const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '仕入帳_登録フォーマット.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // CSVテキストを PurchaseRecords 行の配列へ変換（バリデーション付き）
    const buildRecordsFromCsv = (text) => {
        const rows = parseCsv(text).filter(
            r => r.length > 0 && !r.every(c => c === null || c === undefined || String(c).trim() === '')
        );
        if (rows.length === 0) {
            return { records: [], errors: [], total: 0, headerError: 'CSVにデータがありません。' };
        }

        const headerCells = rows[0].map(h => (h ? String(h).trim() : ''));
        const colMap = buildCsvColMap(headerCells);

        if (colMap.date < 0 || colMap.project_name < 0 || colMap.item_name < 0) {
            return {
                records: [], errors: [], total: 0,
                headerError: 'ヘッダー行に「年/月/日」「工事名」「名称」の列が見つかりません。フォーマットをダウンロードして確認してください。'
            };
        }

        const at = (row, idx) => (idx >= 0 && idx < row.length ? row[idx] : '');
        const records = [];
        const errors = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const lineNo = i + 1; // 1始まり・ヘッダー込みの行番号

            const date = normalizeCsvDate(at(row, colMap.date));
            const projectName = String(at(row, colMap.project_name) ?? '').trim();
            const itemName = String(at(row, colMap.item_name) ?? '').trim();

            if (!date || !projectName || !itemName) {
                const missing = [];
                if (!date) missing.push('年/月/日');
                if (!projectName) missing.push('工事名');
                if (!itemName) missing.push('名称');
                errors.push({ line: lineNo, reason: `必須項目が不足しています（${missing.join('・')}）` });
                continue;
            }

            records.push({
                date,
                project_name: projectName,
                supplier: (() => { const v = String(at(row, colMap.supplier) ?? '').trim(); return v || null; })(),
                item_name: itemName,
                note: (() => { const v = String(at(row, colMap.note) ?? '').trim(); return v || null; })(),
                quantity: parseNumericCell(at(row, colMap.quantity)),
                unit: (() => { const v = String(at(row, colMap.unit) ?? '').trim(); return v || null; })(),
                unit_price: parseNumericCell(at(row, colMap.unit_price)),
                amount: parseNumericCell(at(row, colMap.amount))
            });
        }

        return { records, errors, total: rows.length - 1, headerError: null };
    };

    const handleCsvFileSelected = async (e) => {
        const file = e.target.files?.[0];
        if (csvInputRef.current) csvInputRef.current.value = ''; // 同じファイルを再選択できるようにする
        if (!file) return;

        try {
            setIsImporting(true);
            const text = await file.text();
            const { records, errors, total, headerError } = buildRecordsFromCsv(text);

            if (headerError) {
                showToast(headerError, 'error');
                return;
            }

            if (records.length === 0) {
                setImportResult({ total, inserted: 0, skipped: errors.length, errors });
                showToast('登録できる行がありませんでした。', 'error');
                return;
            }

            let inserted = 0;
            const insertErrors = [...errors];
            for (let i = 0; i < records.length; i += CSV_INSERT_CHUNK_SIZE) {
                const chunk = records.slice(i, i + CSV_INSERT_CHUNK_SIZE);
                try {
                    await insertPurchaseRecords(chunk);
                    inserted += chunk.length;
                } catch (err) {
                    insertErrors.push({ line: null, reason: `DB登録エラー（${i + 1}〜${i + chunk.length}件目）: ${err.message}` });
                }
            }

            setImportResult({
                total,
                inserted,
                skipped: total - inserted,
                errors: insertErrors
            });

            if (inserted > 0) {
                await fetchPurchaseData();
                showToast(`${inserted}件を登録しました。${total - inserted > 0 ? `（${total - inserted}件スキップ）` : ''}`, 'success');
            } else {
                showToast('登録に失敗しました。詳細を確認してください。', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('CSVの読み込みに失敗しました: ' + err.message, 'error');
        } finally {
            setIsImporting(false);
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
            if (updateData.paint_product_id === '') updateData.paint_product_id = null;

            const updatedRecord = await updatePurchaseRecord(id, updateData);

            if (updatedRecord) {
                setData(prev => prev.map(r => r.id === id ? updatedRecord : r));
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
        try {
            setIsSaving(true);
            await deletePurchaseRecord(id);

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

    // --- チェックボックス選択 ---
    // 現在表示中（絞り込み・ソート後）の行 id 一覧
    const visibleRowIds = useMemo(() => sortedData.map(r => r.id), [sortedData]);
    const allVisibleChecked = visibleRowIds.length > 0 && visibleRowIds.every(id => selectedIds.has(id));

    const toggleSelectRow = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAllVisible = () => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (visibleRowIds.every(id => next.has(id))) {
                // 全解除
                visibleRowIds.forEach(id => next.delete(id));
            } else {
                // 表示中をすべて選択に追加
                visibleRowIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    // --- 選択した行の一括削除 ---
    const handleBulkDelete = async () => {
        const ids = [...selectedIds];
        if (ids.length === 0) return;
        try {
            setIsSaving(true);
            await deletePurchaseRecords(ids);

            const removed = new Set(ids);
            setData(prev => prev.filter(r => !removed.has(r.id)));
            setSelectedIds(new Set());
            if (editingRowId !== null && removed.has(editingRowId)) {
                handleCancelEdit();
            }
            showToast(`${ids.length}件を削除しました`, 'success');
        } catch (err) {
            console.error(err);
            showToast('一括削除に失敗しました: ' + err.message, 'error');
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
                    <input
                        ref={csvInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleCsvFileSelected}
                        className="hidden"
                    />
                    <button
                        onClick={() => csvInputRef.current?.click()}
                        disabled={isImporting}
                        title="CSVファイルから仕入帳データを一括登録"
                        className="ml-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-1 text-sm font-bold transition shadow-sm"
                    >
                        {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        CSVインポート
                    </button>
                    <button
                        onClick={handleDownloadTemplate}
                        title="登録用CSVフォーマット（サンプル付き）をダウンロード"
                        className="ml-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-3 py-1.5 rounded flex items-center gap-1 text-sm font-bold transition shadow-sm"
                    >
                        <FileDown size={16} /> フォーマット
                    </button>
                    {selectedIds.size > 0 && (
                        <button
                            onClick={() => setConfirmBulkDelete(true)}
                            disabled={isSaving}
                            title={`選択した${selectedIds.size}件を削除`}
                            className="ml-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-1 text-sm font-bold transition shadow-sm"
                        >
                            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            選択した {selectedIds.size} 件を削除
                        </button>
                    )}
                </div>
                
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowFilters(v => !v)}
                        aria-label={showFilters ? 'フィルターを閉じる' : 'フィルターを開く'}
                        title={showFilters ? 'フィルターを閉じる' : '項目・期間で絞り込む'}
                        className={`relative px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-bold transition border ${
                            activeFilterCount > 0 || showFilters
                                ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                    >
                        <Filter size={16} /> 絞り込み
                        {activeFilterCount > 0 && (
                            <span className="ml-0.5 bg-white text-blue-700 rounded-full text-xs font-bold px-1.5 py-0.5 leading-none min-w-[1.25rem] text-center">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>
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
            </div>

            {showFilters && (
                <div className="px-4 py-4 border-b border-slate-200 bg-white">
                    <div className="flex flex-wrap gap-x-6 gap-y-4">
                        {/* 期間フィルター */}
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold text-slate-500">年/月/日（期間）</label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="date"
                                    value={dateFrom}
                                    max={dateTo || undefined}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                    aria-label="開始日"
                                    className="px-2 py-1.5 border border-slate-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                                />
                                <span className="text-slate-400 text-sm">〜</span>
                                <input
                                    type="date"
                                    value={dateTo}
                                    min={dateFrom || undefined}
                                    onChange={(e) => setDateTo(e.target.value)}
                                    aria-label="終了日"
                                    className="px-2 py-1.5 border border-slate-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>

                        {/* テキスト系の項目フィルター */}
                        {[
                            { key: 'project_name', label: '工事名' },
                            { key: 'supplier', label: '購入先' },
                            { key: 'item_name', label: '名称' },
                            { key: 'note', label: '備考' },
                            { key: 'unit', label: '単位' },
                        ].map(({ key, label }) => (
                            <div key={key} className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-slate-500">{label}</label>
                                <select
                                    value={colFilters[key]}
                                    onChange={(e) => setColFilters(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="px-2 py-1.5 border border-slate-300 rounded text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none max-w-[12rem]"
                                >
                                    <option value="">すべて</option>
                                    {filterOptions[key].map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            </div>
                        ))}

                        {/* 数値系の項目フィルター（範囲） */}
                        {[
                            { key: 'quantity', label: '数量' },
                            { key: 'unit_price', label: '単価' },
                            { key: 'amount', label: '金額' },
                        ].map(({ key, label }) => (
                            <div key={key} className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-slate-500">{label}（範囲）</label>
                                <div className="flex items-center gap-1.5">
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="下限"
                                        value={colFilters[key].min}
                                        onChange={(e) => setColFilters(prev => ({ ...prev, [key]: { ...prev[key], min: e.target.value } }))}
                                        aria-label={`${label}の下限`}
                                        className="w-24 px-2 py-1.5 border border-slate-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                                    />
                                    <span className="text-slate-400 text-sm">〜</span>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="上限"
                                        value={colFilters[key].max}
                                        onChange={(e) => setColFilters(prev => ({ ...prev, [key]: { ...prev[key], max: e.target.value } }))}
                                        aria-label={`${label}の上限`}
                                        className="w-24 px-2 py-1.5 border border-slate-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={resetFilters}
                            disabled={activeFilterCount === 0}
                            className="px-3 py-1.5 rounded flex items-center gap-1.5 text-sm font-bold transition border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <RotateCcw size={15} /> フィルターをクリア
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowDupOnly(v => !v)}
                            disabled={!showDupOnly && !hasDuplicates}
                            aria-pressed={showDupOnly}
                            title={
                                showDupOnly
                                    ? '重複行の絞り込みを解除'
                                    : hasDuplicates
                                        ? '日付・工事名・購入先・名称・数量・単価が一致する行だけを表示（備考・金額は判定に含めません）'
                                        : '現在の絞り込み結果に重複行はありません'
                            }
                            className={`px-3 py-1.5 rounded flex items-center gap-1.5 text-sm font-bold transition border disabled:opacity-40 disabled:cursor-not-allowed ${
                                showDupOnly
                                    ? 'bg-amber-500 border-amber-500 text-white hover:bg-amber-600'
                                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                            }`}
                        >
                            <Copy size={15} /> 重複行のみ表示
                        </button>
                        <span className="text-sm text-slate-500">
                            {showDupOnly
                                ? `重複 ${dupFilteredData.length.toLocaleString()} 件 / 絞り込み ${filteredData.length.toLocaleString()} 件 / 全 ${data.length.toLocaleString()} 件`
                                : `${filteredData.length.toLocaleString()} 件 / 全 ${data.length.toLocaleString()} 件`}
                        </span>
                    </div>
                </div>
            )}

            <div className="overflow-x-auto overflow-y-auto flex-1 p-0">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-600 bg-slate-100 uppercase sticky top-0 shadow-sm z-10">
                        <tr>
                            <th className="px-3 py-3 font-bold whitespace-nowrap border-b border-slate-200 text-center w-10">
                                <button
                                    type="button"
                                    onClick={toggleSelectAllVisible}
                                    disabled={visibleRowIds.length === 0}
                                    aria-label={allVisibleChecked ? '表示中の行の選択をすべて解除' : '表示中の行をすべて選択'}
                                    title={allVisibleChecked ? '表示中の行の選択をすべて解除' : '表示中の行をすべて選択'}
                                    className="inline-flex items-center justify-center text-slate-500 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
                                >
                                    {allVisibleChecked
                                        ? <CheckSquare size={16} />
                                        : selectedIds.size > 0
                                            ? <MinusSquare size={16} />
                                            : <Square size={16} />}
                                </button>
                            </th>
                            <th className="px-4 py-3 font-bold whitespace-nowrap border-b border-slate-200 text-center w-24">操作</th>
                            {headers.map((h, i) => {
                                const active = sortConfig.key === h.key;
                                const dir = active ? sortConfig.direction : null;
                                const nextLabel = !active
                                    ? '昇順で並べ替え'
                                    : dir === 'asc'
                                        ? '降順で並べ替え'
                                        : '並べ替えを解除';
                                return (
                                    <th key={i} className="px-4 py-3 font-bold whitespace-nowrap border-b border-slate-200">
                                        <button
                                            type="button"
                                            onClick={() => handleSort(h.key)}
                                            className={`inline-flex items-center gap-1 group transition-colors ${active ? 'text-blue-600' : 'hover:text-slate-900'}`}
                                            aria-label={`${h.label}を${nextLabel}`}
                                            title={`${h.label}を${nextLabel}`}
                                        >
                                            {h.label}
                                            {!active && <ArrowUpDown size={13} className="text-slate-400 group-hover:text-slate-600" />}
                                            {active && dir === 'asc' && <ArrowUp size={13} />}
                                            {active && dir === 'desc' && <ArrowDown size={13} />}
                                        </button>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedData.length === 0 ? (
                            <tr>
                                <td colSpan={headers.length + 2} className="px-4 py-8 text-center text-slate-500 font-bold">
                                    データがありません
                                </td>
                            </tr>
                        ) : (
                            paginatedData.map((row) => {
                                const isEditing = editingRowId === row.id;
                                const dupCount = dupCountByKey.get(dupKeyOf(row)) || 0;
                                const isDup = dupCount >= 2;
                                const isChecked = selectedIds.has(row.id);
                                return (
                                <tr key={row.id} className={`border-b border-slate-100 transition-colors ${isEditing ? 'bg-blue-50/30' : isChecked ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                                    <td className="px-3 py-2 whitespace-nowrap text-center">
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleSelectRow(row.id)}
                                            aria-label={`この行を選択（${row.date || ''} ${row.project_name || ''} ${row.item_name || ''}）`}
                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                        />
                                    </td>
                                    <td className="px-2 py-2 whitespace-nowrap text-center">
                                        {isEditing ? (
                                            <div className="flex items-center justify-center gap-1">
                                                <button onClick={() => handleSaveEdit(row.id)} disabled={isSaving} className="p-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition" aria-label="保存" title="保存">
                                                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                                </button>
                                                <button onClick={handleCancelEdit} disabled={isSaving} className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 transition" aria-label="キャンセル" title="キャンセル">
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center gap-1">
                                                <button onClick={() => handleEditClick(row)} className="p-1 rounded text-blue-600 hover:bg-blue-100 transition" aria-label="編集" title="編集">
                                                    <Edit3 size={16} />
                                                </button>
                                                <button onClick={() => setConfirmDeleteId(row.id)} className="p-1 rounded text-red-600 hover:bg-red-100 transition" aria-label="削除" title="削除">
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
                                                <div className="max-w-xs truncate flex items-center gap-1" title={String(row[h.key] || '')}>
                                                    {h.key === 'item_name' && row.paint_product_id && (
                                                        <span
                                                            className="shrink-0 text-blue-500"
                                                            title={linkedPaintMap[row.paint_product_id]
                                                                ? `塗料製品: ${linkedPaintMap[row.paint_product_id].manufacturer?.name ? `[${linkedPaintMap[row.paint_product_id].manufacturer.name}] ` : ''}${linkedPaintMap[row.paint_product_id].name}`
                                                                : '塗料製品に紐付け済み'}
                                                        >
                                                            <FlaskConical size={13} />
                                                        </span>
                                                    )}
                                                    {h.key === 'project_name' && isDup && (
                                                        <span
                                                            className="shrink-0 inline-flex items-center rounded bg-amber-100 text-amber-700 text-xs font-bold px-1.5 py-0.5 leading-none"
                                                            title={`日付・工事名・購入先・名称・数量・単価が一致する行が ${dupCount} 件あります（備考・金額は判定に含めていません）`}
                                                        >
                                                            ×{dupCount}
                                                        </span>
                                                    )}
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
                        min="1"
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
                            aria-label="前のページ"
                            title="前のページ"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <button 
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages || currentPage === ''}
                            className="p-1 rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            aria-label="次のページ"
                            title="次のページ"
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
                            <button onClick={closeAddModal} aria-label="閉じる" title="閉じる" className="text-slate-400 hover:text-slate-600 transition">
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

                            {/* 塗料製品リンク（任意） */}
                            <div className="mt-4">
                                <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                    <FlaskConical size={12} className="text-blue-500" />
                                    塗料製品（任意）
                                </label>
                                {selectedPaint ? (
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-sm font-bold px-3 py-1.5 rounded-lg">
                                            <FlaskConical size={14} />
                                            {selectedPaint.manufacturer?.name ? `[${selectedPaint.manufacturer.name}] ` : ''}{selectedPaint.name}
                                            {selectedPaint.product_code && (
                                                <span className="font-mono text-xs text-blue-500">{selectedPaint.product_code}</span>
                                            )}
                                        </span>
                                        <button
                                            onClick={handleClearPaint}
                                            aria-label="塗料製品の紐付けを解除"
                                            title="塗料製品の紐付けを解除"
                                            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={paintSearch}
                                            onChange={(e) => setPaintSearch(e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                            placeholder="製品名・品番で検索して紐付け（任意）"
                                        />
                                        {paintCandidates.length > 0 && (
                                            <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                                {paintCandidates.map((p) => (
                                                    <li key={p.id}>
                                                        <button
                                                            onClick={() => handleSelectPaint(p)}
                                                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition flex items-center gap-2"
                                                        >
                                                            <FlaskConical size={14} className="text-blue-400 shrink-0" />
                                                            <span className="font-bold text-slate-700">
                                                                {p.manufacturer?.name ? `[${p.manufacturer.name}] ` : ''}{p.name}
                                                            </span>
                                                            {p.product_code && (
                                                                <span className="font-mono text-xs text-slate-400">{p.product_code}</span>
                                                            )}
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {paintSearch.trim() && paintCandidates.length === 0 && (
                                            <p className="mt-1 text-xs text-slate-400">該当する塗料製品がありません</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                            <button
                                onClick={closeAddModal}
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
            {/* CSVインポート結果モーダル */}
            {importResult && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Upload className="text-emerald-600" /> CSVインポート結果
                            </h3>
                            <button onClick={() => setImportResult(null)} aria-label="閉じる" title="閉じる" className="text-slate-400 hover:text-slate-600 transition">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1">
                            <div className="flex gap-6 mb-4 text-sm">
                                <div><span className="font-bold text-slate-500">対象行:</span> {importResult.total.toLocaleString()}</div>
                                <div><span className="font-bold text-green-600">登録:</span> {importResult.inserted.toLocaleString()}</div>
                                <div><span className="font-bold text-amber-600">スキップ:</span> {importResult.skipped.toLocaleString()}</div>
                            </div>
                            {importResult.errors.length > 0 && (
                                <div>
                                    <p className="text-xs font-bold text-slate-500 mb-1">エラー詳細（{importResult.errors.length}件）</p>
                                    <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto text-sm">
                                        {importResult.errors.map((e, i) => (
                                            <li key={i} className="px-3 py-2 text-slate-700">
                                                {e.line ? <span className="font-mono text-slate-400 mr-2">{e.line}行目</span> : null}
                                                {e.reason}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
                            <button
                                onClick={() => setImportResult(null)}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition shadow-sm"
                            >
                                閉じる
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <ConfirmModal
                isOpen={!!confirmDeleteId}
                onClose={() => setConfirmDeleteId(null)}
                onConfirm={() => { handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                title="データを削除"
                message="このデータを削除しますか？この操作は元に戻せません。"
            />
            <ConfirmModal
                isOpen={confirmBulkDelete}
                onClose={() => setConfirmBulkDelete(false)}
                onConfirm={() => { handleBulkDelete(); setConfirmBulkDelete(false); }}
                title="選択したデータを削除"
                message={`選択した ${selectedIds.size} 件を削除します。この操作は元に戻せません。`}
            />
        </div>
    );
};

export default React.memo(PurchaseLedgerTab);

