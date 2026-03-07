# リファクタリング フェーズ1：定数と純粋関数の抽出

## 目標
`AdminApp.jsx` などの肥大化したコンポーネントから、状態管理（State）に依存しない純粋関数や定数ファイルを分離し、コードの見通しを良くする。これは影響範囲が極めて小さく、安全なリファクタリングの第一歩となります。

## タスク一覧
- [x] `src/utils/constants.js` の作成
  - `DEFAULT_MASTER_DATA` の移動
  - `HOURLY_WAGE` (4375) の移動
- [x] `src/utils/dateUtils.js` の作成
  - `calculateAge` 関数の移動
- [x] `src/utils/projectUtils.js` の作成
  - ダッシュボードの集計ロジック（`allProjectsSummary`の計算部分）や、純粋なデータ処理関数の移動
- [x] `AdminApp.jsx` を更新して新しいユーティリティ関数と定数をインポートする
- [x] アプリケーションの動作確認（エラーが出力されないこと、計算処理が正常であること）
