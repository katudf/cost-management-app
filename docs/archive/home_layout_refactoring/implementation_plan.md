# ホーム画面リファクタリング（ドラッグによるステータス変更および並び替え）実装計画

本計画は、ホーム画面（工事一覧）において、プロジェクトカードをドラッグ＆ドロップすることで、**カラム間でのステータス変更（例: 見積→予定）**および**同一カラム内での表示順序（`order`）の入れ替え**を直感的に行えるように拡張するためのものです。

---

## ユーザーレビュー要求事項

> [!NOTE]
> **データベース・スキーマの追加変更はありません**
> * 既存の `Projects` テーブルに定義されている `status` および `order` カラムをそのまま利用します。
> * 並び替え順の一意性衝突を防ぐために、更新時に一時的に `order` を負の値へ退避させてからコミットするアプローチを実装します。

---

## 提案する変更点

### 1. データロード・管理層 (Custom Hooks)

#### [MODIFY] [useProjects.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useProjects.js)
* **`reorderAndMoveProjects` 関数の追加**:
  * ホーム画面でのカラム間移動および並び替えを処理する統合関数を追加します。
  * **引数**:
    * `draggedId` (Number): ドラッグされたプロジェクトのID
    * `targetStatus` (String): ドロップ先のステータス (例: `'予定'`)
    * `targetProjectId` (Number, 可選): 挿入先のプロジェクトのID（カード上にドロップされた場合。カラム末尾の場合は `null`）
  * **処理フロー**:
    1. ローカルの `projects` 配列を複製。
    2. ドラッグされたプロジェクトを取り出し、`status` を `targetStatus` に更新（メインホーム内での移動のため `show_on_home` を `true` に設定）。
    3. `targetStatus` カラムに属するプロジェクト群のリストを作成し、`targetProjectId` の直前にドラッグされたプロジェクトを挿入（`targetProjectId` が `null` の場合は末尾に追加）。
    4. カラム内の全プロジェクトの `order` を `1` から順に再計算してローカルステートを更新（楽観的UI更新）。
    5. **DB更新（一意性衝突回避）**:
       * 一度に `order` を書き換えるとDBの一意性制約エラーが発生する恐れがあるため、更新対象のプロジェクトの `order` を一時的に負の値（`-1`, `-2` ...）で Supabase に更新。
       * その後、改めて正しい `order` と `status`, `show_on_home = true` を Supabase にコミット。

---

### 2. UI層 (Vite Components)

#### [MODIFY] [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)
* **状態管理の追加**:
  * `dragOverProjectId` (Number): ドラッグ中のカードがホバーしている対象プロジェクトIDを格納（挿入位置の視覚プレビュー用）。
* **ドラッグ＆ドロップイベントハンドラの実装**:
  * **`handleDragStart`**: ドラッグするプロジェクトの ID と Status を設定。
  * **`handleDragOver`**: デフォルト挙動を抑制 (`e.preventDefault()`) し、ホバー先のプロジェクトIDを `dragOverProjectId` に設定。
  * **`handleDragEnd`**: ステートをクリーンアップ。
  * **`handleCardDrop`** (カード上にドロップされた時):
    * ドロップ先のステータスとプロジェクトIDを取得し、`reorderAndMoveProjects(draggedId, status, targetProjId)` を呼び出します。
  * **`handleColumnDrop`** (カラムの余白にドロップされた時):
    * カラムのステータスを取得し、末尾への挿入として `reorderAndMoveProjects(draggedId, status, null)` を呼び出します。
* **UIスタイリングの向上**:
  * ホバー中のカードの境界線（例: `border-t-4 border-blue-500`）を強調し、どの位置に挿入されるかを分かりやすく視覚表現（プレビュー）します。
  * カード自体を掴みやすくするため、カーソルスタイルを `cursor-grab` / `active:cursor-grabbing` に調整します。

---

## 検証計画

### 自動テスト
* ビルド検証: `npm run build`

### 手動検証
1. **ステータス間移動**:
   * 「見積」カラムのカードをドラッグして、「予定」カラムの空白エリア（またはカードの上）にドロップする。
   * カードのステータスが「予定」に変わり、カラムが移動することを確認。
2. **同一カラム内での並び替え**:
   * カラム内の2番目のカードをドラッグし、1番目のカードの上にドロップする。
   * 順序が入れ替わり、1番目に挿入されることを確認.
3. **境界挿入の視覚プレビュー**:
   * カードをドラッグしながら別カードの上を通過する際、挿入位置を示す青色のプレビュー境界線が正しく表示されることを確認。
4. **データの永続化確認**:
   * カラム間移動および並び替えを行った後、ブラウザをリロードし、Supabaseからロードされたデータが最新のステータスと順序を維持しているか確認。
