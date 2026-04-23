# 見積書 PDF ダウンロード機能統合計画

`EstimateList.jsx` に見積書を PDF としてダウンロードする機能を統合します。

## ユーザーレビューが必要な事項

> [!IMPORTANT]
> **Supabase インポートパスの調整**
> ユーザー様の提示したコードでは `from './supabase'` となっていますが、プロジェクトの構造（`src/lib/supabase.js`）に合わせて `from './lib/supabase'` として実装します。これにより前回発生した 500 エラーの再発を防止します。

## 提案される変更内容

### [EstimateList.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimateList.jsx) の修正

#### 【変更1】インポートの追加
- `downloadEstimatePDF`, `fetchEstimateById`, `supabase` をインポートします。
- `lucide-react` から `Download` アイコンを追加します。

#### 【変更2】handleDownloadPDF 関数の実装
- 見積データとシステム設定をフェッチし、`downloadEstimatePDF` を呼び出す非同期関数を `EstimateList` コンポーネント内に追加します。

#### 【変更3】EstimateRow への統合
- `EstimateRow` コンポーネントに `onDownload` プロップを追加します。
- 各行の操作エリアに PDF ダウンロード用のボタン（緑色のアイコン）を追加します。

---

## 確認計画

### 手動確認事項
- [ ] 見積一覧の各行に「PDF出力」ボタンが表示されていること。
- [ ] ボタンをクリックした際、対象の見積データが正しくフェッチされ、PDF のダウンロードが開始されること。
- [ ] エラー（データ不足等）が発生した際に、正しくアラートが表示されること。
