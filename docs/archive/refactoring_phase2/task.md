# リファクタリング フェーズ2：UIコンポーネント（モーダル等）の分離

## 目標
`AdminApp.jsx` 内に直接記述されている大規模なJSX（特にモーダル部分）を、独立したReactコンポーネントとして `src/components/` ディレクトリに切り出します。これにより、メインファイルの行数を大幅に削減し、可読性と保守性を向上させます。

## 対象となる主なコンポーネント
1. **Excelインポート確認モーダル** (`ImportModal` 相当)
2. **作業員編集/追加モーダル** (`WorkerEditModal` 相当)
3. **日報出力用モーダル** (`ExportReportModal` 相当)

## タスク一覧
- [ ] `src/components/` ディレクトリの作成
## タスク一覧
- [x] `src/components/` ディレクトリの作成
- [x] `ImportModal.jsx` の作成とロジック移行
- [x] `WorkerEditModal.jsx` の作成とロジック移行
- [x] `ExportReportModal.jsx` の作成とロジック移行
- [x] `AdminApp.jsx` で上記コンポーネントをインポートし、状態(State)とコールバックを渡すように修正
- [x] 動作確認（各モーダルが正常に開き、値が保存・反映されること）
