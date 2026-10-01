# 見積承認フロー修正 実装・検証報告

更新: 2026-10-01（日本時間）
指示書: `ESTIMATE_APPROVAL_FIX_20261001.md`
状態: **修正1〜4とNaN表示の実装・ローカル検証完了。本番DB適用済み（2026-10-01 13:04 JST）。フロントエンド未デプロイ。**

## 1. 稼働DBの読み取り調査

REPORT / REQUEST / ルートAGENTS / docs/AGENTS / 設計書 / 見積エディタ設計 / 権限設計を確認後、実装前に調査した。
Supabase CLIのリンク先は `quaollobtalcixmlpmps`。Management API経由のSELECTとREAD ONLYトランザクションを使用した。
読み取り調査時点では本番データのINSERT/UPDATE/DELETE、マイグレーション適用、分岐作成は行っていない。後続のユーザー指示による適用は§5に記録。

確認した事実:

- `approve_estimate` / `return_estimate` は固定search_pathのSECURITY DEFINER、指名承認者の照合、pending判定、親行FOR UPDATE、DB時刻による証跡を実装。authenticatedにEXECUTEがあり、PUBLIC/anonにはない。
- `protect_estimate_approval_columns` は承認証跡・承認/差し戻し遷移・作成者/admin以外の下書き戻しを拒否するが、非draftの内容・承認者変更を一律には拒否していない。
- `save_estimate_items_v2` は固定search_pathのSECURITY INVOKER。親の状態確認と行ロックがない。PUBLIC/anonのEXECUTEは剥奪済み。
- estimatesはadmin/office用のコマンド別RLS。UPDATEは削除されていない行なら状態に関係なく許可。estimate_items / estimate_sheetsはadmin/office用ALLポリシーで状態制限なし。
- 非draftの子テーブル変更を保護するトリガーは存在しない。
- **見積番号は既に `estimates_estimate_number_key` の全行対象UNIQUE制約で保護されていた。** 有効な番号の重複は0件。削除済みを含める既存仕様を維持し、部分一意制約への変更はしない。
- 支払条件はNOT NULL、既定値は「従来通り」。保存済み空文字はそのまま維持し、null/欠損だけ互換読込の既定値で補完する。
- 明細金額トリガーはamountがnullの場合だけ数量×単価を補完。既存の計算済み金額を上書きしない。
- estimates→明細/シートはON DELETE CASCADE、カテゴリ/シートリンクはON DELETE SET NULL。削除検証にもこの制約を反映した。

再調査用SQL: `scripts/estimate-approval-readonly.sql`。

## 2. 実装

### 修正1: 最新内容の保存と申請

`buildCurrentSavePayload` を通常保存・申請で共用。最新の表紙、計算済み明細、シート、リンクを `save_estimate_v3` に送信する。
申請は同じトランザクションの最後でpendingに遷移し、返却IDを保持する。Reactの親props更新を待たず、新規見積の申請直後にもロックする。
エラーはtoastで通知し、入力・申請モーダル・直前の保存スナップショットを保持する。番号競合は23505に応じて再採番を案内する。
処理中refで通常保存・申請・承認・差し戻し・状態遷移の重複を防ぎ、編集・シート操作・モーダルボタンも無効化する。

### 修正2: UIとDBの編集制限

状態変更成功時にDBのstatusを `originalStatus` に反映。承認・差し戻し証跡は既存のRPC後再取得を維持した。
追加マイグレーションで、非draftの内容列・承認者変更と明細/シートの直接INSERT/UPDATE/DELETEを拒否する。
子テーブルの操作も親行をFOR UPDATEして状態確認し、v2/v3保存・承認のロック対象を揃える。
状態遷移はdraft→pending、pending→approved/returned（既存承認RPC）、approved→submitted、submitted→ordered/lost、および作成者/adminの下書き戻し。
下書き戻しは同じUPDATEで内容を変えることを許可せず、DBが承認証跡と理由をクリアする。正式な戻し後に編集できる。
論理削除・復元、受注時project_id連携、親削除のCASCADE、期限切れ削除に伴うFKリンク解除は維持する。
承認RPCのフラグは内容ロックを迂回しない。既存の指名承認者チェック・DB時刻・行ロックは変更していない。

### 修正3: 一体保存

`save_estimate_v3` は認証済みadmin/officeだけが実行できる固定search_pathのSECURITY DEFINER。
表紙の更新可能フィールドを明示し、ID・承認証跡・状態などをJSONで持ち込むことを拒否する。
新規はINSERT、既存は非削除draftをFOR UPDATE。所属シート、UUIDの重複、不正な参照インデックス、承認者、必須項目を検査する。
v2のシート/明細/リンク再マップを使用し、保存後のトップシート合計＋税額と表紙合計の一致を検査する。不一致を含む途中失敗は全体がロールバックされる。
保存成功時だけID・シートUUID・シートリンク・スナップショット・dirty・ローカル退避を更新する。
既存の一意制約を維持する追加SQL、RPCのPUBLIC/anon剥奪とauthenticatedへのEXECUTE付与を含む。

### 修正4・関連調整

空の支払条件と不正な自動退避時刻の既存修正を維持し、回帰テストを追加。
税率0を再読込・合計計算でも維持。新しいINSERT保護に合わせて、見積複製では承認証跡を引き継がない。

## 3. 検証結果

| 検証 | 結果 |
|---|---|
| `npm test` | **19ファイル / 276件成功** |
| 隔離PostgreSQL 17 / SQL回帰 | **120件成功** |
| Chrome / 実エディタ＋模擬Supabase API | **9件成功** |
| `npm run build` | **成功**。既知の500kB超chunk警告のみ |
| `git diff --check` | 成功 |

DB回帰は `127.0.0.1:55432` の専用クラスタに毎回新規検証DBを作成し、合成データのみ使用した。
見積テーブルの列・制約・RLSは稼働定義に合わせ、承認/ロール判定関数は読み取った稼働定義を使用。関連マスタはFKキーを持つ最小fixture。
管理者接続はセットアップに使用し、操作テストは `SET ROLE authenticated` と合成auth.uidで作成者・指名承認者・他人・admin・viewerを切り替えた。

DBで確認したもの:

- 新規保存/申請、既存の最新表紙・明細の保存/再申請、空の支払条件
- pending/approved双方で、4担当者の表紙・承認者・明細・シート直接操作およびv2/v3保存の拒否
- 指名承認者だけの承認、二重承認拒否、差し戻し、作成者/adminの下書き戻し、証跡クリア、再申請
- 明細制約違反を注入した新規/既存保存の全体ロールバック、孤立表紙なし、再試行成功
- シート所属・参照検査、仮シート/カテゴリリンク再マップ、DB番号競合、表紙合計不一致の拒否
- 匿名/認証なし/viewerのRPC拒否
- 保存が先にロックする競合と承認が先にロックする競合
- 提出済み・受注・失注、受注時project_id更新、論理削除/復元、親CASCADE削除、リンク付き期限切れ削除

ブラウザで確認したもの:

- 新規未保存から、最新表紙・明細・合計を1回のRPCで申請
- 処理中の連打防止、再読込なしの申請直後ロック
- 保存失敗時の入力・モーダル・保存スナップショット保持とtoast、同じIDでの再試行
- 指名承認者画面での承認とDB証跡の再取得・ロック継続
- 保存済み空の支払条件の再読込、入力不備ではRPC実行なし
- 通常の新規下書き保存→ID維持→編集→申請
- 提出済み→受注→Projects/ProjectTasksへの連携

再実行:

```powershell
npm test
npm run build
# 専用のローカルPostgreSQLを起動した状態（既存5432や本番は使用しない）
python scripts/test-estimate-approval-db.py --port 55432
# Viteをローカルで起動した状態
python scripts/test-estimate-approval-ui.py --url http://127.0.0.1:5181
```

Windowsサンドボックス内ではesbuild/ブラウザ/pg_ctlの子プロセス起動にEPERM等が生じ、通常権限でローカル検証を実行した。テスト自体の失敗とは区別している。

## 4. DB適用・未検証・次の作業

- **本番マイグレーションは後続指示で適用済み。デプロイ・コミットは未実行。** 承認済み見積261001-0001-001とLINE WORKSの他作業者差分には触れていない。
- 新マイグレーション: `supabase/migrations/20261001000000_atomic_estimate_save_and_content_lock.sql`。
- **本番DBには `save_estimate_v3` が適用済み。** 本番画面で新しい保存・申請処理を使うには、対応するフロントエンドのデプロイが必要。旧UIによるdraft→pending直接UPDATEは新しい保護トリガーで拒否される。
- 本番Supabase Auth/PostgREST/RPCとブラウザを一緒に通す総合試験は未実施。ブラウザAPIは完全模擬、DB操作は別の実PostgreSQLで確認した。隔離Supabase環境での適用と総合試験が次の確認項目。
- 実PDFの生成・抽出による空欄検証、日付欄の手操作再現確認は今回未実施。既存のプレビュー生成は変更していない。
- 受注時のProjects/ProjectTasks連携は従来どおり別処理。見積の一体保存とは別トランザクションで、連携失敗時はtoastで通知する。
- 旧フォーム/Excel取込/複製などのレガシー保存経路にはv2を残し、非draft更新だけDBで拒否する。今回の一体保存への切替対象は現行WYSIWYGエディタ。
- 検証専用クラスタのデータ・一時エントリーはgitignore対象の `scratch/` 内。テスト終了後クラスタと今回のViteは停止する。

## 5. 本番DB適用記録（追加指示）

実行指示: ユーザー「本番DBに適用してください」。
対象: `quaollobtalcixmlpmps` / version `20261001000000` / name `atomic_estimate_save_and_content_lock`。
適用・検証: 2026-10-01 13:04 JST。

Supabase CLIのManagement API経由で、対象マイグレーションのみ実行した。
本番履歴とローカル履歴に既存の日時差異があるため、一括db pushは使用していない。他の未適用SQLは含めていない。
BEGIN/COMMIT内で対象DDLと `supabase_migrations.schema_migrations` への履歴登録をまとめた。
再実行拒否、advisory transaction lock、lock_timeout=5秒、statement_timeout=60秒を設定。
`NOTIFY pgrst, 'reload schema'` を同じトランザクションで実行した。

確認結果:

- version/name/適用SQLが履歴に記録されている。履歴SQLのMD5: `0095bb7e0a7c84c6296c4825735515a7`。Windows改行を正規化したMD5はローカル検証済みソースと一致: `4b80b1968603002210e9ec785abf857c`
- v3はSECURITY DEFINER、v2はSECURITY INVOKER。いずれもsearch_path=public、authenticatedにEXECUTE、PUBLIC/anonにはEXECUTEなし
- 親見積、明細、シートの3保護トリガーは有効（tgenabled=O）
- Windows改行を正規化した4関数の本文は検証済みローカルマイグレーションと一致（読み取り検証true）
- 適用前後で以下のデータ・関数ハッシュが一致（既存データの改変なし）

| 対象 | 前後で一致したMD5 |
|---|---|
| estimates全行 | `a1490cf7ac994ef3074d15230b98747f` |
| estimate_items全行 | `4487a1a97d9a67cc03e0f62180c6e7ab` |
| estimate_sheets全行 | `db055e9da214f067e2ca529b32893e99` |
| approve_estimate定義 | `c96607f2373fe82b93e9691406583013` |
| return_estimate定義 | `4d5b476af8908008a52bc72d2a43482d` |

本番データへの動作テスト・フロントエンドのデプロイ・コミットは実行していない。
適用後の検証は定義とデータハッシュの読み取りのみ。隔離環境の120件の実操作テストとは区別する。
