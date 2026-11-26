-- 서버 작업 예고: when the work the operator announced starts and about how many minutes the server is away
-- (contracts/work.ts). NULL for none.
ALTER TABLE service ADD COLUMN work_at INTEGER;
ALTER TABLE service ADD COLUMN work_minutes INTEGER;
