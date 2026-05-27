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
| **見積書** | 見積書作成・PDF出力・Excel取込 |
| **購買台帳** | 購入・外注費用の台帳管理 |
| **システム設定** | 人工単価・Gemini APIキー・自社情報・顧客情報・担当者設定 |

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

# Gemini AI（任意 - Excel読込時の項目名最適化機能に使用）
# 注意: VITE_プレフィックスのためブラウザから参照可能。本番利用時は制限を設けること
VITE_GEMINI_API_KEY=AIza...
```

> **Supabase接続情報の取得場所**  
> Supabaseダッシュボード → プロジェクト → Settings → API → `Project URL` と `anon public` キー

### 4. データベースの初期設定

Supabaseダッシュボードの SQL Editor で、`supabase/migrations/` 内のSQLファイルを順に実行してください。

```
supabase/migrations/
├── 20260323051912_remote_schema.sql    # テーブル定義
└── 20260327143000_create_purchase_records.sql  # 購買台帳テーブル
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:5173 を開きます。

---

## URL パラメータによる画面切替

同一URLパラメータで3つのアプリを切り替えます。

| URL | 表示画面 |
|-----|----------|
| `http://localhost:5173/` | 管理者画面（AdminApp） |
| `http://localhost:5173/?mode=worker` | 現場作業員画面（WorkerApp） |
| `http://localhost:5173/?mode=schedule` | 工程表閲覧画面（ScheduleViewApp） |

---

## 開発コマンド

```bash
npm run dev      # 開発サーバー起動（ホットリロード有効）
npm run build    # 本番ビルド（dist/ に出力）
npm run preview  # ビルド結果のプレビュー
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
│   ├── EstimateList.jsx        # 見積一覧
│   ├── EstimateForm.jsx        # 見積書作成・編集フォーム
│   ├── EstimatePDF.jsx         # 見積書PDF定義
│   ├── supabaseEstimates.js    # 見積DB操作
│   ├── components/             # 共通UIコンポーネント
│   │   ├── ConfirmModal.jsx
│   │   ├── Toast.jsx
│   │   ├── ImportModal.jsx
│   │   ├── HolidayCalendar.jsx
│   │   └── tabs/               # 各タブコンポーネント
│   ├── hooks/                  # Supabase通信・状態管理フック
│   │   ├── useSupabaseData.js
│   │   ├── useProjects.js
│   │   ├── useWorkers.js
│   │   └── useDashboardStats.js
│   ├── lib/
│   │   └── supabase.js         # Supabaseクライアント初期化
│   └── utils/                  # ビジネスロジック・ユーティリティ
│       ├── constants.js
│       ├── dateUtils.js
│       ├── workTimeUtils.js
│       ├── projectUtils.js
│       ├── excelImportUtils.js
│       ├── excelExportUtils.js
│       ├── pdfExportUtils.js
│       └── aiOptimizeUtils.js
├── supabase/
│   └── migrations/             # DBマイグレーションSQL
├── docs/                       # 設計書・実装メモ
│   ├── design.md               # システム設計書（本ドキュメント）
│   └── architecture.md         # アーキテクチャ概要
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

- **Gemini APIキー**は `VITE_` プレフィックスのため、ビルド後のJSバンドルに含まれます。  
  不特定多数へ公開するサービスでは、Supabase Edge Functions 経由でのプロキシ利用を推奨します。
- Supabase の **Row Level Security (RLS)** 設定状況を本番環境前に必ず確認してください。
