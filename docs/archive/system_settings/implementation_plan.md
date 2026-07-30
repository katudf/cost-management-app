## 目標 (Goal Description)
システム全体の共通設定（現在はハードコーディングされている「1人あたりの人工費用 (円/時間)」など）を管理する画面を作成します。
これにより、ソースコードを変更せずともアプリーケーションの画面上から人工費用を設定・変更できるようになり、その値が現場ごとの目標工数計算や予測粗利計算に動的に反映されるようにします。

## ユーザー確認事項 (User Review Required)
- `system_settings` テーブルを新規作成します。このテーブルは将来的に他のシステム設定も管理できるように設計します。
- 一人あたりの人工費用の初期値は、現在使用されている `4,375円` (35,000円/日相当) から、ご要望の `3,500円` (28,000円/日相当) に変更してよろしいでしょうか？

## 変更内容 (Proposed Changes)

### データベース
#### [NEW] `system_settings` テーブルの作成
- id: INTEGER (PRIMARY KEY, 常に 1)
- hourly_wage: INTEGER (NOT NULL, デフォルト 3500)
- updated_at: TIMESTAMP WITH TIME ZONE

### React コンポーネントおよびユーティリティ
#### [MODIFY] `src/utils/constants.js`
- `HOURLY_WAGE` のエクスポートを削除します（動的にDBから取得するように変更するため）。

#### [MODIFY] `src/utils/projectUtils.js`
- `calculateProjectsSummary` 関数が引数として `hourlyWage` を受け取るように変更します。

#### [MODIFY] `src/utils/excelImportUtils.js`
- `parseExcelForImport` 関数が引数として `hourlyWage` を受け取るように変更します。

#### [NEW] `src/components/tabs/SystemSettingsTab.jsx`
- 人工費用を入力・更新するためのシステム設定タブコンポーネントを作成します。

#### [MODIFY] `src/AdminApp.jsx`
- 起動時に `system_settings` テーブルから設定値 (`hourly_wage`) を取得し、ステートに保持する処理を追加します。
- メニューに「システム設定」タブを追加します。
- 各コンポーネント（`MasterTab` 等）やユーティリティ関数（`calculateProjectsSummary`）の呼び出し時に `hourlyWage` ステートを渡すように変更します。

## 確認計画 (Verification Plan)
### 自動テスト
- `npm run build` によるビルドエラーがないか確認します。
### 手動検証
- Supabase SQLエディタでテーブル作成後、アプリにアクセスし、「システム設定」画面が表示されるか確認します。
- システム設定画面から人工費用の値を更新し、DBに保存されること、及びアプリに即座に反映されることを確認します。
- 工事設定のExcelインポートや、ダッシュボードの予測粗利計算が、設定した新しい人工費用に基づいて正しく計算されているか確認します。
