# 工期バリデーションの実装計画

現場の工期設定において、終了日が開始日より前の日付として登録されないようにバリデーションを追加し、エラー時にはトーストメッセージを表示するように改善します。

## 変更内容

### 1. [useProjects.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useProjects.js) [MODIFY]

- `handleProjectDateChange` 関数を以下のように修正します。
    - 変更後の期間（開始日・終了日）をチェックし、`終了日 < 開始日` となる場合は更新を中断します。
    - 不正な期間の場合は `showToast` を使用してエラーメッセージを表示します。

### 2. [MasterTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/MasterTab.jsx) [MODIFY]

- 日付入力の `onChange` ハンドラにおいて、`updateLayer` と `handleProjectDateChange` を個別に呼び出していた箇所を整理し、`handleProjectDateChange` の呼び出しのみに統一します（バリデーション後の一貫性を保つため、更新処理は `useProjects.js` 側で一括管理します）。

## 検証計画

### 手動確認
- 開始日に、終了日より後の日付を入力しようとした時、トーストメッセージ（エラー）が表示され、値が更新されない（DBに保存されない）ことを確認。
- 終了日に、開始日より前の日付を入力しようとした時、同様にエラーが表示され、値が更新されないことを確認。
- 正常な日付範囲での更新は、従来通り行われることを確認。
- 日付をクリア（空にする）操作が正常に行えることを確認。
