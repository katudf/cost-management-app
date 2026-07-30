# データ取得フェッチの最適化（データの遅延ロード化）実装計画書

## 目的
現在、アプリ起動時にすべての工事（プロジェクト）、すべてのタスク、すべての過去日報実績（`TaskRecords`）をデータベースから一括フェッチしています。
データ増加に伴う初期起動・更新処理のボトルネックを解消するため、未完了のアクティブな現場のデータのみを初期ロードし、完了済みの過去現場の詳細データは「現場が選択されたタイミング」で非同期に遅延ロードする設計に変更します。

## 影響分析

1. **設計ポリシー（Design Policies）との整合性**:
   * `docs/architecture.md` の「データの一元フェッチ」を最適化します。
   * React状態管理（`useSupabaseData.js`）に遅延フェッチロジックをカプセル化し、UIコンポーネント側の変更を最小限に抑えます。

2. **重要経路（Critical Paths）への副作用**:
   * **ホームの現場一覧 (`DashboardTab`)**: 表示される現場のうち、「完了」ステータスのものは初期ロード時に詳細（日報実績やタスク）が空になりますが、全体の進捗や予測損益は過去時点で確定しているか、詳細選択時に計算されるため、主要な一覧表示に支障が出ないよう設計します。
   * **データ整合性の維持**: 遅延ロードされたデータは既存の `projects` ステートに部分的にマージされ、各タブ（設定、日報入力など）の動作には影響を与えません。

3. **デグレードの防止**:
   * アクティブな（未完了の）現場については、これまで通り即座にすべてのデータがロードされており、通常業務（現在進行中の現場に対する日報入力や配置表のドラッグ操作）のレスポンスや挙動は一切変更ありません。
   * 完了済みの現場を切り替えた際にも、非同期で詳細が読み込まれて正常に見積や原価が確認できることを確認します。

## 提案される変更点

### 1. `useSupabaseData.js` のデータフェッチロジックの変更

#### [MODIFY] [useSupabaseData.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useSupabaseData.js)
* `fetchAllData` の修正:
  * `Projects` のうち、ステータスが完了 (`COMPLETED`) 以外のプロジェクトID（`activeProjectIds`）を抽出。
  * `ProjectTasks`, `TaskRecords`, `SubcontractorRecords` をフェッチする際、`in('projectId', activeProjectIds)` 等でフィルタリングし、完了済みプロジェクトの詳細データのロードをスキップします。
* `fetchProjectDetails` (新規関数) の追加:
  * 特定の `projectId` に対応する `ProjectTasks`, `TaskRecords`, `SubcontractorRecords` をフェッチし、`projects` ステートの該当プロジェクトオブジェクトにマージして更新する非同期関数。
  * すでにロード済みの場合はフェッチをスキップするキャッシュ機構を内包。

### 2. メインアプリケーション (`AdminApp.jsx`) との結合

#### [MODIFY] [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)
* 現場選択 (`activeProjectId` の変更) 時のトリガー追加:
  * `activeProjectId` が変更された際に、該当プロジェクトの詳細データ（`masterData` など）が空（未ロード）である場合、`fetchProjectDetails(activeProjectId)` を呼び出して非同期ロードを実行。

---

## 検証計画

### 動作検証
1. 初期起動時、ブラウザのデベロッパーツール（Networkタブ）で `TaskRecords` や `ProjectTasks` のロード件数が削減され、初期ロード時間が短縮されること。
2. ホーム画面から完了した現場（プロジェクト）をクリックして詳細画面（工事設定）に移った際、ロードインジケータが表示され、瞬時に過去のタスク・実績日報・外注費が読み込まれて正常に表示されること。
3. 日報入力、顧客設定、配置表などの既存機能に影響（エラーやデグレード）がないこと。
