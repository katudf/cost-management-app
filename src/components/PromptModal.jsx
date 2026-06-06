import React, { useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';

const PromptModal = ({
    isOpen,
    onCancel,
    onConfirm,
    title,
    message,
    defaultValue = '',
    placeholder = '',
    confirmText = '追加する',
    cancelText = 'キャンセル',
}) => {
    const [value, setValue] = useState(defaultValue);
    const inputRef = useRef(null);
    const dialogRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue);
            // マウント直後にフォーカス＆全選択
            requestAnimationFrame(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            });
        }
    }, [isOpen, defaultValue]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    const submit = () => {
        const trimmed = value.trim();
        if (!trimmed) return; // 空入力は確定不可
        onConfirm?.(trimmed);
    };

    const handleTrapKeyDown = (e) => {
        if (e.key !== 'Tab') return;
        const focusable = dialogRef.current?.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onCancel}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="prompt-modal-title"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleTrapKeyDown}
                className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200"
            >
                <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-blue-100 text-blue-600">
                            <Pencil size={22} />
                        </div>
                        <button
                            onClick={onCancel}
                            aria-label="閉じる"
                            title="閉じる"
                            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <h3 id="prompt-modal-title" className="text-xl font-bold text-slate-900 mb-2">{title}</h3>
                    {message && <p className="text-slate-600 leading-relaxed mb-3 whitespace-pre-line">{message}</p>}

                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        placeholder={placeholder}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                submit();
                            }
                        }}
                        className="w-full h-12 px-4 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-base"
                    />
                </div>

                <div className="bg-slate-50 p-6 flex gap-3 justify-end border-t border-slate-100">
                    <button
                        onClick={onCancel}
                        className="px-6 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-all border border-slate-200 active:scale-95"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={submit}
                        disabled={!value.trim()}
                        className="px-6 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PromptModal;
