-- 未使用の旧テーブルを削除（ユーザー明示承認済み 2026-07-10）
ALTER TABLE "ProjectTasks" DROP CONSTRAINT "ProjectTasks_serviceMasterId_fkey1";

DROP TABLE IF EXISTS "WorkLogs";
DROP TABLE IF EXISTS "MaterialUsageLogs";
DROP TABLE IF EXISTS "DailyReports";
DROP TABLE IF EXISTS "Materials";
DROP TABLE IF EXISTS "ServiceMaster";
