# TypeScriptの段階的導入 実装計画書

## 目的
既存の JavaScript コードベースに対して段階的に TypeScript を導入し、型安全性を担保することでデグレードを防止し、今後の機能追加やリファクタリング時の安全性を高めます。

## 影響分析

1. **設計ポリシー（Design Policies）との整合性**:
   * `docs/architecture.md` の「型定義の集約」に完全に準拠します。
   * Supabaseの自動生成型定義を活用し、フロントエンドのオブジェクト構造とスキーマの一貫性を強制します。

2. **重要経路（Critical Paths）への副作用**:
   * 実行コードのロジック自体は変更せず、コンパイル時の静的解析を追加するため、正常にビルドできれば実行時の挙動（計算ロジックやSupabase通信）に悪影響はありません。
   * 既存の `.js` / `.jsx` ファイルと混在可能（`allowJs: true`）に設定し、段階的に進行します。

3. **デグレードの防止**:
   * 変更対象はまず、UIに依存しない「共通ユーティリティ（`src/utils/` 配下の日付・時間・計算系ロジック）」から着手します。
   * テストスクリプト等により、TS化後も既存の動作が一切崩れていないことを確認します。

## 提案される変更点

### 1. TypeScript環境の設定

#### [NEW] `tsconfig.json`
* TypeScriptコンパイラ（tsc）の設定ファイル。段階的移行のため、以下を有効にします。
  * `allowJs: true` (JSファイルを許可)
  * `checkJs: false` (移行途中のJSファイルの厳格チェックは一旦無効化)
  * `strict: true` (TSファイルに対しては厳格な型チェックを適用)
  * `jsx: "react-jsx"` (React用の設定)

#### [MODIFY] `vite.config.js` / `package.json`
* TypeScriptでビルド・開発できるよう、開発依存関係に `typescript` および Vite 用の型チェックプラグイン（必要に応じて）を追加。

### 2. 共通型定義の集約

#### [NEW] `src/types/` ディレクトリの作成
* データベーススキーマから生成された型定義や、アプリケーション共通で利用するドメイン型（アサイン情報、作業員、日報レコードなど）を定義します。

### 3. ユーティリティ関数の TypeScript 化 (拡張子変更と型付け)

#### [MODIFY] `src/utils/dateUtils.js` → `src/utils/dateUtils.ts` [NEW/DELETE]
* 日付加算、フォーマット、月曜日取得など、アサイン表や日報で多用される日付関数の型定義化。

#### [MODIFY] `src/utils/workTimeUtils.js` → `src/utils/workTimeUtils.ts` [NEW/DELETE]
* 労働時間、残業時間の計算ロジックなどの型定義化。

---

## 検証計画

### 動作検証
1. `npm run build` を実行し、TypeScriptのコンパイルおよびViteのバンドルビルドが正常に完了すること。
2. 開発サーバー (`npm run dev`) が問題なく動作し、E2Eテスト (`test_settings_flow.py` 等) がすべて通過すること。
3. 計算ロジック等の整合性を手動・自動で検証。
