-- 자동 진단 (design §6.13): one row per day, person and kind of problem. person is a hash under the day's key, which is
-- dropped when the day closes (visit_keys), so it names no account and does not carry from one day to the next.
CREATE TABLE auto_diagnoses (
  day INTEGER NOT NULL,
  person TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL,
  version TEXT NOT NULL,
  place TEXT NOT NULL,
  times INTEGER NOT NULL,
  at INTEGER NOT NULL,
  facts TEXT NOT NULL,
  PRIMARY KEY (day, person, event, detail, version, place)
);
