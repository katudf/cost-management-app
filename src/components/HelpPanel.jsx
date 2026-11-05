import React, { useEffect } from 'react';
import { X, HelpCircle } from 'lucide-react';
import IconButton from './IconButton';
import { HELP_CONTENT } from '../utils/helpContent';

/**
 * 管理者画面のタブ別ヘルプ（右側スライドパネル）。
 * 背面は操作可能なまま（オーバーレイなし）。閉じるのは×ボタンと Esc キーのみ。
 */
const HelpPanel = ({ isOpen, tabKey, onClose }) => {
    useEffect(() => {
        if (!isOpen) return undefined;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const help = HELP_CONTENT[tabKey];

    return (
        <aside
            role="complementary"
            aria-label="ヘルプ"
            className="fixed top-0 right-0 z-40 h-full w-full sm:w-96 bg-white border-l border-slate-200 shadow-2xl flex flex-col"
        >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                <h2 className="flex items-center gap-2 font-bold text-slate-800">
                    <HelpCircle size={18} className="text-blue-600" />
                    {help ? `ヘルプ：${help.title}` : 'ヘルプ'}
                </h2>
                <IconButton label="ヘルプを閉じる" onClick={onClose}>
                    <X size={18} />
                </IconButton>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 text-sm text-slate-700 space-y-5">
                {!help ? (
                    <p className="text-slate-500">この画面のヘルプはまだありません。</p>
                ) : (
                    <>
                        <p className="leading-relaxed">{help.summary}</p>

                        {help.steps?.length > 0 && (
                            <section>
                                <h3 className="font-bold text-slate-800 mb-2">主な操作</h3>
                                <ul className="space-y-2">
                                    {help.steps.map((s, i) => (
                                        <li key={i} className="flex gap-2 leading-relaxed">
                                            <span className="text-blue-500 shrink-0">●</span>
                                            <span>{s}</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {help.notes?.length > 0 && (
                            <section>
                                <h3 className="font-bold text-slate-800 mb-2">注意点</h3>
                                <ul className="space-y-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
                                    {help.notes.map((n, i) => (
                                        <li key={i} className="flex gap-2 leading-relaxed text-amber-900">
                                            <span className="shrink-0">!</span>
                                            <span>{n}</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </>
                )}
            </div>

            <div className="px-4 py-2 border-t border-slate-200 text-xs text-slate-400">
                Esc キーでも閉じられます
            </div>
        </aside>
    );
};

export default HelpPanel;
