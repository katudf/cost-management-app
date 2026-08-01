import React, { useState } from 'react';
import { FileText, Layers, Trash2, Plus } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';

/**
 * 左ナビゲーション。
 * 鑑（cover）と各シートを一覧表示し、クリックで該当紙面へ scrollIntoView する。
 * シート削除はゴミ箱アイコン＋ConfirmModal。シート0（トップシート）は削除不可。
 *
 * props:
 *   - sheets: [{ id, title }]
 *   - items: フラット明細（シートごとのページ数計算に使用。将来利用。現状は件数表示のみ）
 *   - activeAnchor: 現在アクティブなアンカー ('cover' | 'sheet-0' | ...)（任意）
 *   - onDeleteSheet: (sheetIndex) => void   （index 0 は「総括表」の場合のみ呼ばれる）
 *   - onAddSheet: () => void
 *   - isLocked: boolean  ロック時は削除・追加を無効化
 */
const scrollToAnchor = (anchorId) => {
    const el = document.getElementById(anchorId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export default function PageNav({
    sheets = [],
    items = [],
    activeAnchor,
    onDeleteSheet,
    onAddSheet,
    isLocked = false,
}) {
    // 削除確認モーダルの状態（対象シートindex）
    const [pendingDelete, setPendingDelete] = useState(null);

    const itemCountForSheet = (sheetId) =>
        items.filter((it) => it.sheet_id === sheetId).length;

    const navBtnBase =
        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors';

    const isActive = (anchor) => activeAnchor === anchor;

    return (
        <nav className="w-40 shrink-0 sticky top-0 z-10 self-start py-3 pr-1">
            <div className="text-xs font-bold text-slate-400 px-3 mb-2 uppercase tracking-wide">
                ページ
            </div>

            {/* 鑑（cover） */}
            <button
                type="button"
                onClick={() => scrollToAnchor('paper-cover')}
                className={`${navBtnBase} mb-1 ${
                    isActive('cover')
                        ? 'bg-blue-100 text-blue-700 font-bold'
                        : 'text-slate-600 hover:bg-slate-100'
                }`}
                title="鑑（表紙）へ移動"
            >
                <FileText size={16} className="shrink-0" />
                <span className="truncate">鑑</span>
            </button>

            {/* シート一覧 */}
            <ul className="space-y-1">
                {sheets.map((sheet, idx) => {
                    const anchor = `sheet-${idx}`;
                    const count = itemCountForSheet(sheet.id);
                    const isSummarySheet = idx === 0 && sheet.title === '総括表';
                    const canDelete = (idx !== 0 || isSummarySheet) && !isLocked;
                    return (
                        <li key={sheet.id ?? idx} className="group flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => scrollToAnchor(`paper-sheet-${idx}`)}
                                className={`${navBtnBase} flex-1 min-w-0 ${
                                    isActive(anchor)
                                        ? 'bg-blue-100 text-blue-700 font-bold'
                                        : 'text-slate-600 hover:bg-slate-100'
                                }`}
                                title={`${sheet.title || '見積内訳明細書'} へ移動`}
                            >
                                <Layers size={16} className="shrink-0" />
                                <span className="truncate">
                                    {sheet.title || `明細 ${idx + 1}`}
                                </span>
                                {count > 0 && (
                                    <span className="ml-auto text-[10px] text-slate-400 shrink-0">
                                        {count}
                                    </span>
                                )}
                            </button>
                            {canDelete && (
                                <button
                                    type="button"
                                    onClick={() => setPendingDelete(idx)}
                                    aria-label={`${sheet.title || 'シート'}を削除`}
                                    title="このシートを削除"
                                    className="p-1.5 rounded-md text-slate-300 hover:text-red-600 hover:bg-red-50 opacity-60 group-hover:opacity-100 transition-all shrink-0"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            {/* シート追加 */}
            {!isLocked && (
                <button
                    type="button"
                    onClick={onAddSheet}
                    className="w-full mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-500 border border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="内訳明細シートを追加"
                >
                    <Plus size={15} />
                    ページ追加
                </button>
            )}

            <ConfirmModal
                isOpen={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => {
                    if (pendingDelete !== null) onDeleteSheet?.(pendingDelete);
                    setPendingDelete(null);
                }}
                title="シートを削除しますか？"
                message={
                    pendingDelete !== null
                        ? `「${
                              sheets[pendingDelete]?.title || '見積内訳明細書'
                          }」とその明細をすべて削除します。${
                              pendingDelete === 0 ? '削除後、先頭シートは次の明細シートに切り替わります。' : ''
                          }この操作は保存するまで元に戻せます。`
                        : ''
                }
                confirmText="削除する"
                variant="danger"
            />
        </nav>
    );
}
