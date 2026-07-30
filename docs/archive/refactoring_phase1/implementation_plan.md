# リファクタリング フェーズ1：定数と純粋関数の抽出

## Goal Description
`AdminApp.jsx` にハードコードされている定数（`DEFAULT_MASTER_DATA`, `HOURLY_WAGE`）や、Stateに依存しない純粋関数（年齢計算、プロジェクト集計ロジック）を外部のユーティリティファイルに分離します。
これにより、約2,000行に肥大化したコンポーネントのコード行数を削減し、将来的なロジック変更やテスト追加を容易にします。機能の変更は一切伴わない安全なリファクタリングです。

## Proposed Changes

### Utilities
新しいユーティリティ関数ファイルを作成し、ロジックを移動します。

#### [NEW] [constants.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/constants.js)
- `DEFAULT_MASTER_DATA` の定義
- `HOURLY_WAGE` の定義 (4375)

#### [NEW] [dateUtils.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/dateUtils.js)
- `calculateAge` 関数の定義

#### [NEW] [projectUtils.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/projectUtils.js)
- `calculateProjectsSummary` 関数の定義とエクスポート（ダッシュボード全体の集計ロジック）

---
### Components
コンポーネントから直接の定義を削除し、ユーティリティをインポートして利用するように変更します。

#### [MODIFY] [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)
- `DEFAULT_MASTER_DATA`, `HOURLY_WAGE`, `calculateAge` の定義を削除し、`src/utils/` 配下からインポート
- `allProjectsSummary` の `useMemo` 内の計算ロジックを `calculateProjectsSummary` の呼び出しに置き換え

## Verification Plan

### Manual Verification
1. 開発環境を起動し、エラー画面（白画面）等が表示されないことを確認する。
2. アプリケーションにアクセスし、ダッシュボードの全体集計（予測粗利、進捗率、自社稼働時間など）が正しく計算・表示されていることを確認する。
3. 作業員管理画面を開き、各作業員の生年月日から年齢が正しく計算されて表示されていることを確認する。
4. アプリケーションの動作中にコンソールエラーが発生していないか確認する。
