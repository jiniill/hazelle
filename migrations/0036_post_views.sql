-- 조회수 (src/server/board.ts): how many readers opened a public post, its author and the operator apart. A count
-- alone: who read what is never stored.
ALTER TABLE posts ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
