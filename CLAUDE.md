# CLAUDE.md — 工事原価管理システム

## プロジェクト概要

建設業向けの工事原価管理Webアプリ。Supabase (PostgreSQL) をバックエンドに、React + Vite で構築したSPA。
- **管理者画面** (`AdminApp.jsx`): 原価・見積・作業員・工程管理
- **作業員画面** (`WorkerApp.jsx`): 日報入力（スマホ対応）
- **工程表閲覧** (`ScheduleViewApp.jsx`): 読み取り専用
- URL クエリパラメータ `?mode=worker|schedule` で画面切替（`App.jsx`）

詳細: [`docs/design.md`](docs/design.md) / [`docs/architecture.md`](docs/architecture.md)

## 開発コマンド

```bash
npm run dev      # 開発サーバー（localhost:5173）
npm run build    # 本番ビルド
npm run preview  # ビルドプレビュー
```

## 環境変数

`.env` ファイルに設定（`.env.example` 参照）:
- `VITE_SUPABASE_URL` — Supabase Project URL（必須）
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key（必須）
- ※ Gemini API キーはフロントエンド環境変数から廃止され、Supabase Edge Functions の Secrets (`GEMINI_API_KEY`) として管理されるようになりました。

## 技術スタック

React 18 / Vite 5 / TailwindCSS 3 / Supabase / @react-pdf/renderer / xlsx-js-style / lucide-react

## 主なファイル構成

```
src/
├── App.jsx                    # ルート（画面切替）
├── AdminApp.jsx               # 管理者アプリ本体
├── WorkerApp.jsx              # 作業員アプリ本体
├── components/tabs/           # 各タブコンポーネント
├── hooks/
│   ├── useSupabaseData.js     # マスタデータ一括取得（中心的なフック）
│   ├── useProjects.js         # プロジェクトCRUD
│   └── useWorkers.js          # 作業員CRUD
├── utils/
│   ├── constants.js           # 定数（PROJECT_STATUS, ITEM_TYPE等）
│   ├── workTimeUtils.js       # 人工・労働時間計算
│   └── projectUtils.js        # 原価集計
├── EstimateForm.jsx           # 見積書作成（大きなファイル: ~950行）
└── lib/supabase.js            # Supabaseクライアント
```

## 設計上の重要なルール

### Supabase呼び出し
- UIコンポーネントから直接 `supabase.from()` を呼ばない
- 必ず `src/hooks/` のカスタムフック、または `supabaseEstimates.js` を経由する

### 削除確認
- `window.confirm()` は使用禁止
- `src/components/ConfirmModal.jsx` を使うこと
- ConfirmModal は必ずルート要素の**内側**に配置（JSX兄弟要素エラー防止）

### マジック文字列
- プロジェクトステータス等は `src/utils/constants.js` の定数を使用
- `PROJECT_STATUS.IN_PROGRESS` など（`'施工中'` と直書きしない）

### 数値入力
- 金額・工数など負値不要の `<input type="number">` には `min="0"` を付与

### アイコンボタン
- アイコンのみのボタンには `aria-label` と `title` を付与

### エラー通知
- エラーは `showToast('メッセージ', 'error')` でユーザーに通知する（`useToast()` フック）

## 主要DBテーブル（Supabase）

| テーブル | 役割 |
|----------|------|
| `Projects` | 工事案件（status: 見積/予定/施工中/完了） |
| `ProjectTasks` | 工種マスタ |
| `TaskRecords` | 日報（作業員×工種×日付） |
| `SubcontractorRecords` | 協力業者記録 |
| `Assignments` | 配置表データ |
| `Workers` | 作業員マスタ |
| `WorkerCertifications` | 資格情報 |
| `estimates` / `estimate_items` | 見積書ヘッダー・明細 |
| `Customers` | 顧客情報 |
| `office_staff` | 担当者（事務・営業） |
| `system_settings` | システム設定（id=1 固定行） |
| `PurchaseLedgers` | 購買台帳 |

## 注意点

- `public/fonts/` にNotoSansJPを格納。PDF生成時にフェッチして埋め込むため、devサーバー起動中でないとPDFプレビューが崩れる場合あり
- Gemini APIキーのセキュリティ: クライアント側の漏洩を防ぐため、Supabase Edge Functions 経由の呼び出しに移行しました。キーは本番 Supabase の Secrets で設定します。
- `system_settings` テーブルは `id=1` の固定1行で管理。INSERT不要、UPDATEのみ
