// src/estimate-editor/CustomerCombobox.jsx
// 顧客選択コンボボックス（名称フィルター + 新規顧客追加）。
// 移植元: src/components/estimate/EstimateHeader.jsx の CustomerCombobox（Phase 7 で旧側は削除予定）。
import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ChevronDown, Search, Plus, X, Check } from 'lucide-react';

const CustomerCombobox = ({ customers, value, onChange, onCreateCustomer, disabled }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = useId();
  const optionId = (id) => `${listboxId}-opt-${id}`;

  const selected = customers.find(c => String(c.id) === String(value));

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(q));
  }, [customers, query]);

  useEffect(() => {
    setHighlightIdx(-1);
  }, [query, open]);

  const openDropdown = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setCreating(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (c) => {
    onChange(String(c.id));
    setOpen(false);
    setQuery('');
  };

  const startCreating = (prefillName) => {
    setCreating(true);
    setNewName(prefillName || '');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSearchKeyDown = (e) => {
    if (e.isComposing || e.nativeEvent?.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => (i + 1 < filtered.length ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => (i - 1 >= 0 ? i - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && filtered[highlightIdx]) {
        handleSelect(filtered[highlightIdx]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  const handleCreateSubmit = async () => {
    const trimmed = newName.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const created = await onCreateCustomer(trimmed);
      if (created) {
        setOpen(false);
        setCreating(false);
        setQuery('');
        setNewName('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white disabled:bg-slate-50 disabled:text-slate-400 text-left"
      >
        <span className={selected ? 'text-slate-800 truncate' : 'text-slate-400 truncate'}>
          {selected ? selected.name : '-- 選択してください --'}
        </span>
        <ChevronDown size={15} className="text-slate-400 shrink-0 ml-2" />
      </button>

      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          {!creating ? (
            <>
              <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-slate-100">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={highlightIdx >= 0 && filtered[highlightIdx] ? optionId(filtered[highlightIdx].id) : undefined}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="顧客名で絞り込み"
                  className="w-full text-sm focus:outline-none"
                />
              </div>
              <ul id={listboxId} role="listbox" aria-label="顧客一覧" className="max-h-52 overflow-y-auto py-1">
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-xs text-slate-400">該当する顧客がありません</li>
                )}
                {filtered.map((c, idx) => (
                  <li key={c.id} id={optionId(c.id)} role="option" aria-selected={String(c.id) === String(value)}>
                    <button
                      type="button"
                      onClick={() => handleSelect(c)}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition ${idx === highlightIdx ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
                    >
                      <span className="truncate">{c.name}</span>
                      {String(c.id) === String(value) && <Check size={14} className="text-blue-600 shrink-0 ml-2" />}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => startCreating(query)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 border-t border-slate-100 transition"
              >
                <Plus size={14} />
                新規顧客を追加
              </button>
            </>
          ) : (
            <div className="p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">新規顧客名</span>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  aria-label="新規顧客の追加をキャンセル"
                  title="新規顧客の追加をキャンセル"
                  className="p-0.5 rounded hover:bg-slate-100 text-slate-400"
                >
                  <X size={14} />
                </button>
              </div>
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateSubmit(); } }}
                placeholder="例: 株式会社〇〇"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                type="button"
                onClick={handleCreateSubmit}
                disabled={!newName.trim() || saving}
                className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition"
              >
                <Plus size={14} />
                {saving ? '登録中...' : 'この名前で登録して選択'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CustomerCombobox;
