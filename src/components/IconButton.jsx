import React from 'react';

/**
 * アイコンのみのボタン用共通コンポーネント。
 * label は必須で aria-label / title に自動付与され、スクリーンリーダー対応を強制する。
 *
 *   <IconButton label="削除" onClick={...}><Trash2 size={18} /></IconButton>
 */
const VARIANTS = {
    default: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
    primary: 'text-blue-600 hover:bg-blue-50',
    danger: 'text-red-500 hover:bg-red-50 hover:text-red-600',
    ghost: 'text-slate-400 hover:text-slate-600',
};

const IconButton = ({
    label,
    onClick,
    children,
    variant = 'default',
    type = 'button',
    disabled = false,
    className = '',
    ...rest
}) => {
    if (!label && process.env.NODE_ENV !== 'production') {
        console.warn('IconButton: `label` prop is required for accessibility.');
    }
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={`inline-flex items-center justify-center p-2 rounded-lg transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant] || VARIANTS.default} ${className}`}
            {...rest}
        >
            {children}
        </button>
    );
};

export default IconButton;
