CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('channel', 'private', 'direct'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  thread_id TEXT REFERENCES messages(id),
  idempotency_key TEXT,
  UNIQUE (conversation_id, author_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS messages_history
  ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_threads
  ON messages (conversation_id, thread_id, created_at ASC, id ASC);

INSERT OR IGNORE INTO conversations (id, name, kind) VALUES ('general', 'general', 'channel');
