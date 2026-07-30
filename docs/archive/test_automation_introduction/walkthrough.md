# ウォークスルー: 自動ユニットテスト/E2Eテストの導入

本対応により、給与計算などの重要ビジネスロジックに対するユニットテスト自動化、および設定画面や遅延ロード機能に対するE2Eブラウザテスト自動化の環境を正式導入しました。

## 実施した変更

### 1. テストフレームワークの選定・インストール
* **ユニットテスト**: Viteとの親和性に優れた高速な `Vitest` を採用。
* **E2Eテスト**: ブラウザをシミュレートする統合テストフレームワーク `@playwright/test` を採用。
* `package.json` に以下の npm スクリプトを追加しました。
  * `"test": "vitest run"` (ユニットテストの単発実行)
  * `"test:e2e": "playwright test"` (E2Eテストの実行)

### 2. 設定ファイルの追加
* **[vitest.config.ts](file:///c:/Users/katuy/Desktop/cost-management-app/vitest.config.ts)**:
  * TypeScriptでテストを実行するための基本設定ファイルを新規作成。
* **[playwright.config.ts](file:///c:/Users/katuy/Desktop/cost-management-app/playwright.config.ts)**:
  * ローカルのVite開発サーバー（`http://localhost:5173`）と連動し、テストランナーが既存のサーバーを再利用（`reuseExistingServer: true`）するように設定。

### 3. テストコードの実装
* **ユニットテスト**:
  * **[dateUtils.test.ts](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/dateUtils.test.ts)**: 年齢計算（生年月日からの算出）、勤続期間計算（月数・年数調整、退職日考慮など）の境界値テストを含む14ケースを実装。
  * **[workTimeUtils.test.ts](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/workTimeUtils.test.ts)**: 夏季・冬季における定時、休憩の控除、早出・残業時間計算、日跨ぎ（翌日フラグ）での夜勤計算、人工数（人数の算出）などのロジックを網羅する12ケースを実装。
* **E2Eテスト**:
  * **[settings_flow.spec.ts](file:///c:/Users/katuy/Desktop/cost-management-app/tests/e2e/settings_flow.spec.ts)**: 設定タブおよび各サブタブ（資格管理、自社情報）がエラーなく遷移・表示されることをテスト。
  * **[lazy_load.spec.ts](file:///c:/Users/katuy/Desktop/cost-management-app/tests/e2e/lazy_load.spec.ts)**: ダッシュボードから完了した現場をクリックした際、詳細情報が非同期に遅延フェッチされ、正しく作業項目テーブルがレンダリングされることをテスト。

---

## 実行結果

### 1. ユニットテスト (`npm run test`)
```text
 RUN  v4.1.7 C:/Users/katuy/Desktop/cost-management-app

 ✓ src/utils/workTimeUtils.test.ts (12 tests) 9ms
 ✓ src/utils/dateUtils.test.ts (14 tests) 16ms

 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  17:59:06
   Duration  838ms
```
すべてのビジネスロジックテストが成功しました。

### 2. E2Eテスト (`npm run test:e2e`)
```text
Running 2 tests using 2 workers

Homepage loaded.
Homepage loaded.
Found 10 completed projects.
Clicking completed project card: "25岩手(水沢)保全総合工事"
Successfully transitioned to Settings Tab.
Transitioned to Master tab. Site name in input: "25岩手(水沢)保全総合工事"
Successfully transitioned to Certification Manager.
Successfully transitioned to Company Info Settings.
  ok 1 [chromium] › tests\e2e\settings_flow.spec.ts:4:3 › Settings Flow E2E Test › 設定画面と各サブタブが正常に切り替わること (4.0s)
Loaded 5 tasks for this project.
  ok 2 [chromium] › tests\e2e\lazy_load.spec.ts:4:3 › Lazy Load E2E Test › 完了現場を選択したときに詳細データが遅延ロードされること (4.7s)

  2 passed (8.7s)
```
遅延ロード時のReactクラッシュ防止、および設定画面切り替えのE2Eテストがすべて正常に通過しました。

## 今後のデグレード防止
今後、労働時間計算ロジック（`workTimeUtils.ts`）や日付計算（`dateUtils.ts`）を更新した際は、`npm run test` を実行することで、意図しないバグや計算ズレを瞬時に検知できます。
また、フロントエンド全体の操作フローは `npm run test:e2e` で網羅検証が可能です。
