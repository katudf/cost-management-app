# 修正内容の確認 (Walkthrough)

システム設定画面から自社の社印と代表印（担当印）の画像データをアップロードし、見積書のPDF出力に自動で反映させる機能を実装完了しました。

## 実装された機能

### 1. 自社情報画面からのアップロード
設定の「自社情報」タブ最下部に、画像をアップロードできるエリアを追加しました。
- クリックまたはドラッグ＆ドロップで画像を選択すると、ファイルがSupabaseのStorageへ保存されます。
- 配置されている画像を小窓の「✖️」ボタンからキャンセルすることも可能です。

### 2. 見積書PDFへの反映
- PDFの表紙の右端にある「検印枠・社印枠」に、アップロードされた印鑑画像が自動で割り当てられるように修正しました。
- （左側の枠は代表印、右側の枠は社印として出力されます。※「承認者印（検印）」を有効にしている場合のみ枠が2つ表示されます）

## 変更ファイル
- [SystemSettingsTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/SystemSettingsTab.jsx): ファイルアップロード用UIと保存処理の追加
- [EstimatePDF.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimatePDF.jsx): PDF出力時に設定画像のURLから画像を描画する処理の追加

## ⚠️ ユーザー様による確認事項・アクション
> [!IMPORTANT]
> 機能を有効にするためには、データベース側での準備が必要です。
> 以下の4つのSQLコマンドを、SupabaseのSQL Editorにて実行してください。

```sql
-- 1. "stamps" という公開バケットを作成
INSERT INTO storage.buckets (id, name, public) 
VALUES ('stamps', 'stamps', true)
ON CONFLICT (id) DO NOTHING;

-- 2. バケットの読み取りを全員に許可
CREATE POLICY "Public Access" 
ON storage.objects FOR SELECT 
USING ( bucket_id = 'stamps' );

-- 3. 画像のアップロード・更新・削除を許可するポリシー
CREATE POLICY "Allow all actions" 
ON storage.objects FOR ALL 
USING ( bucket_id = 'stamps' ) 
WITH CHECK ( bucket_id = 'stamps' );

-- 4. 自社情報テーブルに「代表印」の画像の保存先URLカラムを追加
ALTER TABLE system_settings 
ADD COLUMN IF NOT EXISTS stamp_representative_url TEXT;

-- ※ 'stamp_company_url' (社印) はシステム上すでに取得項目として定義されているためそのまま利用します。
```

## 動作確認手順
1. Supabaseで上記のSQLを実行済みにする。
2. アプリの「システム設定」＞「自社情報」を開く。
3. デスクトップなどから「背景透過済みの社印（PNG画像推奨）」を枠に登録し、下部のシステム設定ボタンを保存。
4. 見積書のプレビューPDFを出力し、枠部分に画像が綺麗に収まっていることを確認する。
