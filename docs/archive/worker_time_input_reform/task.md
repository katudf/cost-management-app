# タスクリスト — 作業日報 時刻入力方式変更

## Phase 1: DB スキーマ変更
- [x] TaskRecords テーブルに `start_time`, `end_time` カラムを追加 (Supabase SQL) — SQLファイル作成済、要手動実行

## Phase 2: ビジネスロジック
- [x] `src/utils/workTimeUtils.js` を新規作成
  - [x] `getSeasonConfig(dateStr)` — 夏季/冬季判定
  - [x] `calculateWorkHours(startTime, endTime, dateStr)` — 実労働/時間外算出
  - [x] `calculateNinku(totalWorkHours, dateStr)` — 人工数算出

## Phase 3: WorkerApp.jsx 改修
- [x] State / データ読み込みに start_time / end_time を追加
- [x] adjustHours 関数を削除
- [x] 時間自動計算ロジックを実装 (useMemo で tasksWithCalculation)
- [x] UIを開始/終了時刻入力に変更
- [x] 実労働/時間外の自動表示バッジ
- [x] handleSubmit で start_time / end_time を保存
- [x] フッターに人工数を表示

## Phase 4: 検証
- [x] workTimeUtils のロジック検証 (全テストケース PASS)
- [x] ブラウザで動作確認 (UI表示確認済み)
