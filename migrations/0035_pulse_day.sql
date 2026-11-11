-- Each closed KST day's totals, kept with the weeks: accounts seen, accounts replied to and their 대화 replies, read from
-- pulse_seen and pulse_replies as the day closes (server/pulse.ts), before either forgets it. NULL is under
-- PULSE_FLOORS.row, people alone, repliers and replies together. Days closed before this migration have no row.
CREATE TABLE pulse_day (day INTEGER PRIMARY KEY, people INTEGER, repliers INTEGER, replies INTEGER);
