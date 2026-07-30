# Gemini API トークン利用量監視の実装タスク

- [x] ローカルストレージ管理ロジックの作成
  - [x] `src/utils/aiOptimizeUtils.js` 内に、本日の日付を比較して利用量（回数・トークン）を加算・保存・リセットする関数を作成
- [x] APIレスポンスからのトークン数取得
  - [x] 同ファイル内、Geminiの `generateContent` 実行結果から `usageMetadata` を読み取り、記録ロジックへ渡す処理を追加
- [x] 設定画面 (UI) へのモニタリングパネル追加
  - [x] `src/components/tabs/SystemSettingsTab.jsx` 内、APIキーの下部に「本日のAPI利用状況」カードを追加
  - [x] ローカルストレージを読み込んで表示する仕組みを追加
  - [x] 視覚的（プログレスバー等）に上限到達状態が把握できるデザインの適用
