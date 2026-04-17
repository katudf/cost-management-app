# 配置表の表示改善計画

配置表（AssignmentChartTab）において、画面の横幅を有効活用し、より多くの日数を一度に表示できるように改善します。

## ユーザーレビューが必要な事項

- **表示日数**: 現在の28日（4週間）から56日（8週間）へ倍増させる予定ですが、これで問題ないか。
- **画面幅**: 配置表タブのみ、全体の最大幅制限（max-w-6xl）を解除して画面いっぱいに表示するようにします。

## 変更内容

### 1. [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx) [MODIFY]

- `activeTab` が `'assignment'` の場合に、メインコンテナの `max-w-6xl` を `max-w-none`（またはより広い幅）に変更します。

### 2. [AssignmentChartTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/AssignmentChartTab.jsx) [MODIFY]

- `totalDays` 定数を `28` から `56` に変更します。
- 前後の期間へ移動するボタン（`movePeriod`）の送り日数を、4週間から8週間に合わせます。

## 検証計画

### 手動確認
- 配置表タブを開いた時に、画面幅が広がっていることを確認。
- 合計56日分の列が表示されていることを確認。
- 「今日」ボタンや期間移動ボタンが正しく動作することを確認。
- Excel出力機能が56日分正しく出力されるか確認。
