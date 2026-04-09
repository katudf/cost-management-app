import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const showToast = useCallback((message, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
                {toasts.map(toast => (
                    <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
                ))}
            </div>
        </ToastContext.Provider>
    );
};

const ToastItem = ({ toast, onRemove }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // トリガーでアニメーション開始
        requestAnimationFrame(() => setIsVisible(true));
        
        const timer = setTimeout(() => {
            setIsVisible(false);
            setTimeout(() => onRemove(toast.id), 300); // Wait for fade out
        }, 5000);

        return () => clearTimeout(timer);
    }, [toast.id, onRemove]);

    const bgClass = toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                   toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
                   'bg-blue-50 border-blue-200 text-blue-800';

    const Icon = toast.type === 'error' ? AlertCircle :
                 toast.type === 'success' ? CheckCircle2 :
                 Info;

    const iconColor = toast.type === 'error' ? 'text-red-500' :
                      toast.type === 'success' ? 'text-green-500' :
                      'text-blue-500';

    return (
        <div 
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-lg border shadow-lg w-80 max-w-[90vw] transition-all duration-300 ease-out transform ${
                isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
            } ${bgClass}`}
        >
            <Icon className={`mt-0.5 shrink-0 ${iconColor}`} size={18} />
            <div className="flex-1 text-sm font-medium pr-2">
                {toast.message}
            </div>
            <button 
                onClick={() => {
                    setIsVisible(false);
                    setTimeout(() => onRemove(toast.id), 300);
                }} 
                className="text-slate-400 hover:text-slate-600 transition shrink-0"
            >
                <X size={16} />
            </button>
        </div>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
