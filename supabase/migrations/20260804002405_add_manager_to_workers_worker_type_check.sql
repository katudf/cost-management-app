ALTER TABLE "Workers" DROP CONSTRAINT workers_worker_type_check;

ALTER TABLE "Workers" ADD CONSTRAINT workers_worker_type_check
    CHECK (worker_type = ANY (ARRAY['作業員'::text, '管理'::text, '事務'::text]));
