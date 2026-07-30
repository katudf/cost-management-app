# 「元請」チェックボックス追加と配置表表示の改善 - 修正内容の確認

工事基本設定に「元請」を判別するための項目を追加し、配置表（ガントチャート）の現場名表示をより詳細な情報が表示されるように改善しました。

## 実施した変更内容

### 1. 工事基本設定への項目追加
- **[MasterTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/MasterTab.jsx)**
    - 「顧客名」設定の横に「元請」チェックボックスを追加しました。
    - チェックを入れるとデータベースの `is_prime_contractor` カラムが `true` に更新されます。

### 2. データ連携の強化
- **[useSupabaseData.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useSupabaseData.js)**
    - データベースからプロジェクト情報を取得する際、`is_prime_contractor` の値も取得・管理するように拡張しました。
- **[AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)**
    - 配置表タブに顧客リストを渡し、IDから顧客名を逆引きできるようにしました。

### 3. 配置表の表示ロジック改善
- **[AssignmentChartTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/AssignmentChartTab.jsx)**
    - 現場名を2段表示に変更しました。
    - **上段**: 現場名（太字）
    - **下段**: 属性情報（小文字）
        - 「元請」にチェックがある場合： **元請** と表示
        - チェックがない場合： 設定された **顧客名** を表示

## 確認事項

- [x] 工事基本設定（マスタータブ）で「元請」チェックボックスが表示され、操作できる。
- [x] 配置表の左側の現場名部分が2段になり、元請または顧客名が表示されている。

> [!TIP]
> 現場名の下に顧客名や元請情報が表示されるようになったことで、複数の元請けから同じ現場名で発注がある場合などの見分けが容易になりました。
