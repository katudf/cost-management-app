# 工事原価管理システム

現場作業員の日報入力・管理者の原価管理・見積書作成・工程表管理を統合した建設業向けWebアプリケーションです。

---

## 機能概要

| 機能 | 説明 |
|------|------|
| **ダッシュボード** | プロジェクトのステータス別カンバン表示・原価サマリー |
| **日報入力** | 作業員ごとの工数・業務内容・協力業者記録の入力 |
| **マスタ管理** | 工事種別・目標工数・金額のマスタデータ管理 |
| **作業員管理** | 作業員プロフィール・資格情報・CPDS番号の管理 |
| **配置表** | ガントチャート形式の作業員アサイン表示 |
| **見積書** | 見積書作成・PDF出力・Excel取込・ゴミ箱（30日以内は復元可） |
| **購買台帳** | 購入・外注費用の台帳管理 |
| **在庫管理** | 資材（塗料・工具等）の在庫・入出庫管理 |
| **システム設定** | 人工単価・自社情報・顧客情報・担当者設定 |

---

## 技術スタック

| カテゴリ | 使用技術 |
|----------|----------|
| フレームワーク | React 18 |
| ビルドツール | Vite 5 |
| スタイリング | TailwindCSS 3 |
| バックエンド/DB | Supabase (PostgreSQL) |
| PDF出力 | @react-pdf/renderer |
| Excel入出力 | xlsx / xlsx-js-style |
| AI最適化 | Google Generative AI (Gemini) |
| アイコン | lucide-react |
| デプロイ | Vercel |

---

## 動作環境

- **Node.js**: 18以上推奨（`node -v` で確認）
- **npm**: 9以上
- **Supabaseプロジェクト**: 事前に作成済みであること

---

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/katudf/cost-management-app.git
cd cost-management-app
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、値を設定します。

```bash
cp .env.example .env
```

`.env` の内容:

```env
# Supabase接続情報（必須）
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> **Supabase接続情報の取得場所**  
> Supabaseダッシュボード → プロジェクト → Settings → API → `Project URL` と `anon public` キー

> **Gemini APIキーは `.env` に置きません。**  
> Excel読込時の項目名最適化は Supabase Edge Function `gemini-optimize` 経由で呼び出します。
> キーは Supabase の Edge Function Secrets に `GEMINI_API_KEY` として設定してください。
> （旧 `VITE_GEMINI_API_KEY` はブラウザに露出するため廃止済み）

```bash
npx supabase secrets set GEMINI_API_KEY=AIza...
```

### 4. データベースの初期設定

Supabaseダッシュボードの SQL Editor で、`supabase/migrations/` 内のSQLファイルを**ファイル名の昇順**に実行してください。
（Supabase CLI を使う場合は `npx supabase db push`）

マイグレーションは追加され続けるため、README では個別ファイルを列挙しません。
`supabase/migrations/` の中身が正です。

### 5. Edge Functions のデプロイ

```bash
npx supabase functions deploy gemini-optimize
npx supabase functions deploy invite-staff
```

### 6. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:5173 を開きます。

---

## URL による画面切替

同一デプロイで4つのアプリを切り替えます。

| URL | 表示画面 | 認証 |
|-----|----------|------|
| `http://localhost:5173/` | 管理者画面（AdminApp） | 要 |
| `http://localhost:5173/?mode=worker` | 現場作業員画面（WorkerApp） | 要 |
| `http://localhost:5173/worker.html` | 同上（PWAインストール用） | 要 |
| `http://localhost:5173/?mode=schedule` | 工程表閲覧画面（ScheduleViewApp） | 不要 |
| `http://localhost:5173/?mode=inventory` | 在庫管理画面（InventoryApp） | 不要 |
| `http://localhost:5173/inventory.html` | 同上（PWAインストール用） | 不要 |

---

## 開発コマンド

```bash
npm run dev       # 開発サーバー起動（ホットリロード有効）
npm run build     # 本番ビルド（dist/ に出力）
npm run preview   # ビルド結果のプレビュー
npm test          # ユニットテスト（Vitest）
npm run test:e2e  # E2Eテスト（Playwright）
```

---

## プロジェクト構成

```
cost-management-app/
├── public/
│   └── fonts/                  # 日本語フォント（PDF出力用）
│       ├── NotoSansJP-Regular.ttf
│       └── NotoSansJP-Bold.ttf
├── src/
│   ├── App.jsx                 # ルートコンポーネント（画面切替ロジック）
│   ├── main.jsx                # エントリーポイント
│   ├── AdminApp.jsx            # 管理者向けアプリ
│   ├── WorkerApp.jsx           # 現場作業員向けアプリ
│   ├── ScheduleViewApp.jsx     # 工程表閲覧アプリ
│   ├── InventoryApp.jsx        # 在庫管理アプリ
│   ├── EstimateList.jsx        # 見積一覧
│   ├── EstimateForm.jsx        # 見積書作成・編集フォーム
│   ├── EstimatePDF.jsx         # 見積書PDF定義
│   ├── supabaseEstimates.js    # 見積DB操作
│   ├── components/             # UIコンポーネント
│   │   ├── ConfirmProvider.jsx # useConfirm()（confirm/prompt）
│   │   ├── Toast.jsx
│   │   ├── ErrorBoundary.jsx
│   │   ├── auth/               # ログイン・パスワード再設定
│   │   ├── tabs/               # AdminApp の各タブ
│   │   ├── estimate/           # 見積フォームの分割コンポーネント
│   │   ├── dashboard/          # ダッシュボード表示切替
│   │   └── assignment/         # 配置表の行・ポップアップ
│   ├── hooks/                  # Supabase通信・状態管理フック
│   │   ├── useSupabaseData.js
│   │   ├── useAuth.jsx
│   │   ├── useProjects.js
│   │   ├── useWorkers.js
│   │   ├── useInventory.js
│   │   └── useDashboardStats.js
│   ├── types/                  # TypeScript型定義
│   ├── lib/
│   │   └── supabase.js         # Supabaseクライアント初期化
│   └── utils/                  # ビジネスロジック・ユーティリティ
│       ├── constants.js
│       ├── dateUtils.ts
│       ├── workTimeUtils.ts
│       ├── projectUtils.js
│       ├── excelImportUtils.js
│       ├── excelExportUtils.js
│       ├── pdfExportUtils.js
│       └── aiOptimizeUtils.js
├── supabase/
│   ├── migrations/             # DBマイグレーションSQL
│   └── functions/              # Edge Functions
│       ├── gemini-optimize/    # Gemini APIプロキシ
│       └── invite-staff/       # 担当者招待
├── docs/                       # ドキュメント（docs/README.md が入口）
│   ├── design.md               # システム設計書
│   ├── specs/                  # 機能別詳細仕様
│   ├── manuals/                # 操作マニュアル
│   └── archive/                # 過去の実装作業ログ
├── worker.html                 # 作業員アプリ用エントリ（PWA）
├── inventory.html              # 在庫アプリ用エントリ（PWA）
├── .env.example                # 環境変数テンプレート
├── vite.config.js
├── tailwind.config.js
└── package.json
```

---

## デプロイ（Vercel）

本プロジェクトはVercelへの自動デプロイを設定済みです。

1. Vercelプロジェクト設定の **Environment Variables** に `.env` と同じキーと値を登録
2. `main` ブランチへのプッシュで本番環境に自動デプロイ

---

## 注意事項

- **`VITE_SUPABASE_ANON_KEY` は秘密情報ではありません。** ビルド後のJSバンドルに含まれる前提のキーです。
  アクセス制御は必ず Supabase の **Row Level Security (RLS)** で実装してください。
  ポリシー設計は [`docs/specs/security-permissions.md`](docs/specs/security-permissions.md) を参照。
- **Gemini APIキー**は Edge Function Secrets で管理します。`.env` や `VITE_` 変数には置かないでください。
- `public/fonts/` の NotoSansJP はPDF生成時にフェッチして埋め込むため、
  devサーバー起動中でないとPDFプレビューが崩れる場合があります。

---

## ドキュメント

| 目的 | 参照先 |
|------|--------|
| ドキュメント全体の地図 | [`docs/README.md`](docs/README.md) |
| 設計・アーキテクチャ・コーディング規約 | [`docs/design.md`](docs/design.md) |
| 認証・権限・RLS | [`docs/specs/security-permissions.md`](docs/specs/security-permissions.md) |
| 操作マニュアル | [`docs/manuals/`](docs/manuals/) |
