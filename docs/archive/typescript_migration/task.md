# タスクリスト: TypeScript の段階的導入

- [x] TypeScript 環境の構築
  - [x] `tsconfig.json` の作成と設定
  - [x] 必要なパッケージ（`typescript`, `@types/react`, `@types/react-dom` 等）のインストールと設定確認
- [x] 型定義の作成と整備
  - [x] `src/types/` ディレクトリの作成
  - [x] データベースおよびドメイン共通モデル（`Worker`, `Project`, `Assignment`, `TaskRecord` 等）の型定義ファイルの作成
- [x] 共通ユーティリティの TypeScript 移行
  - [x] `src/utils/dateUtils.js` から `src/utils/dateUtils.ts` への移行と型アノテーション適用
  - [x] `src/utils/workTimeUtils.js` から `src/utils/workTimeUtils.ts` への移行と型アノテーション適用
- [x] 動作確認とビルド検証
  - [x] ビルドコマンド (`npm run build` もしくは `tsc --noEmit`) がエラーなしで通過することを確認
  - [x] ローカル開発サーバーでの挙動と既存テストスイートの通過を確認

