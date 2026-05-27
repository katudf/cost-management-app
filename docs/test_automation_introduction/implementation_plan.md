# 自動ユニットテスト/E2Eテストの導入 計画

本計画では、システムの信頼性向上とデグレード防止のため、テスト自動化環境を正式に導入します。
ビジネスロジックの正確性を担保する「ユニットテスト」と、UI操作の正常性を担保する「E2Eテスト」の二段構えで構築します。

## 設計方針・技術選定

1. **ユニットテスト**: `Vitest` を採用します。
   * Viteプロジェクトとの親和性が極めて高く、設定が最小限で済むため。
   * TypeScriptを標準でサポートしており、実行速度が非常に高速なため。
   * 対象: `src/utils/workTimeUtils.ts` (労働時間・残業計算ロジック) および `src/utils/dateUtils.ts` (日付計算、年齢計算等)。
2. **E2Eテスト**: `@playwright/test` (Node.js/TypeScript版) を採用します。
   * すでに Python + Playwright による動作検証スクリプトを作成しましたが、これをフロントエンドのテストフレームワーク（Playwright Test runner）として正式に統合し、TypeScriptで記述します。
   * ローカルのVite開発サーバーに対して実行できるようにします。
   * 対象: 「設定画面（資格・自社情報）の操作フロー」および「完了現場選択時の詳細データ遅延ロード処理」。

---

## Proposed Changes

### [Component Name] テスト構成と設定ファイル

#### [MODIFY] [package.json](file:///c:/Users/katuy/Desktop/cost-management-app/package.json)
* `devDependencies` に `vitest` および `@playwright/test` を追加します。
* `scripts` に `"test": "vitest run"` および `"test:e2e": "playwright test"` を追加します。

#### [NEW] [vitest.config.ts](file:///c:/Users/katuy/Desktop/cost-management-app/vitest.config.ts)
* Vitestのテスト設定ファイルを新規作成します。

#### [NEW] [playwright.config.ts](file:///c:/Users/katuy/Desktop/cost-management-app/playwright.config.ts)
* Playwright Testの設定ファイルを新規作成し、ローカル開発サーバー（`http://localhost:5173`）と連携するように設定します。

---

### [Component Name] ユニットテストの実装

#### [NEW] [workTimeUtils.test.ts](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/workTimeUtils.test.ts)
* `workTimeUtils.ts` 内の主要なロジックに対するユニットテスト。
  * `calculateWorkHours` のテスト（出退勤時間、休憩時間、深夜時間、残業時間の算出検証）。
  * 異常値入力（時刻形式エラー、日付逆転など）に対するフォールバック検証。

#### [NEW] [dateUtils.test.ts](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/dateUtils.test.ts)
* `dateUtils.ts` に対するユニットテスト。
  * `calculateAge` (生年月日から年齢算出) の境界値（誕生日当日、前日など）の検証。
  * その他の日付フォーマット変換の検証。

---

### [Component Name] E2Eテストの実装

#### [NEW] [settings_flow.spec.ts](file:///c:/Users/katuy/Desktop/cost-management-app/tests/e2e/settings_flow.spec.ts)
* Playwrightを用いたE2Eテスト。
  * 「設定」タブを開き、システム共通設定が表示されることの検証。
  * 「資格管理」サブタブを開き、資格情報マスターが表示されることの検証。
  * 「自社情報」サブタブを開き、自社情報設定が表示されることの検証。

#### [NEW] [lazy_load.spec.ts](file:///c:/Users/katuy/Desktop/cost-management-app/tests/e2e/lazy_load.spec.ts)
* Playwrightを用いたE2Eテスト。
  * 初期表示（ダッシュボード）で、完了現場の `_isLoaded` が false である（詳細データが未フェッチ）状態を確認。
  * 完了現場のカードをクリックし、工事設定画面（MasterTab）へ遷移した後に詳細データ（タスクなど）が非同期ロードされ、正しく表示されるかの検証。

---

## Verification Plan

### Automated Tests
1. **ユニットテストの実行**:
   * コマンド: `npm run test`
   * 期待値: 作成したすべてのユニットテストがエラーなしで通過すること。
2. **E2Eテストの実行**:
   * コマンド: `npm run test:e2e`
   * 期待値: ローカルで起動しているVite開発サーバーをPlaywrightが自動検出し、ブラウザテストを実行して設定画面および遅延ロードの検証がすべて通過すること。
