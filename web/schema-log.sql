-- 사용 기록 DB 2~10 (sapphire-log-2 ~ 10) 의 표. server/logdb.ts 의 LOG_SCHEMA, schema.sql 의 activity 와 같다.
-- scripts/ci-d1.mjs 가 배포 때마다 넣는다 (CREATE ... IF NOT EXISTS 라 몇 번을 해도 된다)
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  what TEXT NOT NULL,
  detail TEXT,
  via TEXT,
  ip TEXT,
  place TEXT,
  device TEXT,
  dev TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_at ON activity (at);
CREATE INDEX IF NOT EXISTS activity_user_at ON activity (user_id, at);
