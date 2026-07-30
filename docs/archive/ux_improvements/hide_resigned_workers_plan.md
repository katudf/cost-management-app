# 実装計画: 退社済み作業員の非表示化

作業員情報に「退社日」が入力されている場合、その作業員を「運用上の選択肢」から除外し、画面を整理します。

## 変更内容の概要

### 1. 配置表 (AssignmentChartTab)
- **非表示対象**: 配置表の左側に並ぶ作業員リスト。
- **理由**: 退社済みの作業員に今後の予定を割り振ることはないため。
- **実装**: `workers` プロパティを `filter` して、`resignation_date` が設定されていない作業員のみを表示します。

### 2. 実績入力 (InputTab)
- **非表示対象**: 作業員選択のドロップダウン。
- **理由**: 誤入力を防ぐため。
- **実装**: 作業員リストの表示時にフィルタリングを行います。

### 3. 工事設定 (MasterTab / 工事管理)
- **非表示対象**: 職長（責任者）選択のドロップダウン。
- **理由**: 退職者を職長に任命することはないため。
- **実装**: セレクトボックスの選択肢をフィルタリングします。

### 4. 作業員管理 (WorkersTab)
- **デフォルト**: 退社済みの作業員は非表示。
- **追加機能**: 「退社済みの作業員を表示」チェックボックスを追加します。
- **理由**: 過去の情報を編集したり、間違えて入力した退社日を消したりするために、完全に消去はせず切り替え可能にします。

## Proposed Changes

### [AdminApp / Hooks]

#### [MODIFY] [AdminApp_new.jsx](file:///c:/Users/katuy\Desktop/cost-management-app/src/AdminApp_new.jsx)
- `InputTab` や `MasterTab` に渡す `workers` を、状況に応じてフィルタリングするか、フィルタリング済みの `activeWorkers` を別途生成して渡すように調整します。

### [Tabs]

#### [MODIFY] [WorkersTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/WorkersTab.jsx)
- 退社済み表示切り替え用の `showResigned` ステートを追加。
- チェックボックス UI の追加。
- リストのフィルタリングロジック追加。

#### [MODIFY] [AssignmentChartTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/AssignmentChartTab.jsx)
- 表示する作業員行を `workers.filter(w => !w.resignation_date)` で制限します。

## Open Questions
- **過去の配置データについて**: 配置表で「過去の週」を見た場合でも、退社済みの人は非表示でよいでしょうか？（過去の表には名前が残っているが、左側の行リストからは消えるイメージです）。
- **集計データ**: 実績入力などですでに入力済みのデータ（過去分）がある場合、集計画面（WorkersTabの右側など）では退社済みの人も表示し続けるべきでしょうか？今回は「選択肢からの除外」を優先します。

## Verification Plan

### Manual Verification
1. 作業員に退社日を入力し、保存する。
2. 配置表を開き、その作業員の行が消えていることを確認。
3. 実績入力画面を開き、作業員選択リストにその名前が出てこないことを確認。
4. 作業員管理画面で、デフォルトでは表示されず、トグルをONにすると表示されることを確認。
