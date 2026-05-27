# Gemini APIキーのセキュリティ強化（Edge Functions移行）実装計画書

## 目的
クライアントサイド（フロントエンド）の環境変数 `VITE_GEMINI_API_KEY` を廃止し、Supabase Edge Functions 経由で Gemini API を呼び出すことで、APIキーの漏洩リスクを完全に排除します。

## 影響分析

1. **設計ポリシー（Design Policies）との整合性**:
   * APIキー等の機密情報をクライアントサイドで保持しないというセキュリティ原則に整合します。
   * Supabase呼び出しのルール（UIから直接外部APIを呼ばず、Supabaseサービス層を経由する）に合致します。

2. **重要経路（Critical Paths）への副作用**:
   * 影響を受けるのは、Excelインポート時などの項目名最適化処理（`src/utils/aiOptimizeUtils.js`）のみです。日報登録やアサインチャートといった最重要機能（原価計算等）への副作用はありません。

3. **デグレードの防止**:
   * Edge Functions がエラーやタイムアウトになった場合、または本番環境でAPIキーが未設定の場合でも、フロントエンドがクラッシュせず「AIをスキップしてそのままインポートする」フローへと正常にフォールバックされることを担保します。

## 提案される変更点

### Supabase Edge Functions

#### [NEW] `supabase/functions/gemini-optimize/index.ts`
Deno 環境で動作する Supabase Edge Function。
* `Deno.env.get("GEMINI_API_KEY")` でサーバー側のAPIキーを取得。
* CORSヘッダーに対応し、`POST` リクエストで受け取った項目名（`items`）を元に Gemini API を呼び出し、結果（JSON）を返却。
* API利用量メタデータ（`usageMetadata`）も併せてレスポンスに含め、フロントエンドの利用状況表示を維持する。

### フロントエンド

#### [MODIFY] `src/utils/aiOptimizeUtils.js`
* `@google/generative-ai` のインポートとライブラリ依存関係を削除。
* `optimizeItemsWithGemini` のシグネチャを変更（`apiKey` 引数を削除）。
* `supabase.functions.invoke('gemini-optimize', { body: { items } })` で Edge Function を呼び出す形式に変更。

#### [MODIFY] `src/hooks/useSupabaseData.js`
* `geminiApiKey` 状態変数の保持を廃止し、`isGeminiEnabled` (初期値: `true`) に置き換え。
* 初期化時に簡単なヘルスチェックまたは Edge Function が利用可能かのチェックを行う（または常に有効と仮定し、呼び出し時にエラーハンドリングする）。

#### [MODIFY] `src/AdminApp.jsx`
* `optimizeItemsWithGemini` 呼び出し時の引数から `geminiApiKey` を削除。
* `canOptimize` の判定基準を `geminiApiKey` の有無から `isGeminiEnabled` へ変更。

#### [MODIFY] `src/components/tabs/SystemSettingsTab.jsx`
* 設定画面の「Gemini AI 有効 / 未設定」の表示ロジックを、APIキーの存在チェックから Edge Functions の稼働ステータスチェックへ変更。

## 検証計画

### 開発環境での検証
1. ローカルの Supabase CLI を起動し、`supabase functions serve gemini-optimize` を使ってローカルで Edge Function を動作確認。
2. フロントエンドから Excel ファイルをインポートし、AI最適化が正常に動作するか（レスポンスを正しくマッピングでき、利用量カウンタが更新されるか）検証。
3. APIキー未設定時または関数エラー時のエラーハンドリングが動作し、「そのまま読み込む」でインポートを続行できるか検証。

### 本番環境での検証
1. Supabaseのダッシュボードにログインし、Edge Function `gemini-optimize` に環境変数 `GEMINI_API_KEY` を設定。
2. Edge Function をデプロイし、本番環境でインポート時のAI最適化が動作することを確認。
