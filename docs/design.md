# システム設計書

**工事原価管理システム**  
最終更新: 2026年5月

---

## 目次

1. [システム概要](#1-システム概要)
2. [アプリケーション構成](#2-アプリケーション構成)
3. [データベース設計](#3-データベース設計)
4. [コンポーネント設計](#4-コンポーネント設計)
5. [状態管理とデータフロー](#5-状態管理とデータフロー)
6. [主要ビジネスロジック](#6-主要ビジネスロジック)
7. [外部連携](#7-外部連携)
8. [設計方針とコーディング規約](#8-設計方針とコーディング規約)

---

## 1. システム概要

### 目的

建設業の現場における以下の業務を一元管理するWebシステム。

- **現場作業員**: スマートフォン・タブレットからの日報・出退勤入力
- **管理者**: 複数プロジェクトの原価・工数・見積・工程の統合管理
- **閲覧者**: 工程表（アサイン状況）の確認

### システム全体構成

```
┌─────────────────────────────────────────────────────┐
│                    ブラウザ (SPA)                    │
│                                                     │
│  ┌───────────┐  ┌───────────┐  ┌────────────────┐  │
│  │ AdminApp  │  │ WorkerApp │  │ScheduleViewApp │  │
│  │ (管理者)  │  │ (作業員)  │  │   (工程表)     │  │
│  └─────┬─────┘  └─────┬─────┘  └───────┬────────┘  │
│        │               │                │           │
│  ┌─────▼───────────────▼────────────────▼─────────┐ │
│  │              src/lib/supabase.js               │ │
│  └─────────────────────┬───────────────────────────┘ │
└────────────────────────┼────────────────────────────┘
                         │ HTTPS (REST / Realtime)
                ┌────────▼────────┐
                │    Supabase     │
                │  (PostgreSQL)   │
                │  + Storage      │
                └─────────────────┘
```

### 画面切替

`App.jsx` が URL クエリパラメータ `?mode=` を読み取り、表示するアプリを切り替える。

| `?mode=` | 表示アプリ | 主な利用者 |
|----------|-----------|----------|
| なし | AdminApp | 管理者・事務 |
| `worker` | WorkerApp | 現場作業員・職長 |
| `schedule` | ScheduleViewApp | 閲覧専用ユーザー |

---

## 2. アプリケーション構成

### AdminApp タブ構成

```
AdminApp
├── ダッシュボード (DashboardTab)
│   └── プロジェクト別カンバン + 原価サマリー
├── 入力 (InputTab)
│   ├── 工種タスク別作業記録
│   └── 協力業者記録
├── マスタ (MasterTab)
│   └── 工種・目標工数・金額・工期設定
├── 作業員 (WorkersTab)
│   ├── 作業員マスタ
│   └── 資格情報
├── 配置表 (AssignmentChartTab)
│   └── ガントチャート形式アサイン管理
├── 見積 (EstimateList → EstimateForm)
│   ├── 見積一覧・検索・複製
│   ├── 見積書作成（明細・小計・諸経費）
│   └── PDF出力 / Excel取込
├── 購買台帳 (PurchaseLedgerTab)
│   └── 購入・外注費用の記録
└── システム設定 (SystemSettingsTab)
    ├── 基本設定（人工単価・Gemini API）
    ├── 休日設定 (HolidayCalendar)
    ├── 資格管理
    ├── 顧客情報 (CustomerSettings)
    ├── 担当者 (StaffSettings)
    └── 自社情報（社印・代表印）
```

### WorkerApp 機能

- プロジェクト選択（施工中のみ表示）
- 工種タスク別の作業時間・内容入力
- 協力業者作業記録の追加
- 配置表（工程表）の参照

---

## 3. データベース設計

### テーブル一覧

```
Supabase (PostgreSQL)
│
├── Projects               # プロジェクト（工事案件）
├── ProjectTasks           # 工種タスクマスタ
├── TaskRecords            # 日報（作業員ごとの工数記録）
├── SubcontractorRecords   # 協力業者記録
├── Assignments            # 配置（アサイン）情報
├── ProjectSuspensions     # 工事中断期間
│
├── Workers                # 作業員マスタ
├── WorkerCertifications   # 作業員保有資格
│
├── Customers              # 顧客情報
├── office_staff           # 担当者（事務・営業）
├── CertificationNames     # 資格名マスタ
│
├── estimates              # 見積書ヘッダー
├── estimate_items         # 見積書明細
│
├── PurchaseLedgers        # 購買台帳
│
└── system_settings        # システム共通設定（id=1 固定）
```

### 主要テーブル定義

#### Projects（プロジェクト）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | int8 (PK) | 自動採番 |
| name | text | 工事名 |
| status | text | `見積` / `予定` / `施工中` / `完了` |
| sort_order | int4 | 表示順（ドラッグ並び替え用） |
| estimatedAmount | numeric | 見積金額 |
| created_at | timestamptz | 作成日時 |

#### ProjectTasks（工種タスク）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | int8 (PK) | |
| project_id | int8 (FK → Projects) | |
| task | text | 工種名 |
| target | numeric | 目標工数（人工） |
| amount | numeric | 予算金額 |
| start_date | date | 開始予定日 |
| end_date | date | 完了予定日 |
| sort_order | int4 | 並び順 |

#### TaskRecords（日報）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | int8 (PK) | |
| project_id | int8 (FK) | |
| task_id | int8 (FK → ProjectTasks) | |
| worker_id | int8 (FK → Workers) | |
| date | date | 作業日 |
| hours | numeric | 作業時間 |
| overtime_hours | numeric | 残業時間 |
| work_content | text | 作業内容メモ |
| created_at | timestamptz | |

#### estimates（見積書）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | int8 (PK) | |
| estimate_number | text | 見積番号 |
| title | text | 件名 |
| customer_id | int8 (FK → Customers) | |
| issue_date | date | 発行日 |
| valid_until | date | 有効期限 |
| status | text | `draft` / `sent` / `approved` / `rejected` |
| total_amount | numeric | 合計金額（税込） |
| tax_rate | numeric | 消費税率 |
| created_by | int8 (FK → office_staff) | 作成担当者 |
| confirmed_by | int8 (FK → office_staff) | 承認者 |

#### estimate_items（見積明細）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | int8 (PK) | |
| estimate_id | int8 (FK → estimates) | |
| item_type | text | `category` / `item` / `subtotal` / `fixed` |
| name | text | 項目名 |
| quantity | numeric | 数量 |
| unit | text | 単位 |
| unit_price | numeric | 単価 |
| amount | numeric | 金額 |
| sort_order | int4 | 行順 |

#### system_settings（システム設定）

id=1 の単一レコードで管理。

| カラム | 型 | 説明 |
|--------|-----|------|
| hourly_wage | int4 | 人工単価（円/時間）|
| company_name | text | 自社名 |
| company_address | text | 自社住所 |
| company_tel | text | 自社電話番号 |
| stamp_company_url | text | 社印画像URL（Supabase Storage）|
| stamp_representative_url | text | 代表印画像URL |

---

## 4. コンポーネント設計

### コンポーネント階層

```
App.jsx
├── AdminApp.jsx
│   ├── DashboardTab
│   ├── InputTab
│   ├── MasterTab
│   ├── WorkersTab
│   ├── AssignmentChartTab
│   ├── EstimateList → EstimateForm → EstimatePDF
│   ├── PurchaseLedgerTab
│   └── SystemSettingsTab
│       ├── HolidayCalendar
│       ├── CustomerSettings
│       └── StaffSettings
│
├── WorkerApp.jsx
│
└── ScheduleViewApp.jsx
```

### 共通コンポーネント

| コンポーネント | 役割 |
|---------------|------|
| `Toast.jsx` | トースト通知（Context + Hook: `useToast()`） |
| `ConfirmModal.jsx` | 削除確認ダイアログ（`window.confirm` の代替） |
| `ImportModal.jsx` | Excelインポートモーダル（重複検出・AI最適化オプション） |
| `ExportReportModal.jsx` | 報告書エクスポート設定モーダル |
| `WorkerEditModal.jsx` | 作業員編集フォームモーダル |
| `HolidayCalendar.jsx` | 休日・スケジュール種別カレンダー管理 |

---

## 5. 状態管理とデータフロー

### データ取得の仕組み

グローバルなState管理ライブラリは使用せず、React標準の `useState` + `useCallback` によるカスタムフックでSupabaseからデータを取得・管理する。

```
AdminApp.jsx
    │
    ├── useSupabaseData()     ← 主要マスタデータ一括取得
    │   ├── workers（作業員 + 資格）
    │   ├── customers（顧客）
    │   ├── projects（プロジェクト + タスク + 記録）
    │   ├── hourlyWage（人工単価）
    │   └── fetchAllData()    ← 再フェッチトリガー
    │
    ├── useProjects()         ← プロジェクトCRUD
    │   ├── addProject()
    │   ├── editProject()
    │   ├── deleteProject()
    │   └── reorderProjects()
    │
    └── useWorkers()          ← 作業員CRUD
        ├── addWorker()
        ├── editWorker()
        └── deleteWorker()
```

### データフロー（日報入力の例）

```
WorkerApp
  ↓ (1) プロジェクト・タスク選択
useSupabaseData → Supabase（Projects, ProjectTasks を取得）
  ↓ (2) 工数・時間入力
WorkerApp ローカルstate（draft）
  ↓ (3) 保存ボタン
TaskRecords テーブルへ INSERT/UPSERT
  ↓ (4) fetchAllData() 呼び出し
useSupabaseData → Supabase（再フェッチ）
  ↓ (5) Props経由でUIに反映
```

### 未保存変更ガード（EstimateForm）

```javascript
const isDirty = useRef(false);     // 変更フラグ（re-render不要のためuseRef）
const isInitialized = useRef(false); // 初期ロード完了フラグ

// データ変更時
useEffect(() => {
    if (!isInitialized.current) return;
    isDirty.current = true;
}, [header, items]);

// ブラウザ離脱時
window.addEventListener('beforeunload', (e) => {
    if (isDirty.current) e.preventDefault();
});

// アプリ内ナビゲーション時
<button onClick={() => isDirty.current ? setShowLeaveConfirm(true) : onBack()} />
```

---

## 6. 主要ビジネスロジック

### 人工（にんく）計算

`src/utils/workTimeUtils.js` にて計算。

- **1人工** = 8時間労働
- **実人工数** = 合計作業時間 ÷ 8
- **残業** = 1日8時間超過分
- **人件費** = 実人工数 × 1日換算単価（人工単価 × 8）

### 原価集計（DashboardTab / useDashboardStats）

```
プロジェクト原価
  = 労務費（作業員工数 × 人工単価 × 時間）
  + 協力業者費（SubcontractorRecords.amount の合計）
  + 購買費（PurchaseLedgers.amount の合計）

純利益
  = 見積金額 - プロジェクト原価（調整率適用後）
```

### 見積書明細の行タイプ

| `item_type` | 役割 |
|-------------|------|
| `category` | 工種大カテゴリ（集計対象外の見出し行） |
| `item` | 通常明細行（数量 × 単価 = 金額） |
| `subtotal` | 工種小計行（直前カテゴリまでのitem合計） |
| `fixed` | 固定費行（諸経費等、自動計算対象外） |

### 見積書PDF生成

`src/EstimatePDF.jsx` で `@react-pdf/renderer` を使用。日本語フォント（NotoSansJP）を `public/fonts/` からフェッチしてPDF内に埋め込む。

---

## 7. 外部連携

### Supabase Storage（印鑑画像）

`system_settings` の `stamp_company_url` / `stamp_representative_url` に保存した画像URLを、見積書PDF内に埋め込んで出力する。

```
アップロード先バケット: stamps
ファイル名命名規則: {type}_{timestamp}.{ext}
  例: company_1716000000000.png
      representative_1716000000001.png
```

### Google Generative AI (Gemini)

`src/utils/aiOptimizeUtils.js` にて Excelインポート時の項目名正規化に使用。

- **用途**: Excelから読み取った工種名・項目名を、システムのマスタデータに近い表記へ自動変換
- **APIキー**: Supabase Edge Functions の環境変数 `GEMINI_API_KEY` （セキュリティ向上のためサーバーサイドで秘匿）
- **利用量管理**: `getDailyApiUsage()` で当日のリクエスト数・トークン数をlocalStorageで管理（Edge Functions のレスポンスに含まれるメタデータを集計）

### Vercel デプロイ

- `main` ブランチ → 本番環境（Production）に自動デプロイ
- PRブランチ → プレビュー環境（Preview URL）を自動生成
- ビルドコマンド: `npm run build`
- 出力ディレクトリ: `dist/`

---

## 8. 設計方針とコーディング規約

### ディレクトリ責務の分離

| ディレクトリ | 格納すべきもの |
|-------------|---------------|
| `src/components/` | UIコンポーネント（Supabase呼び出し禁止） |
| `src/hooks/` | Supabase通信・状態管理ロジック |
| `src/utils/` | ビジネスロジック・変換処理（副作用禁止） |
| `src/lib/` | 外部ライブラリの初期化 |

### Supabase操作のルール

- UIコンポーネントから直接 `supabase.from()` を呼び出さない
- 必ず `src/hooks/` のカスタムフック、または `supabaseEstimates.js` のようなサービス関数を経由する
- エラーは `showToast('...', 'error')` でユーザーに通知する

### 削除確認のルール

- `window.confirm()` は使用禁止
- 必ず `<ConfirmModal>` コンポーネントを使用する

```jsx
const [confirmDeleteId, setConfirmDeleteId] = useState(null);

// 削除ボタン
<button onClick={() => setConfirmDeleteId(item.id)}>削除</button>

// モーダル（コンポーネントのreturn内、ルート要素の内側に配置）
<ConfirmModal
    isOpen={!!confirmDeleteId}
    onClose={() => setConfirmDeleteId(null)}
    onConfirm={() => { handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
    title="削除の確認"
    message="この操作は元に戻せません。削除しますか？"
/>
```

### マジック文字列の禁止

プロジェクトステータスや行タイプ等の固定値は `src/utils/constants.js` の定数を使用する。

```javascript
// NG
if (project.status === '施工中') { ... }

// OK
import { PROJECT_STATUS } from './utils/constants';
if (project.status === PROJECT_STATUS.IN_PROGRESS) { ... }
```

### 数値入力フィールド

金額・工数など、負値が存在しない数値には必ず `min="0"` を付与する。

```jsx
<input type="number" min="0" value={amount} onChange={...} />
```

### アクセシビリティ

アイコンのみのボタンには `aria-label` と `title` を必ず付与する。

```jsx
<button aria-label="削除" title="削除">
    <Trash2 size={16} />
</button>
```

### エラーバウンダリ

`src/components/ErrorBoundary.jsx` の `<ErrorBoundary>` コンポーネントでアプリ全体をラップし、未捕捉エラーによる白画面を防ぐ。

```jsx
// App.jsx
<ErrorBoundary>
    <AdminApp />
</ErrorBoundary>
```
