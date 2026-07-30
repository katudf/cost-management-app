# 資格情報の追加・編集機能

## 目的
「システム設定」タブ内に、作業員の「資格情報（WorkerCertifications）」を追加・編集・削除するための管理インターフェースを実装する。

## タスクリスト

- [x] `AdminApp.jsx` で `SystemSettingsTab` コンポーネントに `workers` などの必要な Props を渡す。
- [x] `SystemSettingsTab.jsx` に資格情報のCRUD（表示、追加、更新、削除）ロジックを実装する。
  - [x] 資格情報一覧の表示
  - [x] 「追加」および「編集」用フォーム（作業員選択、資格名、取得日、有効期限）の作成
  - [x] DB (`WorkerCertifications`) との連携
- [x] 動作確認と `walkthrough.md` の作成
