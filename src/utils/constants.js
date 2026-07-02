export const DEFAULT_MASTER_DATA = [
    { id: 'temp-1', task: '屋根：高圧洗浄・プライマー', target: 14 },
    { id: 'temp-2', task: '屋根：ウレタン防水', target: 73 },
];

// === プロジェクトステータス ===
export const PROJECT_STATUS = {
    ESTIMATE: '見積',
    SCHEDULED: '予定',
    IN_PROGRESS: '施工中',
    COMPLETED: '完了',
};
export const PROJECT_STATUS_LIST = [
    PROJECT_STATUS.ESTIMATE,
    PROJECT_STATUS.SCHEDULED,
    PROJECT_STATUS.IN_PROGRESS,
    PROJECT_STATUS.COMPLETED,
];

// ステータスごとの表示色（Tailwindクラス）
export const PROJECT_STATUS_COLOR = {
    [PROJECT_STATUS.ESTIMATE]:   'bg-orange-400',
    [PROJECT_STATUS.SCHEDULED]:  'bg-blue-400',
    [PROJECT_STATUS.IN_PROGRESS]:'bg-green-500',
    [PROJECT_STATUS.COMPLETED]:  'bg-slate-400',
};

// === 見積ステータス ===
export const ESTIMATE_STATUS = {
    DRAFT: 'draft',
    PENDING: 'pending',
    APPROVED: 'approved',
    RETURNED: 'returned',
};
export const ESTIMATE_STATUS_LABEL = {
    [ESTIMATE_STATUS.DRAFT]:    '下書き',
    [ESTIMATE_STATUS.PENDING]:  '申請中',
    [ESTIMATE_STATUS.APPROVED]: '承認',
    [ESTIMATE_STATUS.RETURNED]: '差し戻し',
};
export const ESTIMATE_STATUS_LIST = [
    ESTIMATE_STATUS.DRAFT,
    ESTIMATE_STATUS.PENDING,
    ESTIMATE_STATUS.APPROVED,
    ESTIMATE_STATUS.RETURNED,
];

// === 見積アイテム種別 ===
export const ITEM_TYPE = {
    CATEGORY: 'category',
    ITEM: 'item',
    SUBTOTAL: 'subtotal',
    FIXED: 'fixed',
    COMMENT: 'comment',
};

// === 在庫管理 種類 ===
export const INVENTORY_CATEGORY_LIST = [
    '塗料',
    '工具',
    '塗装用品',
    '電動工具',
    '消耗品',
    '機械',
    '車用品',
    '計測、測量',
    'その他',
];

// 種類ごとのバッジ表示色（Tailwindクラス）
export const INVENTORY_CATEGORY_COLOR = {
    '塗料':     'bg-blue-100 text-blue-700',
    '工具':     'bg-amber-100 text-amber-700',
    '塗装用品': 'bg-cyan-100 text-cyan-700',
    '電動工具': 'bg-orange-100 text-orange-700',
    '消耗品':   'bg-green-100 text-green-700',
    '機械':     'bg-purple-100 text-purple-700',
    '車用品':   'bg-rose-100 text-rose-700',
    '計測、測量': 'bg-teal-100 text-teal-700',
    'その他':   'bg-slate-100 text-slate-600',
};

// === 配置表 カラーパレット ===
export const DEFAULT_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F0B27A', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
    '#5DADE2'
];

// === 配置表 スケジュール種別 ===
export const SCHEDULE_TYPES = [
    { title: '有給', color: '#F59E0B', icon: '🏖️' },
    { title: '休み', color: '#6B7280', icon: '💤' },
    { title: '健診', color: '#10B981', icon: '🏥' },
    { title: '会社', color: '#8B5CF6', icon: '🏢' },
    { title: '講習会', color: '#EC4899', icon: '📚' },
    { title: '会議', color: '#0EA5E9', icon: '🗣️' },
    { title: 'CPDS', color: '#14B8A6', icon: '📝' },
];

