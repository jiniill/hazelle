-- 손님 깔때기: a guest's id per day and step, so the operator's table shows where guests stop. 손님 출신 stays replies only.
DROP TRIGGER visit_guest;
DROP TRIGGER visit_signup;
ALTER TABLE visit_guests RENAME TO visit_guests_replied;
CREATE TABLE visit_guests (day INTEGER NOT NULL, guest TEXT NOT NULL, step TEXT NOT NULL, PRIMARY KEY (day, guest, step));
INSERT INTO visit_guests (day, guest, step) SELECT day, guest, 'replied' FROM visit_guests_replied;
DROP TABLE visit_guests_replied;
ALTER TABLE visit_days ADD COLUMN opened INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visit_days ADD COLUMN connected INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER visit_guest AFTER INSERT ON visit_guests BEGIN
  INSERT INTO visit_days (day, guests, opened, connected)
  VALUES (NEW.day, NEW.step = 'replied', NEW.step = 'opened', NEW.step = 'connected')
  ON CONFLICT (day) DO UPDATE SET guests = guests + excluded.guests, opened = opened + excluded.opened, connected = connected + excluded.connected;
END;
CREATE TRIGGER visit_signup AFTER INSERT ON accounts BEGIN
  INSERT INTO visit_days (day, accounts, converted)
  VALUES ((NEW.created_at + 32400000) / 86400000 * 86400000 - 32400000, 1, EXISTS (SELECT 1 FROM visit_guests WHERE guest = NEW.id AND step = 'replied'))
  ON CONFLICT (day) DO UPDATE SET accounts = accounts + 1, converted = converted + excluded.converted;
END;

-- People seen in a closed week per the week they signed up in, never an account. A count under the row floor has no row.
CREATE TABLE pulse_week_cohorts (week INTEGER NOT NULL, cohort INTEGER NOT NULL, people INTEGER NOT NULL, PRIMARY KEY (week, cohort));
-- The next Monday 00:00 KST (server/pulse.ts MONDAY): a list gathered before the policy named this use is never counted.
ALTER TABLE service ADD COLUMN pulse_cohorts_from INTEGER NOT NULL DEFAULT 0;
UPDATE service SET pulse_cohorts_from = (unixepoch() * 1000) - ((unixepoch() * 1000 - 313200000) % 604800000) + 604800000;
