## タスク一覧
- [x] `system_settings` テーブルの作成（Supabase SQLエディタで実行）
- [x] `src/utils/constants.js` から `HOURLY_WAGE` を削除
- [x] `src/utils/projectUtils.js` および `src/utils/excelImportUtils.js` を変更し、`hourlyWage` を引数として受け取るようにする
- [x] `src/components/tabs/SystemSettingsTab.jsx` を作成
- [x] `src/AdminApp.jsx` で `hourlyWage` ステートを管理し、DBから取得・更新する処理を追加
- [x] `src/AdminApp.jsx` に「システム設定」タブを追加し、各コンポーネントへ `hourlyWage` を渡すように修正
- [ ] 動作確認（設定変更の反映、予測計算、Excelインポートの確認）
