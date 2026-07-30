# ウォークスルー — 作業日報 時刻入力方式変更

## 変更概要

作業日報システム（WorkerApp）の入力方式を**「時間数直接入力」**から**「開始・終了時刻入力」**に変更しました。

## 変更ファイル

### 新規作成

| ファイル | 内容 |
|---|---|
| [workTimeUtils.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/workTimeUtils.js) | 時間計算ユーティリティ（夏季/冬季判定、休憩控除、時間外算出、人工数算出） |
| [migrate_add_time_columns.sql](file:///c:/Users/katuy/Desktop/cost-management-app/docs/worker_time_input_reform/migrate_add_time_columns.sql) | DB マイグレーション SQL |

### 修正

| ファイル | 内容 |
|---|---|
| [WorkerApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/WorkerApp.jsx) | 全面改修：タイムピッカーUI、自動計算、人工数表示 |

## 実装内容

### 1. 時間計算ユーティリティ (`workTimeUtils.js`)

- **`getSeasonConfig(dateStr)`**: 日付から夏季(3-10月)/冬季(11-2月)を判定し、定時・休憩設定を返す
- **`calculateWorkHours(startTime, endTime, dateStr)`**: 開始・終了時刻から実労働時間・時間外を自動算出
  - 作業時間帯と重なる休憩のみ控除
  - 早出（定時前作業）と残業（定時後作業）を自動検出
- **`calculateNinku(totalWorkHours, dateStr)`**: 実労働時間 ÷ 定時労働時間 で人工数算出

### 2. WorkerApp UI の変更

**Before:**
- `[-]` `[数値]` `[+]` ボタンで時間数を手動入力
- 時間外は別途手動入力

**After:**
- `[開始時刻]` 〜 `[終了時刻]` をタイムピッカーで入力（15分ステップ）
- 実労働時間・時間外・休憩控除分がバッジで自動表示
- フッターに人工数を併記

### 3. 季節バッジ

日付選択の下に、選択日の季節と定時を表示：
- 夏季（3-10月）: オレンジバッジ + 「定時 8:00〜17:30」
- 冬季（11-2月）: ブルーバッジ + 「定時 8:00〜17:00」

### 4. AdminApp 互換性

- `hours` / `overtime_hours` カラムに自動計算結果を保存するため、管理画面側の変更は不要
- 既存の集計ロジック（useSupabaseData, useDashboardStats等）はそのまま動作

## 検証結果

### 計算ロジックテスト（全PASS）

| テスト | 入力 | 実働 | 時間外 | 休憩控除 |
|---|---|---|---|---|
| 夏季フルタイム | 08:00-17:30 | 7.5h | 0h | 120分 |
| 冬季フルタイム | 08:00-17:00 | 7.5h | 0h | 90分 |
| 夏季早出残業 | 07:00-19:00 | 10.0h | 2.5h | 120分 |
| 午前半日 | 08:00-12:00 | 3.5h | 0h | 30分 |
| 午後のみ | 13:00-17:30 | 4.0h | 0h | 30分 |

### UI 確認

![作業日報 新UI](C:/Users/katuy/.gemini/antigravity/brain/6adedfae-47e2-4c15-9e81-ebf0cbe78b62/.system_generated/click_feedback/click_feedback_1775788061610.png)

## ⚠️ 残タスク（ユーザー作業）

> [!WARNING]
> ### Supabase での SQL 実行が必要です
> 以下の SQL を Supabase の SQL Editor で実行してください：
> ```sql
> ALTER TABLE public."TaskRecords"
>   ADD COLUMN IF NOT EXISTS start_time time,
>   ADD COLUMN IF NOT EXISTS end_time time;
> ```
> この SQL を実行しないと、時刻データの保存でエラーが発生します。
