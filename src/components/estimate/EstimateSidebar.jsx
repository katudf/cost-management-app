import React, { useState } from 'react';
import { Save, Unlock, ChevronDown, ChevronUp, Lock, UserCheck, Send, Trophy, XCircle } from 'lucide-react';
import { ESTIMATE_STATUS, ESTIMATE_STATUS_LABEL } from '../../utils/constants';
import { formatCurrency } from '../../supabaseEstimates';
import EstimateApprovalModal from './EstimateApprovalModal';
import EstimateLostReasonModal from './EstimateLostReasonModal';
import EstimateSubmitModal from './EstimateSubmitModal';

// "2026-07-08T01:23:45.000Z" -> "2026/07/08 10:23"
const formatDateTime = (val) => {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATUS_BADGES = [
  {
    value: ESTIMATE_STATUS.DRAFT,
    label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.DRAFT],
    base: 'border-slate-300 text-slate-600',
    active: 'bg-slate-600 text-white border-slate-600',
    hover: 'hover:bg-slate-100',
  },
  {
    value: ESTIMATE_STATUS.PENDING,
    label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.PENDING],
    base: 'border-amber-300 text-amber-700',
    active: 'bg-amber-500 text-white border-amber-500',
    hover: 'hover:bg-amber-50',
  },
  {
    value: ESTIMATE_STATUS.APPROVED,
    label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.APPROVED],
    base: 'border-green-300 text-green-700',
    active: 'bg-green-600 text-white border-green-600',
    hover: 'hover:bg-green-50',
  },
  {
    value: ESTIMATE_STATUS.RETURNED,
    label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.RETURNED],
    base: 'border-red-300 text-red-700',
    active: 'bg-red-500 text-white border-red-500',
    hover: 'hover:bg-red-50',
  },
];

const EstimateSidebar = ({
  totals,
  header,
  onChange,
  saving,
  isLocked,
  onSave,
  onUnlock,
  officeStaff = [],
  currentStaff = null,
  onApprove,
  onReturn,
  onSubmit,
  onSubmitToCustomer,
  onOrder,
  onLose,
}) => {
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const [approvalModalMode, setApprovalModalMode] = useState(null); // 'approved' | 'returned' | null
  const [lostModalOpen, setLostModalOpen] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);

  const approverStaff = officeStaff.find(s => s.id === header.approver_staff_id);
  // 申請中で承認者が未指名の場合は誰も承認できない。指名済みなら本人のみ承認・差し戻し可能。
  const isDesignatedApprover = header.status === ESTIMATE_STATUS.PENDING
    && !!header.approver_staff_id
    && currentStaff?.id === header.approver_staff_id;

  const handleBadgeClick = (value) => {
    if (isLocked) return;
    if (value === ESTIMATE_STATUS.APPROVED || value === ESTIMATE_STATUS.RETURNED) {
      // 申請中以外からの直接遷移、または指名された承認者以外からの操作は不可
      if (header.status !== ESTIMATE_STATUS.PENDING || !isDesignatedApprover) return;
      setApprovalModalMode(value);
      return;
    }
    if (value === ESTIMATE_STATUS.PENDING) {
      setSubmitModalOpen(true);
      return;
    }
    onChange('status', value);
  };

  const handleSubmitConfirm = (approverStaffId) => {
    onSubmit?.(approverStaffId);
    setSubmitModalOpen(false);
  };

  const handleApprovalConfirm = (payload) => {
    if (approvalModalMode === ESTIMATE_STATUS.APPROVED) {
      onApprove?.();
    } else if (approvalModalMode === ESTIMATE_STATUS.RETURNED) {
      onReturn?.(payload.reason);
    }
    setApprovalModalMode(null);
  };

  const handleLostConfirm = (reason) => {
    onLose?.(reason);
    setLostModalOpen(false);
  };

  return (
    <div className="space-y-3">
      {/* ===== スティッキーパネル ===== */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sticky top-4 space-y-4">

        {/* 金額集計 */}
        <div>
          <h3 className="font-bold text-slate-700 text-sm mb-3 pb-2 border-b border-slate-100">金額集計</h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between items-center font-bold text-slate-800">
              <span>工事費</span>
              <span className="font-mono">¥{formatCurrency(totals.subtotal)}-</span>
            </div>
            <div className="flex justify-between items-center text-slate-600">
              <span>消費税（{Math.round(Number(header.tax_rate) * 100)}%）</span>
              <span className="font-mono">¥{formatCurrency(totals.tax)}-</span>
            </div>
            <div className="border-t border-slate-300 my-1" />
            <div className="flex justify-between items-center font-bold text-slate-800">
              <span className="text-base">税込合計</span>
              <span className="font-mono text-lg text-blue-600">¥{formatCurrency(totals.total)}-</span>
            </div>
            {header.show_net && (
              <>
                <div className="border-t border-slate-300 my-1" />
                <div className="flex justify-between items-center font-bold text-slate-800">
                  <span>NET金額</span>
                  <span className="font-mono">¥{formatCurrency(totals.net)}-</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ステータス（バッジ型4択） */}
        <div>
          <p className="text-xs font-bold text-slate-500 mb-2">ステータス</p>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_BADGES.map(({ value, label, base, active, hover }) => {
              // 提出済/受注/失注は「承認」の下位状態のため、承認バッジをアクティブ表示で流用する
              const isActive = value === ESTIMATE_STATUS.APPROVED
                ? [ESTIMATE_STATUS.APPROVED, ESTIMATE_STATUS.SUBMITTED, ESTIMATE_STATUS.ORDERED, ESTIMATE_STATUS.LOST].includes(header.status)
                : header.status === value;
              const badgeLabel = value === ESTIMATE_STATUS.APPROVED && header.status !== ESTIMATE_STATUS.APPROVED && isActive
                ? `${label}（${ESTIMATE_STATUS_LABEL[header.status]}）`
                : label;
              // 承認・差し戻しバッジは、申請中かつ指名された承認者本人以外は操作不可
              const isApprovalAction = value === ESTIMATE_STATUS.APPROVED || value === ESTIMATE_STATUS.RETURNED;
              const badgeDisabled = isLocked || (isApprovalAction && !isActive && !isDesignatedApprover);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleBadgeClick(value)}
                  disabled={badgeDisabled}
                  title={isApprovalAction && !isActive && !isDesignatedApprover ? '指名された承認者のみ操作できます' : undefined}
                  className={`px-2.5 py-1 rounded-full text-xs font-bold border transition ${
                    isActive
                      ? active
                      : `bg-white ${base} ${badgeDisabled ? '' : hover}`
                  } ${badgeDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {badgeLabel}
                </button>
              );
            })}
          </div>

          {/* 申請中: 指名した承認者の表示 */}
          {header.status === ESTIMATE_STATUS.PENDING && approverStaff && (
            <p className="text-xs text-amber-700 flex items-center gap-1 mt-2">
              <UserCheck size={12} />
              承認依頼中: {approverStaff.name}
              {isDesignatedApprover && <span className="ml-1 text-amber-600">（あなたが承認者です）</span>}
            </p>
          )}

          {/* 承認・差し戻しの証跡表示 */}
          {header.approved_by && [ESTIMATE_STATUS.APPROVED, ESTIMATE_STATUS.SUBMITTED, ESTIMATE_STATUS.ORDERED, ESTIMATE_STATUS.LOST].includes(header.status) && (
            <p className="text-xs text-green-700 flex items-center gap-1 mt-2">
              <UserCheck size={12} />
              {header.approved_by} が承認（{formatDateTime(header.approved_at)}）
            </p>
          )}
          {header.status === ESTIMATE_STATUS.RETURNED && header.returned_reason && (
            <p className="text-xs text-red-600 mt-2 leading-relaxed whitespace-pre-line">
              差し戻し理由: {header.returned_reason}
            </p>
          )}
          {header.status === ESTIMATE_STATUS.LOST && header.lost_reason && (
            <p className="text-xs text-red-600 mt-2 leading-relaxed whitespace-pre-line">
              失注理由: {header.lost_reason}
            </p>
          )}

          {/* 受注管理フロー（承認後のみ表示。提出済→受注/失注の一方向） */}
          {header.status === ESTIMATE_STATUS.APPROVED && (
            <button
              type="button"
              onClick={onSubmitToCustomer}
              className="mt-3 w-full flex items-center justify-center gap-1.5 border border-blue-300 text-blue-700 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg text-xs font-bold transition"
            >
              <Send size={13} />
              提出済にする
            </button>
          )}
          {header.status === ESTIMATE_STATUS.SUBMITTED && (
            <div className="mt-3 flex gap-1.5">
              <button
                type="button"
                onClick={onOrder}
                className="flex-1 flex items-center justify-center gap-1.5 border border-green-300 text-green-700 hover:bg-green-50 px-2.5 py-1.5 rounded-lg text-xs font-bold transition"
              >
                <Trophy size={13} />
                受注
              </button>
              <button
                type="button"
                onClick={() => setLostModalOpen(true)}
                className="flex-1 flex items-center justify-center gap-1.5 border border-red-300 text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg text-xs font-bold transition"
              >
                <XCircle size={13} />
                失注
              </button>
            </div>
          )}
          {(header.status === ESTIMATE_STATUS.ORDERED || header.status === ESTIMATE_STATUS.LOST) && (
            <p className={`text-xs mt-2 font-bold ${header.status === ESTIMATE_STATUS.ORDERED ? 'text-green-700' : 'text-red-600'}`}>
              {ESTIMATE_STATUS_LABEL[header.status]}で確定済み
            </p>
          )}
        </div>

        {/* 保存ボタン */}
        <div className="space-y-2 pt-1">
          {isLocked && (
            <button
              onClick={onUnlock}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white px-4 py-2 rounded-lg font-bold transition text-sm"
            >
              <Unlock size={15} />
              下書きに戻す
            </button>
          )}
          <button
            onClick={onSave}
            disabled={saving || isLocked}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2.5 rounded-lg font-bold transition"
          >
            <Save size={17} />
            {saving ? '保存中...' : '保存'}
          </button>
          {isLocked && (
            <p className="text-xs text-amber-600 flex items-center gap-1 justify-center">
              <Lock size={11} />
              {ESTIMATE_STATUS_LABEL[header.status] || header.status}のため編集不可
            </p>
          )}
        </div>
      </div>

      {/* ===== 消費税率 ===== */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-bold text-slate-700 text-sm mb-3">消費税率</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={Math.round(Number(header.tax_rate) * 100)}
            onChange={e => onChange('tax_rate', Number(e.target.value) / 100)}
            className="w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <span className="text-slate-500 text-sm">%</span>
        </div>
      </div>

      {/* ===== NET計算設定（show_net=ON 時のみ） ===== */}
      {header.show_net && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="font-bold text-slate-700 text-sm mb-3">NET計算設定</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="net_type"
                  checked={header.net_calc_type === 'perc' || header.net_calc_type === 'auto'}
                  onChange={() => onChange('net_calc_type', 'perc')}
                  className="text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <span className="text-xs text-slate-600">％指定</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="net_type"
                  checked={header.net_calc_type === 'manual'}
                  onChange={() => onChange('net_calc_type', 'manual')}
                  className="text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <span className="text-xs text-slate-600">手入力</span>
              </label>
            </div>
            {header.net_calc_type !== 'manual' ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={header.net_perc}
                  onChange={e => onChange('net_perc', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-400"
                  placeholder="パーセント"
                />
                <span className="text-xs text-slate-500 shrink-0">%</span>
              </div>
            ) : (
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">¥</span>
                <input
                  type="number"
                  min="0"
                  value={header.net_amount}
                  onChange={e => onChange('net_amount', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg pl-6 pr-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-400"
                  placeholder="金額を入力"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== PDF表示設定 アコーディオン ===== */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setPdfExpanded(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
        >
          <span>PDF表示設定</span>
          {pdfExpanded
            ? <ChevronUp size={16} className="text-slate-400" />
            : <ChevronDown size={16} className="text-slate-400" />
          }
        </button>
        {pdfExpanded && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-100 space-y-2 text-sm">
            {[
              { key: 'show_fixed_fees', label: '法定福利費・安全費を表示' },
              { key: 'show_net',        label: 'NET金額を表示' },
              { key: 'show_subtotals',  label: '工種ごとに合計行を表示' },
              { key: 'show_approver',   label: '上長印欄を表示' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={header[key]}
                  onChange={e => onChange(key, e.target.checked)}
                  className="rounded"
                />
                <span className="text-slate-600">{label}</span>
              </label>
            ))}
            <div className="mt-2">
              <p className="text-xs font-semibold text-slate-500 mb-1">社印</p>
              <select
                value={header.stamp_header}
                onChange={e => onChange('stamp_header', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="company">社印</option>
                <option value="representative">代表印</option>
                <option value="none">表示しない</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {approvalModalMode && (
        <EstimateApprovalModal
          mode={approvalModalMode}
          currentStaff={currentStaff}
          onConfirm={handleApprovalConfirm}
          onCancel={() => setApprovalModalMode(null)}
        />
      )}

      {lostModalOpen && (
        <EstimateLostReasonModal
          onConfirm={handleLostConfirm}
          onCancel={() => setLostModalOpen(false)}
        />
      )}

      {submitModalOpen && (
        <EstimateSubmitModal
          officeStaff={officeStaff}
          onConfirm={handleSubmitConfirm}
          onCancel={() => setSubmitModalOpen(false)}
        />
      )}
    </div>
  );
};

export default EstimateSidebar;
