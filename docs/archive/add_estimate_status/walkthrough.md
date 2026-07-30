# 現場ステータス「見積」の追加とフィルタリングの実装 - 完了報告

現場管理の利便性向上のため、新ステータス「見積」の追加と、それに伴う自動設定および表示制限を実装しました。

## 実施内容

### 1. 新ステータス「見積」の追加
システム全体で「見積」ステータスを認識できるようにしました。
- **[MasterTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/MasterTab.jsx)**: 現場設定のステータス選択肢に「見積」を追加しました。
- **[AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)**: ダッシュボードのフィルターに「見積」を追加し、オレンジ色の専用バッジスタイルを適用しました。
- **[useDashboardStats.js](file:///c:/Users/katuy/hooks/useDashboardStats.js)**: ホーム画面のデフォルト表示対象に「見積」を含めるようにしました。

### 2. 新規作成時のデフォルト設定
[useProjects.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useProjects.js) および [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx) のインポートロジックを修正し、新しい現場を追加した際の初期ステータスを「予定」から **「見積」** に変更しました。

### 3. 配置表の表示フィルタリング
[AssignmentChartTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/AssignmentChartTab.jsx) を修正し、配置表に表示される現場を **「予定」または「施工中」** のものだけに限定しました。これにより、見積段階の現場が配置表を圧迫することを防ぎます。

## 検証結果

- **デフォルトステータス**: 新規現場作成時に「見積」が自動選択されることを確認。
- **配置表の非表示**: ステータスが「見積」の現場が配置表に表示されないことを確認。
- **配置表の表示**: ステータスを「予定」または「施工中」に変更すると配置表に正しく表示されることを確認。
- **ダッシュボード**: 「見積」ステータスの現場をフィルター機能で正しく絞り込みできることを確認。

![ホーム画面のステータスフィルター](file:///C:/Users/katuy/.gemini/antigravity/brain/ea933222-5d56-49f2-a1df-37b12cabb5d0/home_filter_estimate_option_1776299118359.png)
