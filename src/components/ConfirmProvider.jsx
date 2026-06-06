import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import ConfirmModal from './ConfirmModal';
import PromptModal from './PromptModal';

const ConfirmContext = createContext(null);

/**
 * window.confirm / window.prompt の代替となる imperative なダイアログ。
 *
 *   const { confirm, prompt } = useConfirm();
 *   if (!await confirm({ title: '削除', message: '本当に？' })) return;
 *   const name = await prompt({ title: '名称', placeholder: '...' });
 *
 * confirm は Promise<boolean>、prompt は Promise<string|null> を返す。
 */
export const ConfirmProvider = ({ children }) => {
    const [dialog, setDialog] = useState(null);
    const resolverRef = useRef(null);

    const settle = useCallback((result) => {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        setDialog(null);
        resolve?.(result);
    }, []);

    const confirm = useCallback((options = {}) => {
        const opts = typeof options === 'string' ? { message: options } : options;
        return new Promise((resolve) => {
            resolverRef.current = resolve;
            setDialog({ kind: 'confirm', ...opts });
        });
    }, []);

    const prompt = useCallback((options = {}) => {
        const opts = typeof options === 'string' ? { title: options } : options;
        return new Promise((resolve) => {
            resolverRef.current = resolve;
            setDialog({ kind: 'prompt', ...opts });
        });
    }, []);

    return (
        <ConfirmContext.Provider value={{ confirm, prompt }}>
            {children}
            {dialog?.kind === 'confirm' && (
                <ConfirmModal
                    isOpen
                    title={dialog.title}
                    message={dialog.message}
                    confirmText={dialog.confirmText}
                    cancelText={dialog.cancelText}
                    variant={dialog.variant || 'danger'}
                    onClose={() => settle(false)}
                    onConfirm={() => settle(true)}
                />
            )}
            {dialog?.kind === 'prompt' && (
                <PromptModal
                    isOpen
                    title={dialog.title}
                    message={dialog.message}
                    defaultValue={dialog.defaultValue}
                    placeholder={dialog.placeholder}
                    confirmText={dialog.confirmText}
                    cancelText={dialog.cancelText}
                    onCancel={() => settle(null)}
                    onConfirm={(value) => settle(value)}
                />
            )}
        </ConfirmContext.Provider>
    );
};

export const useConfirm = () => {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirm must be used within a ConfirmProvider');
    }
    return ctx;
};
