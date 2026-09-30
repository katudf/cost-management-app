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
