-- Pictures on operator-only posts, unencrypted as the post's text is. They go with the post: its row by the cascade, a
-- deleted post's placeholder in the same batch as its text (board.ts).
CREATE TABLE post_pictures (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX post_pictures_post ON post_pictures (post_id);
