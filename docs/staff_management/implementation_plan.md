# 見積担当者（関係者）の独立管理機能の実装計画

将来的な承認フローを見据え、現在「作業員 (Workers)」一覧から選択している見積書の担当者を分離し、システム設定にて専用の「関係者 (Office Staff)」として登録・管理できるようにします。今回はその第一段階として、登録・編集機能と見積書での選択リストの置き換えを実施します。

## Database 設定変更 (User Review Required)
> [!IMPORTANT]
> 既存の作業員テーブルと分離するため、新しく「関係者 (office_staff)」テーブルを作成し、見積書テーブルとの関連付けを行います。
> 実装開始前に以下のSQLをSupabaseで実行してください。

```sql
-- 1. 担当者・関係者マスターテーブルの作成
CREATE TABLE IF NOT EXISTS office_staff (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT, -- (将来的な承認権限などのためのプレースホルダー)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. 見積書テーブルに新しく「担当者ID」カラムを追加しリレーションを設定
ALTER TABLE estimates 
ADD COLUMN IF NOT EXISTS staff_id INTEGER REFERENCES office_staff(id) ON DELETE SET NULL;
```

## Proposed Changes

### SystemSettingsTab.jsx（担当者管理UIの追加）
- システム設定に新しく「担当者・関係者管理」タブを追加します。
- 登録・編集・削除ができる一覧画面を実装し、名前とシンプルな役職・権限メモなどを書き込めるようにします。

#### [MODIFY] [SystemSettingsTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/SystemSettingsTab.jsx)

---

### 見積書作成・出力処理側の変更
見積書編集画面で、担当者のプルダウンを「作業員」から「新しく作った関係者」を読み込むように変更します。
あわせて、保存・読み込み時のデータ紐付け（ID）を `staff_id` に切り替えます。

#### [MODIFY] [EstimateForm.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimateForm.jsx)
- `office_staff` テーブルからデータを取得しプルダウンに設定。
- 保存・読み込みのプロパティを `staff_id` に変更。

#### [MODIFY] [supabaseEstimates.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/supabaseEstimates.js)
- 見積一覧や詳細を取得する際に、`office_staff` テーブルを結合して担当者名などの情報を含めて取得するようにSQLクエリを変更。

#### [MODIFY] [EstimatePDF.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimatePDF.jsx)
- PDF出力時に印字される担当者名を、新しい `office_staff` からのデータに切り替え。

## ⚠️ 既存のデータに関する制限
今回の実装ではデータ構造を分離するため、**これまでに作成された過去の見積書の「担当者」欄はすべて未選択（空欄）の状態へリセット**されます（新しく追加される `staff_id` にはまだ何も紐付いていないため）。
過去のデータで担当者名を再度表示させたい場合は、新しい設定画面で担当者を登録後、見積書を1度開いて担当者を選び直して再保存する必要があります。

## Verification Plan
1. SQLを実行しテーブルが構築されていることを確認する。
2. システム設定にて担当者情報を新しく追加・登録する。
3. 見積書の新規作成または編集画面で、今追加した担当者がプルダウンから選べることを確認する。
4. 選択して保存を行い、一覧やPDFファイルで登録した担当者名が正常に出力されることを確認する。
