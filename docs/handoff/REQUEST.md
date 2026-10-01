# REQUEST — 検証依頼

対象コミット/差分: 作業ツリーの休憩設定変更
日時: 2026-09-30

## 変更したファイル

- `src/WorkerApp.jsx`
- `src/hooks/useDailyReport.js`
- `src/utils/workTimeUtils.ts`
- `src/types/supabase.ts`
- `supabase/migrations/20260930000000_create_worker_daily_break_settings.sql`

## 変更内容（事実のみ）

- 日報画面に、10時・昼・15時の休憩時間を標準・短縮・取得なしから選ぶ設定を追加
- 休憩設定パネルを初期状態および日付切替時に折りたたむ表示へ変更
- 休憩設定を作業員・日付単位で読み書きする処理を追加
- 休憩時間設定を入力中の時間計算と、同日の別現場に登録済みの実績再計算に適用
- 休憩変更後、同日別現場の残業申請合計も同期
- 休憩設定を日報の自動下書きと復元データに含める
- `WorkerDailyBreakSettings` テーブルとRLSポリシーのマイグレーションを追加

## 特に見てほしい点

- 休憩控除の時間計算
- 同日別現場の既存TaskRecords更新
- 新規テーブルのRLSポリシー

---

# REQUEST — 見積承認フロー修正（実装・検証済み）

指示書: `docs/handoff/ESTIMATE_APPROVAL_FIX_20261001.md`
報告: `docs/handoff/ESTIMATE_APPROVAL_FIX_20261001_REPORT.md`
日時: 2026-10-01 / 状態: **修正1〜4・NaN表示を実装、追加マイグレーションは本番適用済み（2026-10-01 13:04 JST）**

## 変更したファイル

- `src/estimate-editor/EstimateEditor.jsx`
- `src/estimate-editor/SettingsPanel.jsx`
- `src/estimate-editor/estimateDraftV2.js`
- `src/components/estimate/EstimateSidebar.jsx`
- `src/components/estimate/EstimateSubmitModal.jsx`
- `src/components/estimate/EstimateApprovalModal.jsx`
- `src/components/estimate/EstimateLostReasonModal.jsx`
- `src/supabaseEstimates.js`
- `src/types/supabase.ts`
- `supabase/migrations/20261001000000_atomic_estimate_save_and_content_lock.sql`
- `src/supabaseEstimates.atomic.test.js`
- `src/supabaseEstimates.test.js`
- `src/estimate-editor/estimateDraftV2.test.js`
- `scripts/estimate-approval-readonly.sql`
- `scripts/test-estimate-approval-db.py`
- `scripts/test-estimate-approval-ui.py`
- `tests/db/estimate-approval-fixture.sql`
- `tests/db/estimate-approval-live-definitions.sql`

## 変更内容（事実のみ）

- 保存・申請の検証とペイロード作成を共通化
- `save_estimate_v3` RPCへ表紙・シート・明細・任意の申請をまとめて送信
- 保存成功時に返却IDとシートUUIDを画面・リンク・保存スナップショットへ反映
- 保存成功時のみdirtyと自動退避をクリア
- 保存・申請・承認・差し戻し・状態遷移に処理中refガードを追加
- 状態変更成功時に `originalStatus` を更新。新規申請にも編集ロックを適用
- 各モーダルを処理成功後に閉じ、処理中は操作を無効化
- adminの下書き戻しをUIで許可。下書き戻し時にDBで承認証跡をクリア
- 下書き以外の表紙内容・承認者変更と明細・シートの直接操作をトリガーで拒否
- v2/v3保存RPCと明細・シート直接操作が親見積をロックして状態確認
- RPCの認証・admin/officeロール・所属シート・参照インデックス・表紙合計の検査を追加
- 稼働DBの既存の全行対象見積番号一意制約を維持
- 複製時の承認証跡をクリア。税率0を合計計算・再読込で維持
- 保存済み空の支払条件を維持、nullのみ既定値。自動退避の不正日時を非表示

## 検証対象

- 一体保存・申請のロールバックと番号競合
- 新規ID保持、未保存明細の申請、連打防止、申請直後ロック、失敗時入力保持
- pending/approvedの表紙・明細・シートの直接変更とv2/v3 RPC拒否
- 指名承認者・他人、保存/承認の競合、二重承認
- 差し戻し・下書き戻し・再申請、提出済み・受注連携、論理削除・復元・期限切れ削除

## 実行済み

- 稼働DBの読み取り調査（定義・RLS・トリガー・一意制約・番号重複）
- `npm test`: 19ファイル / 276件成功
- 隔離PostgreSQLのDB回帰検証: 120件成功
- 実エディタ＋模擬Supabase通信のブラウザ検証: 9件成功
- `npm run build`: 成功（既知のchunkサイズ警告あり）

## 触っていないもの

- `src/features/lineworks/lineworksNotify.js`（他作業者の未コミット変更）
- 承認済み見積 261001-0001-001
- フロントエンドのデプロイ・コミット

## 本番DB適用記録（2026-10-01）

- ユーザーの「本番DBに適用してください」の指示で、`quaollobtalcixmlpmps` に `20261001000000_atomic_estimate_save_and_content_lock` を適用
- 対象SQLと履歴登録を同じトランザクションで実行。PostgRESTへschema reloadを通知
- 他のローカル未適用マイグレーションは実行していない
- 適用履歴・RPC実行権限・固定search_path・3つの有効な保護トリガーを確認
- 見積・明細・シートと既存承認RPCの適用前後ハッシュが一致
- フロントエンドは未デプロイ
