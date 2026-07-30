# docs/ — ドキュメント一覧

工事原価管理システムのドキュメントです。**現行仕様を知りたい場合は `design.md` と `specs/` を見てください。**

## 構成

| パス | 内容 | 更新すべきか |
|------|------|-------------|
| [`design.md`](design.md) | システム設計書。全体構成・DB設計・データフロー・コーディング規約・クリティカルパス | ✅ コード変更に追従させる |
| [`specs/`](specs/) | 機能単位の詳細仕様 | ✅ 該当機能の変更時に更新 |
| [`manuals/`](manuals/) | エンドユーザー向け操作マニュアル | ✅ UI変更時に更新 |
| [`archive/`](archive/) | 過去の実装作業ログ | ❌ 参照のみ。現行仕様の根拠にしない |
| `test_data/` | 動作確認用データ（`scripts/upload_purchase_ledger.js` が参照） | — |

## specs/

| ファイル | 内容 |
|---------|------|
| [`security-permissions.md`](specs/security-permissions.md) | 認証・ロール・RLSポリシー設計（最も新しい仕様書） |
| [`estimate-workflow.md`](specs/estimate-workflow.md) | 見積書の承認ワークフローと既知課題 |
| [`database.md`](specs/database.md) | テーブル定義（DDL）。最終的な正は `supabase/migrations/` |

## manuals/

| ファイル | 対象 |
|---------|------|
| [`admin-manual.md`](manuals/admin-manual.md) | 管理者画面（AdminApp）の全機能 |
| [`worker-manual.md`](manuals/worker-manual.md) | 作業員画面（WorkerApp）の日報入力 |
| [`role-overview.md`](manuals/role-overview.md) | 役割別の使い分け概要 |

## archive/

機能追加ごとの作業ログ（`task.md` / `implementation_plan.md` / `walkthrough.md` の3点セット）を
機能名ディレクトリ単位で保存しています。実装当時の検討経緯を追うためのもので、
**現在のコードと一致しない記述を多く含みます**。

現行の仕様は必ず `design.md` / `specs/` またはコード自体を参照してください。

## ドキュメント更新のルール

- アプリの画面が増えた／認証の仕組みが変わった → `design.md` §1〜§2
- テーブル・カラム・ステータス値が変わった → `design.md` §3 と `specs/database.md`
- 規約（禁止事項・推奨パターン）が変わった → `design.md` §8 と ルートの `CLAUDE.md`
- 新機能の設計を書き起こす → `specs/` に新規ファイルを作る（`archive/` には置かない）
