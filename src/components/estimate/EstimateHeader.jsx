import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';

// ============================================================
// 備考テンプレート一覧 ここにテンプレート文を追加
// ============================================================
const NOTE_TEMPLATES = [
  {
    label: '追加見積り（塗装）',
    text: '※別紙項目に無い塗装工事は別途追加見積り申し上げます。',
  },
  {
    label: '色相について',
    text: '※別紙お見積りの色相は「淡彩色」を想定しています。\n「⾚系」や「⻘･緑系」や「⻩･ｵﾚﾝｼﾞ系」といった濃い色相については、隠ぺい力が劣り工程増、材料高となる事から別途追加見積り申し上げます\n(屋根除く)。',
  },
];

const Label = ({ children, required }) => (
  <label className="block text-xs font-semibold text-slate-500 mb-1">
    {children}
    {required && <span className="text-red-400 ml-0.5">*</span>}
  </label>
);

const EstimateHeader = ({
  isNew,
  header,
  onChange,
  customers,
  officeStaff,
  estimateNumber,
  numberError,
  disabled,
}) => {
  const [expanded, setExpanded] = useState(isNew);

  const customerName = customers.find(c => String(c.id) === String(header.customer_id))?.name;

  // テンプレートを備考欄に挿入（既存テキストがある場合は改行して追記）
  const applyTemplate = (templateText) => {
    const current = (header.notes || '').trim();
    onChange('notes', current === '' ? templateText : `${current}\n${templateText}`);
  };

  return (
    <div className="space-y-3">
      {/* 見積番号 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-bold text-slate-700 text-sm mb-3 pb-2 border-b border-slate-100">見積番号</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text" maxLength={6} placeholder="YYMMDD"
            value={header.estimate_number_date}
            onChange={e => onChange('estimate_number_date', e.target.value)}
            className="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={disabled}
          />
          <span className="text-slate-400 font-bold">-</span>
          <input
            type="text" maxLength={4} placeholder="0001"
            value={header.estimate_number_seq}
            onChange={e => onChange('estimate_number_seq', e.target.value)}
            className="w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={disabled}
          />
          <span className="text-slate-400 font-bold">-</span>
          <input
            type="text" maxLength={3} placeholder="001"
            value={header.estimate_number_branch}
            onChange={e => onChange('estimate_number_branch', e.target.value)}
            className="w-16 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={disabled}
          />
          <span className="text-slate-500 text-sm font-mono ml-1">→ {estimateNumber}</span>
        </div>
        {numberError && <p className="text-red-500 text-xs mt-1">{numberError}</p>}
      </div>

      {/* 工事情報 アコーディオン */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0">工事情報</span>
            {!expanded && (
              <span className="text-slate-400 font-normal text-xs truncate">
                {header.title || '（工事名未入力）'} ／{' '}
                {customerName
                  ? `${customerName}${header.customer_honorific && header.customer_honorific !== 'なし' ? `　${header.customer_honorific}` : ''}`
                  : '（顧客未選択）'}
              </span>
            )}
          </div>
          {expanded
            ? <ChevronUp size={16} className="text-slate-400 shrink-0 ml-2" />
            : <ChevronDown size={16} className="text-slate-400 shrink-0 ml-2" />
          }
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <Label required>工事名</Label>
                <input
                  type="text" value={header.title}
                  onChange={e => onChange('title', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="例: 水沢中学校校舎等改築建築工事"
                  disabled={disabled}
                />
              </div>

              {/* 顧客 */}
              <div>
                <Label required>顧客</Label>
                <select
                  value={header.customer_id}
                  onChange={e => onChange('customer_id', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  disabled={disabled}
                >
                  <option value="">-- 選択してください --</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* 宛名（御中 / 様 / 殿 / なし） */}
              <div>
                <Label>宛名</Label>
                <select
                  value={header.customer_honorific}
                  onChange={e => onChange('customer_honorific', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  disabled={disabled}
                >
                  <option value="御中">御中</option>
                  <option value="様">様</option>
                  <option value="殿">殿</option>
                  <option value="なし">なし</option>
                </select>
              </div>

              {/* 工事場所 */}
              <div>
                <Label>工事場所</Label>
                <input
                  type="text" value={header.site_location}
                  onChange={e => onChange('site_location', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="例: 取り決めの通り"
                  disabled={disabled}
                />
              </div>

              {/* 工期 */}
              <div>
                <Label>工期</Label>
                <input
                  type="text" value={header.work_period}
                  onChange={e => onChange('work_period', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="例: 取り決めの通り / 令和7年3月末"
                  disabled={disabled}
                />
              </div>

              <div>
                <Label>見積日</Label>
                <input
                  type="date" value={header.issue_date}
                  onChange={e => onChange('issue_date', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  disabled={disabled}
                />
              </div>

              <div>
                <Label>有効期限</Label>
                <input
                  type="date" value={header.valid_until}
                  onChange={e => onChange('valid_until', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  disabled={disabled}
                />
              </div>

              <div>
                <Label>支払条件</Label>
                <input
                  type="text" value={header.payment_terms}
                  onChange={e => onChange('payment_terms', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  disabled={disabled}
                />
              </div>

              <div>
                <Label>担当者</Label>
                <select
                  value={header.staff_id}
                  onChange={e => onChange('staff_id', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  disabled={disabled}
                >
                  <option value="">-- 選択 --</option>
                  {officeStaff.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>

              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <Label>備考</Label>
                  {/* テンプレート挿入ボタン群（編集可能時のみ表示） */}
                  {!disabled && (
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
                        <ClipboardList size={11} />
                        テンプレート：
                      </span>
                      {NOTE_TEMPLATES.map((tpl, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => applyTemplate(tpl.text)}
                          title={tpl.text}
                          className="text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-400 px-2 py-0.5 rounded transition whitespace-nowrap"
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <textarea
                  value={header.notes}
                  onChange={e => onChange('notes', e.target.value)}
                  rows={4}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                  placeholder="備考・特記事項"
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EstimateHeader;
