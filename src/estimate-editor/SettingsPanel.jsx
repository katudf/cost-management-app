import React, { useState } from 'react';
import { Save, Unlock, ChevronDown, ChevronUp, Lock, UserCheck, Send, Trophy, XCircle, RefreshCw, Download, LayoutList } from 'lucide-react';
import { ESTIMATE_STATUS, ESTIMATE_STATUS_LABEL } from '../utils/constants';
import { formatCurrency } from '../supabaseEstimates';
import EstimateApprovalModal from '../components/estimate/EstimateApprovalModal';
import EstimateLostReasonModal from '../components/estimate/EstimateLostReasonModal';
import EstimateSubmitModal from '../components/estimate/EstimateSubmitModal';
import ImportItemsModal from '../components/estimate/ImportItemsModal';
import ConfirmModal from '../components/ConfirmModal';

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
    label: '承認', // サイドバーのボタン表示のみ短縮（一覧・フィルタ等の「承認済」表記はESTIMATE_STATUS_LABELのまま維持）
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

/**
 * 右設定パネル。
 * EstimateSidebar.jsx を全セクション・モーダルごと移植し、以下を追加：
 *   - 見積番号エラー（numberError）＋再採番ボタン
 *   - 「過去見積から取込」ボタン（ImportItemsModal → onImportGroups でトップシートへ追記）
 *   - PDFプレビュー起動ボタン
 *
 * props:
 *   - totals, header, onChange, saving, isLocked
 *   - onSave, onUnlock
 *   - officeStaff, currentStaff
 *   - onApprove, onReturn, onSubmit, onSubmitToCustomer, onOrder, onLose
 *   - numberError: string   見積番号の重複・形式エラー文言
 *   - onReissueNumber: () => void  空き枝番の自動採番
 *   - onImportGroups: (groups) => void  過去見積グループの取込（EstimateEditor側でトップシートへ追記）
 *   - onGenerateSummary: () => void  総括表シートの自動生成（各カテゴリ小計を②リンクで引く）
 *   - currentEstimateId: number|null  取込モーダルで自分自身を除外するため
 *   - onOpenPreview: () => void
 */
const SettingsPanel = ({
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
  numberError = '',
  onReissueNumber,
  onImportGroups,
  onGenerateSummary,
  currentEstimateId = null,
  onOpenPreview,
}) => {
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const [approvalModalMode, setApprovalModalMode] = useState(null); // 'approved' | 'returned' | null
  const [lostModalOpen, setLostModalOpen] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  // 「提出済にする」「受注」は一度押すとステータスが進み、保存とは別に確定してしまうため、
  // 誤操作防止のワンクッションとして確認モーダルを挟む（'submit-to-customer' | 'order' | null）
  const [pendingStatusAction, setPendingStatusAction] = useState(null);

  const approverStaff = officeStaff.find(s => s.id === header.approver_staff_id);
  // 申請中で承認者が未指名の場合は誰も承認できない。指名済みなら本人のみ承認・差し戻し可能。
  const isDesignatedApprover = header.status === ESTIMATE_STATUS.PENDING
    && !!header.approver_staff_id
    && currentStaff?.id === header.approver_staff_id;
  // 担当者(staff_id)未設定の見積書は誰でも編集可能。設定済みなら本人のみ「下書きに戻す」が可能。
  const isCreator = !header.staff_id || String(header.staff_id) === String(currentStaff?.id);

  const handleBadgeClick = (value) => {
    if (value === ESTIMATE_STATUS.APPROVED || value === ESTIMATE_STATUS.RETURNED) {
      // 申請中以外からの直接遷移、または指名された承認者以外からの操作は不可
      // 承認・差し戻しは申請中（ロック状態）で行うアクションのため isLocked では弾かない
      if (header.status !== ESTIMATE_STATUS.PENDING || !isDesignatedApprover) return;
      setApprovalModalMode(value);
      return;
    }
    if (isLocked) return;
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

  const handleImportConfirm = (groups) => {
    onImportGroups?.(groups);
    setImportModalOpen(false);
  };

  const STATUS_ACTION_CONFIG = {
    'submit-to-customer': {
      title: '提出済にしますか？',
      message: 'ステータスを「提出済」に進めます。これは見積データの保存とは別の操作で、この時点で明細の保存が済んでいない変更は反映されません。事前に「保存」ボタンで内容を確定してから進めてください。',
      confirmText: '提出済にする',
      run: () => onSubmitToCustomer?.(),
    },
    order: {
      title: '受注にしますか？',
      message: 'ステータスを「受注」に進めます。これは見積データの保存とは別の操作です。この操作の後は失注への切り替えができないため、内容に間違いがないか確認してから進めてください。',
      confirmText: '受注にする',
      run: () => onOrder?.(),
    },
  };

  const handleStatusActionConfirm = () => {
    const action = STATUS_ACTION_CONFIG[pendingStatusAction];
    action?.run();
    setPendingStatusAction(null);
  };

  return (
    // パネル全体を1つの sticky コンテナにする: 個別セクションごとに sticky を付けると
    // 各セクションが別々の位置に張り付こうとして重なり合い、コンテナの下端が画面上端を
    // 追い越した時点でまとめて流れてしまう。単一の sticky top-4 で全セクションを一体化させ、
    // 中身が画面高を超える場合のみパネル自身をスクロール可能にする。
    <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto space-y-3">
      {/* ===== 金額集計・ステータス・保存 ===== */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">

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
              // 承認・差し戻しバッジは申請中(ロック中)でも指名された承認者本人なら操作可能にする
              const badgeDisabled = isApprovalAction
                ? (!isActive && !isDesignatedApprover)
                : isLocked;
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
              onClick={() => setPendingStatusAction('submit-to-customer')}
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
                onClick={() => setPendingStatusAction('order')}
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

        {/* 見積番号エラー＋再採番 */}
        {numberError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 space-y-2">
            <p className="text-xs text-red-600 leading-relaxed">{numberError}</p>
            <button
              type="button"
              onClick={onReissueNumber}
              className="w-full flex items-center justify-center gap-1.5 border border-red-300 text-red-700 hover:bg-red-100 px-2.5 py-1.5 rounded-lg text-xs font-bold transition"
            >
              <RefreshCw size={13} />
              枝番を自動採番
            </button>
          </div>
        )}

        {/* 保存ボタン */}
        <div className="space-y-2 pt-1">
          {isLocked && isCreator && (
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

      {/* ===== 操作 ===== */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <h3 className="font-bold text-slate-700 text-sm mb-1">操作</h3>
        <button
          type="button"
          onClick={onOpenPreview}
          className="w-full flex items-center justify-center gap-1.5 border border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50 px-3 py-2 rounded-lg text-sm font-medium transition"
        >
          <Download size={14} />
          PDFプレビュー
        </button>
        {!isLocked && (
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg text-sm font-medium transition"
          >
            過去見積から取込
          </button>
        )}
        {!isLocked && onGenerateSummary && (
          <button
            type="button"
            onClick={onGenerateSummary}
            title="各明細シートのカテゴリ小計を集計した総括表シートを先頭に自動生成します"
            className="w-full flex items-center justify-center gap-1.5 border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg text-sm font-medium transition"
          >
            <LayoutList size={14} />
            総括表を生成
          </button>
        )}
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

      {importModalOpen && (
        <ImportItemsModal
          currentEstimateId={currentEstimateId}
          onImport={handleImportConfirm}
          onClose={() => setImportModalOpen(false)}
        />
      )}

      <ConfirmModal
        isOpen={pendingStatusAction !== null}
        onClose={() => setPendingStatusAction(null)}
        onConfirm={handleStatusActionConfirm}
        title={pendingStatusAction ? STATUS_ACTION_CONFIG[pendingStatusAction].title : ''}
        message={pendingStatusAction ? STATUS_ACTION_CONFIG[pendingStatusAction].message : ''}
        confirmText={pendingStatusAction ? STATUS_ACTION_CONFIG[pendingStatusAction].confirmText : ''}
        variant="primary"
      />
    </div>
  );
};

export default SettingsPanel;
