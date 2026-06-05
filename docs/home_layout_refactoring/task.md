# タスクリスト：ドラッグによるステータス移動と並び替え

- [x] データ管理層の修正
  - [x] `useProjects.js` にドラッグ＆ドロップ用統合関数 `reorderAndMoveProjects` を追加
  - [x] `Projects_order_key` ユニーク制約エラーの修正
- [x] UI層・ソート仕様のバグ修正
  - [x] `useDashboardStats.js` および `useSupabaseData.js` のソート基準を `order` カラムに変更
- [x] 末尾移動（一番下へのドラッグ）のバグ修正
  - [x] `dragOverPosition` ステート（`before`/`after`）の追加
  - [x] `handleDragOverCard` でカードの上半分・下半分を判定し、下半分ホバー時はカードの直後（下）に挿入するようロジックを修正
  - [x] カードの直前・直後のドロップ境界プレビュー（青い境界線）の上下出し分け表示の実装
  - [x] カード親コンテナ (`className="flex flex-col gap-3 flex-1"`) への `onDragOver` と `onDrop` 追加による空白領域へのドロップ検出・末尾追加の安定化
- [x] 動作確認・ビルド検証
  - [x] `npm run build` によるビルド検証
  - [x] カラム間移動および同一カラム内並び替えの手動検証
  - [x] Walkthroughの作成
