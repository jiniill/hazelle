-- 헤이젤 나우 (server/pulse.ts) ranks the last 7 days, sliding each day, in place of a week that started empty each
-- Monday. The lists are kept per KST day: a row's week start, a Monday 00:00 KST, is read as that Monday's day, so this
-- week's lists stay counted until next Monday, a day early only for rows written after this Monday.
DROP VIEW pulse_people_seen;
DROP VIEW pulse_rank_used;
ALTER TABLE pulse_seen RENAME COLUMN week TO day;
ALTER TABLE pulse_used RENAME COLUMN week TO day;
ALTER TABLE pulse_guest_seen RENAME COLUMN week TO day;
ALTER TABLE pulse_guest_used RENAME COLUMN week TO day;
CREATE VIEW pulse_people_seen AS
  SELECT day, account FROM pulse_seen
  UNION SELECT day, account FROM pulse_guest_seen;
CREATE VIEW pulse_rank_used AS
  SELECT day, role, key, type, account, name FROM pulse_used
  UNION ALL SELECT day, role, key, type, account, name FROM pulse_guest_used
  WHERE (SELECT pulse_guests FROM service) = 1;
-- The ranked rows of the 7 days ending `day` in order, each by key and type alone, never a count (JSON, a PulseOrder per
-- role): the rank marks compare against them 7 days later. A day under the board floor has no row.
CREATE TABLE pulse_day_places (day INTEGER PRIMARY KEY, places TEXT NOT NULL);
-- The first day whose 7 days are not yet closed; a window under the board floor leaves nothing else to tell it by.
ALTER TABLE service ADD COLUMN pulse_closed INTEGER NOT NULL DEFAULT 0;
