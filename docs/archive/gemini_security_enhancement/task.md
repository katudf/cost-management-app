# タスクリスト: Gemini APIキーのセキュリティ強化

- [x] Supabase Edge Functions の作成と設定
  - [x] `supabase/functions/gemini-optimize/index.ts` の新規作成
  - [x] ローカル環境変数 `GEMINI_API_KEY` の設定 (Deno)
  - [/] Edge Functions のローカル起動と検証 (`supabase functions serve`)
- [x] フロントエンド ユーティリティの修正
  - [x] `src/utils/aiOptimizeUtils.js` の変更 (Edge Functions 呼び出しへの移行、不要インポート削除)
- [x] カスタムフックおよびアプリケーションの修正
  - [x] `src/hooks/useSupabaseData.js` の修正 (`geminiApiKey` から `isGeminiEnabled` へ)
  - [x] `src/AdminApp.jsx` の修正 (不要引数の削除、`canOptimize` 判定の更新)
  - [x] `src/components/tabs/SystemSettingsTab.jsx` の修正 (API有効表示の修正)
- [/] 動作検証と動作確認
  - [/] Excel インポート時のAI最適化の動作検証 (正常系)
  - [/] エラー時およびAPIキー未設定時のフォールバック動作検証 (異常系)
  - [/] 不要になった npm パッケージの削除検討 (`@google/generative-ai`)
- [ ] ドキュメントの更新
  - [ ] `CLAUDE.md` および `docs/design.md` の関連情報の更新
  - [ ] `walkthrough.md` の作成
