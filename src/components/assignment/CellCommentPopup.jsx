import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useConfirm } from '../ConfirmProvider';

/**
 * 配置表バーチャートのセル（案件×日付）コメント編集ポップアップ。
 * Ctrl+Enter で保存、Esc で閉じる。
 */
const CellCommentPopup = ({ editCommentCell, onClose, onSave, onDelete }) => {
    const { confirm } = useConfirm();
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const textareaRef = useRef(null);

    useEffect(() => {
        if (!editCommentCell) return;
        setText(editCommentCell.comment || '');
        // 開いた直後に入力できるようフォーカス
        requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (el) {
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
            }
        });
    }, [editCommentCell]);

    if (!editCommentCell) return null;

    const { projectId, projectName, dateStr, comment: existing } = editCommentCell;

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        const ok = await onSave(projectId, dateStr, text);
        setSaving(false);
        if (ok) onClose();
    };

    const handleDelete = async () => {
        const ok = await confirm({ title: 'コメント削除', message: 'このセルのコメントを削除しますか？' });
        if (!ok) return;
        setSaving(true);
        const done = await onDelete(projectId, dateStr);
        setSaving(false);
        if (done) onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSave();
        }
    };

    return (
        <div
            className="absolute z-50 bg-white rounded-xl shadow-2xl border border-slate-200 w-64 overflow-hidden"
            style={{
                top: `${editCommentCell.top + 4}px`,
                left: `${Math.max(0, editCommentCell.left - 50)}px`
            }}
        >
            <div className="bg-slate-700 text-white px-3 py-2 flex items-center justify-between gap-2">
                <div className="text-xs font-bold truncate">
                    {dateStr.slice(5).replace('-', '/')} {projectName}
                </div>
                <button
                    onClick={onClose}
                    aria-label="閉じる"
                    title="閉じる"
                    className="p-0.5 hover:bg-slate-600 rounded transition flex-shrink-0"
                >
                    <X size={14} />
                </button>
            </div>
            <div className="p-2 flex flex-col gap-2">
                <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={4}
                    maxLength={500}
                    placeholder="コメントを入力（Ctrl+Enterで保存）"
                    className="w-full text-sm border border-slate-300 rounded p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <div className="flex items-center justify-between">
                    {existing ? (
                        <button
                            onClick={handleDelete}
                            disabled={saving}
                            aria-label="コメントを削除"
                            title="コメントを削除"
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-50"
                        >
                            <Trash2 size={14} />
                        </button>
                    ) : <span />}
                    <div className="flex gap-1">
                        <button
                            onClick={onClose}
                            className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded"
                        >
                            キャンセル
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="px-3 py-1 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
                        >
                            保存
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CellCommentPopup;
