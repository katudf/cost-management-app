# システム設計書

**工事原価管理システム**  
最終更新: 2026年7月30日

> 本書はシステム全体の設計・アーキテクチャ・コーディング規約を扱う唯一の設計文書です。
> 機能単位の詳細仕様は [`specs/`](specs/)、利用手順は [`manuals/`](manuals/) を参照してください。
> 過去の実装作業ログは [`archive/`](archive/) にあります（現行仕様の根拠には使用しないこと）。

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
9. [クリティカルパス](#9-クリティカルパス)

---

## 1. システム概要

### 目的

建設業の現場における以下の業務を一元管理するWebシステム。

- **現場作業員**: スマートフォン・タブレットからの日報・出退勤入力
- **管理者**: 複数プロジェクトの原価・工数・見積・工程の統合管理
- **閲覧者**: 工程表（アサイン状況）の確認
- **在庫担当**: 塗料・工具などの資材在庫の入出庫管理

### システム全体構成

```
┌──────────────────────────────────────────────────────────────────┐
│                          ブラウザ (SPA)                           │
│                                                                  │
│  ┌───────────┐  ┌───────────┐  ┌────────────────┐  ┌──────────┐ │
│  │ AdminApp  │  │ WorkerApp │  │ScheduleViewApp │  │Inventory │ │
│  │ (管理者)  │  │ (作業員)  │  │   (工程表)     │  │App(在庫) │ │
│  └─────┬─────┘  └─────┬─────┘  └───────┬────────┘  └────┬─────┘ │
│        │               │                │                │       │
│  ┌─────▼───────────────▼────────────────▼────────────────▼─────┐ │
│  │        AuthProvider (useAuth) — Supabase Auth セッション     │ │
│  │        ※ ScheduleViewApp / InventoryApp は認証なし           │ │
│  └─────────────────────────────┬───────────────────────────────┘ │
│  ┌─────────────────────────────▼───────────────────────────────┐ │
│  │                     src/lib/supabase.js                     │ │
│  └─────────────────────────────┬───────────────────────────────┘ │
└────────────────────────────────┼─────────────────────────────────┘
                                 │ HTTPS (REST / Auth / Functions)
                       ┌─────────▼─────────┐
                       │     Supabase      │
                       │   PostgreSQL      │
                       │   + Auth (RLS)    │
                       │   + Storage       │
                       │   + Edge Functions│
                       └───────────────────┘
```

### 画面切替

`App.jsx` が URL クエリパラメータ `?mode=` と `location.pathname` を読み取り、表示するアプリを切り替える。
PWA として独立インストールできるよう、`worker.html` / `inventory.html` の専用エントリーポイントも用意している（マニフェスト・アイコンを個別に持たせるため）。

| URL | 表示アプリ | 認証 | 主な利用者 |
|-----|-----------|------|----------|
| `/` | AdminApp | 要 | 管理者・事務 |
| `/?mode=worker`, `/worker.html` | WorkerApp | 要 | 現場作業員・職長 |
| `/?mode=schedule` | ScheduleViewApp | 不要 | 閲覧専用ユーザー |
| `/?mode=inventory`, `/inventory.html` | InventoryApp | 不要 | 在庫担当 |

権限・ロール設計の詳細は [`specs/security-permissions.md`](specs/security-permissions.md) を参照。

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
├── 日報 (DailyReportTab)
│   └── 作業員提出日報の一覧・承認（残業・作業手当）
├── 見積 (EstimateList → EstimateForm)
│   ├── 見積一覧・検索・複製
│   ├── 見積書作成（明細・小計・諸経費）
│   ├── PDF出力 / Excel取込
│   └── ゴミ箱（削除後30日以内は復元可）
├── 購買台帳 (PurchaseLedgerTab)
│   └── 購入・外注費用の記録
└── システム設定 (SystemSettingsTab)
    ├── 基本設定（人工単価）
    ├── 休日設定 (HolidayCalendar)
    ├── 資格管理
    ├── 顧客情報 (CustomerSettings)
    ├── 担当者 (StaffSettings / 招待は invite-staff Edge Function)
    └── 自社情報（社印・代表印）
```

### WorkerApp 機能

- Supabase Auth によるメールアドレス＋パスワードログイン（`LoginScreen`）
- プロジェクト選択（施工中のみ表示）
- 工種タスク別の作業時間・内容入力
- 協力業者作業記録の追加
- 残業・作業手当の申請（承認は AdminApp の日報タブ）
- 配置表（工程表）の参照
- オフラインキャッシュ（`utils/offlineCache.js`）による通信断時の入力保持

### InventoryApp 機能

- 資材カテゴリ（塗料・工具・塗装用品など）別の在庫一覧
- 入庫・出庫の登録と在庫数の増減
- 認証なしで利用（現場端末での共用を想定）

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
├── estimates              # 見積書ヘッダー（deleted_at によるソフト削除）
├── estimate_items         # 見積書明細
│
├── PurchaseRecords        # 購買台帳・仕入帳
├── InventoryItems         # 資材在庫マスタ
├── Warehouses             # 倉庫・保管場所
├── workers_directory      # 作業員名簿ビュー（在庫アプリ等の参照用）
│
└── system_settings        # システム共通設定（id=1 固定）
```

正確なDDLは [`specs/database.md`](specs/database.md) および `supabase/migrations/` を参照（マイグレーションが最終的な正）。

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
| status | text | 下記「見積ステータス」参照（`ESTIMATE_STATUS`） |
| total_amount | numeric | 合計金額（税込） |
| tax_rate | numeric | 消費税率 |
| created_by | int8 (FK → office_staff) | 作成担当者 |
| confirmed_by | int8 (FK → office_staff) | 承認者 |
| deleted_at | timestamptz | ソフト削除日時（NULL = 有効） |

##### 見積ステータス

`src/utils/constants.js` の `ESTIMATE_STATUS` / `ESTIMATE_STATUS_LABEL` が正。

| 値 | 表示ラベル |
|----|-----------|
| `draft` | 下書き |
| `pending` | 承認依頼 |
| `approved` | 承認済 |
| `returned` | 差し戻し |
| `submitted` | 提出済 |
| `ordered` | 受注 |
| `lost` | 失注 |

##### ソフト削除とゴミ箱

`deleteEstimate()` は行を物理削除せず `deleted_at` を設定する。一覧取得は `.is('deleted_at', null)` で除外し、
ゴミ箱画面は削除から30日以内のものだけを表示する。復元は `restore_estimate` RPC 経由
（`supabase/migrations/20260716000000_add_estimate_restore.sql`）。

#### estimate_items（見積明細）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | int8 (PK) | |
| estimate_id | int8 (FK → estimates) | |
| item_type | text | `category` / `item` / `subtotal` / `fixed` / `comment` |
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
App.jsx  ─ ErrorBoundary → AuthProvider → 各アプリ
│
├── AdminApp.jsx
│   ├── DashboardTab
│   │   └── dashboard/ (DashboardViewSwitcher, ProjectListView, ProjectCompactView)
│   ├── InputTab
│   ├── MasterTab
│   ├── WorkersTab       → WorkerEditModal / WorkerDetailsModal
│   ├── DailyReportTab   （残業・作業手当の承認）
│   ├── AssignmentChartTab
│   │   └── assignment/ (ProjectBarRow, WorkerRow, AssignmentPopup,
│   │                    EditColorPopup, EditHolidayPopup)
│   ├── EstimateList → EstimateForm → EstimatePDF
│   │   └── estimate/ (EstimateHeader, EstimateItemTable, EstimateSidebar,
│   │                  EstimateApprovalModal, EstimateSubmitModal,
│   │                  EstimateLostReasonModal, CustomerResolveModal,
│   │                  ImportItemsModal)
│   ├── PurchaseLedgerTab
│   └── SystemSettingsTab
│       ├── HolidayCalendar
│       ├── CustomerSettings
│       ├── StaffSettings
│       └── settings/ (CertificationManager, CompanyInfoSettings)
│
├── WorkerApp.jsx
│   └── worker/ (WorkerAssignmentView)
│
├── ScheduleViewApp.jsx
│
├── InventoryApp.jsx
│
└── auth/ (LoginScreen, ResetPasswordScreen)  ← 未認証時に表示
```

### 共通コンポーネント

| コンポーネント | 役割 |
|---------------|------|
| `Toast.jsx` | トースト通知（Context + Hook: `useToast()`） |
| `ConfirmProvider.jsx` | 確認・入力ダイアログの Provider（Hook: `useConfirm()` → `{ confirm, prompt }`） |
| `ConfirmModal.jsx` | 確認ダイアログの表示部（通常は `useConfirm()` 経由で利用） |
| `PromptModal.jsx` | 文字列入力ダイアログの表示部（`window.prompt` の代替） |
| `IconButton.jsx` | `aria-label` / `title` を強制するアイコンボタン |
| `ErrorBoundary.jsx` | 未捕捉エラーの捕捉（白画面防止） |
| `ImportModal.jsx` | Excelインポートモーダル（重複検出・AI最適化オプション） |
| `ExportReportModal.jsx` | 報告書エクスポート設定モーダル |
| `WorkerEditModal.jsx` | 作業員編集フォームモーダル |
| `WorkerDetailsModal.jsx` | 作業員詳細・資格情報の表示 |
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

### フック一覧

| フック | 役割 |
|--------|------|
| `useSupabaseData.js` | マスタデータ一括取得（中心的なフック） |
| `useProjects.js` | プロジェクトCRUD・並び替え |
| `useWorkers.js` | 作業員CRUD |
| `useAuth.jsx` | Supabase Auth セッション・ロール判定（`AuthProvider` / `useAuth()`） |
| `useDashboardStats.js` | ダッシュボードの原価・利益集計 |
| `useAssignmentState.js` | 配置表の編集状態管理 |
| `useWorkerAssignments.js` | 作業員別アサインの取得 |
| `useInventory.js` | 在庫アイテム・倉庫の取得と入出庫 |

### サービス層（フック外のDB操作）

| ファイル | 役割 |
|---------|------|
| `supabaseEstimates.js` | 見積ヘッダー・明細のCRUD、ソフト削除・復元 |
| `lib/overtimeApprovals.js` | 残業申請の取得・承認 |
| `lib/workAllowanceApprovals.js` | 作業手当申請の取得・承認 |
| `utils/offlineCache.js` | オフライン時の入力データ退避（localStorage） |
| `utils/estimateDraft.js` | 見積フォームの下書き自動保存 |

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
  + 購買費（PurchaseRecords.amount の合計）

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
| `comment` | 備考・注釈行（金額欄なし、集計対象外） |

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

### Supabase Auth

- メールアドレス＋パスワード認証。`AuthProvider` (`src/hooks/useAuth.jsx`) がセッションを保持する
- `office_staff.auth_user_id` で Auth ユーザーと担当者マスタを紐付ける
- 担当者の招待は `invite-staff` Edge Function（Service Role キーを使うためサーバーサイド必須）
- パスワード再設定は `ResetPasswordScreen`
- **anon key は秘密情報ではない**。アクセス制御は必ずRLSで実装する

### Supabase Edge Functions

| Function | 役割 |
|----------|------|
| `gemini-optimize` | Gemini API のプロキシ（APIキーをサーバー側で秘匿） |
| `invite-staff` | 担当者の招待メール送信（Service Role キー使用） |

### Google Generative AI (Gemini)

`src/utils/aiOptimizeUtils.js` にて Excelインポート時の項目名正規化に使用。

- **用途**: Excelから読み取った工種名・項目名を、システムのマスタデータに近い表記へ自動変換
- **呼び出し経路**: `supabase.functions.invoke('gemini-optimize', ...)`
- **APIキー**: Supabase Edge Functions の Secrets `GEMINI_API_KEY`
  （旧 `VITE_GEMINI_API_KEY` は廃止。フロントエンドの環境変数には置かない）
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

- `window.confirm()` / `window.prompt()` は使用禁止
- `useConfirm()` フックの `confirm()` / `prompt()` を使用する（推奨）

`ConfirmProvider` がアプリ全体をラップしているため、モーダルのstateを各コンポーネントで持つ必要はない。
`await` で結果を受け取れるので、削除処理を素直に直列で書ける。

```jsx
import { useConfirm } from './components/ConfirmProvider';

const { confirm, prompt } = useConfirm();

const handleDelete = async (item) => {
    const ok = await confirm({
        title: '削除の確認',
        message: 'この操作は元に戻せません。削除しますか？',
    });
    if (!ok) return;
    await deleteItem(item.id);
};
```

`<ConfirmModal>` を直接使う場合（既存コードの保守時）は、必ずコンポーネントのルート要素の**内側**に
配置する（JSX兄弟要素エラー防止）。

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
    <AuthProvider>
        <AdminApp />
    </AuthProvider>
</ErrorBoundary>
```

### 型定義とTypeScript

段階的にTypeScriptへ移行中。新規のユーティリティ・型定義は `.ts` で追加する。

- `src/types/index.ts` — 共通ドメイン型
- `src/utils/dateUtils.ts`, `src/utils/workTimeUtils.ts` — 移行済み
- 既存の `.jsx` を一括変換する必要はない（触るファイル単位で移行）

### テスト

| コマンド | 内容 |
|---------|------|
| `npm test` | Vitest によるユニットテスト（`src/**/*.test.ts`） |
| `npm run test:e2e` | Playwright による E2E テスト |

ビジネスロジック（工数計算・日付処理・原価集計）は `src/utils/` に置いてテスト可能な形を保つ。

---

## 9. クリティカルパス

改修時に影響範囲が広く、追従漏れが起きやすい箇所。

### 1. 日報スキーマ（`TaskRecords`）の変更

- **影響範囲**: `useSupabaseData.js`（取得・成形）、`WorkerApp.jsx`（入力UI）、
  `DailyReportTab.jsx`（承認）、`DashboardTab.jsx` / `useDashboardStats.js`（原価集計）、
  `workTimeUtils.js`（労働・残業時間の計算）
- **注意点**: カラム追加・削除時は計算ロジックまで追従させること。集計ズレは画面上で気づきにくい。

### 2. プロジェクトスキーマ（`Projects`）の変更

- **影響範囲**: `useProjects.js`、`AssignmentChartTab.jsx`（工程表描画）、`MasterTab.jsx`、
  `ScheduleViewApp.jsx`

### 3. 見積スキーマ（`estimates`, `estimate_items`）の変更

- **影響範囲**: `supabaseEstimates.js`（DB操作）、`EstimateForm.jsx` と `components/estimate/*`（入力UI）、
  `EstimatePDF.jsx`（PDF出力）、`excelImportUtils.js`（Excel取込）
- **注意点**: 明細の保存は `save_estimate_items` RPC で原子的に行う（
  `supabase/migrations/20260707000000_create_save_estimate_items_rpc.sql`）。
  DELETE→INSERT を個別に発行する実装に戻すと、途中失敗で明細が全消失する。

### 4. RLSポリシーの変更

- **影響範囲**: 全アプリ。anon key はクライアントに露出するため、**アクセス制御はRLSのみが実質的な防御**。
- **注意点**: ロール追加時は `workers_directory` など参照系ビューのポリシー追加漏れに注意
  （実例: `20260721000000_allow_worker_role_workers_directory.sql`）。
  詳細は [`specs/security-permissions.md`](specs/security-permissions.md)。
