-- 헤이젤 나우 counts accounts only: a guest's or a self-host's ping names a person no one can check. A guest's reply
-- still counts in the operator's daily 손님 응답, and its id in 손님 출신 at signup, from visit_guests alone.
DROP VIEW pulse_people_seen;
DROP VIEW pulse_rank_used;
DROP VIEW pulse_rank_replies;
DROP TRIGGER visit_signup;
CREATE TABLE visit_guests (day INTEGER NOT NULL, guest TEXT NOT NULL, PRIMARY KEY (day, guest));
-- Before the trigger: these days' 손님 응답 are counted already.
INSERT INTO visit_guests (day, guest)
  SELECT day, account FROM pulse_guest_used WHERE account NOT LIKE 'remote:%'
  UNION SELECT day, account FROM pulse_guest_seen WHERE account NOT LIKE 'remote:%'
  UNION SELECT (hour + 32400000) / 86400000 * 86400000 - 32400000, account FROM pulse_guest_replies WHERE account NOT LIKE 'remote:%';
DROP TABLE pulse_guest_seen;
DROP TABLE pulse_guest_used;
DROP TABLE pulse_guest_replies;
ALTER TABLE service DROP COLUMN pulse_guests;
CREATE TRIGGER visit_guest AFTER INSERT ON visit_guests BEGIN
  INSERT INTO visit_days (day, guests) VALUES (NEW.day, 1) ON CONFLICT (day) DO UPDATE SET guests = guests + 1;
END;
-- Count inside signup's transaction, before visit_guests forgets the guest or the account leaves.
CREATE TRIGGER visit_signup AFTER INSERT ON accounts BEGIN
  INSERT INTO visit_days (day, accounts, converted)
  VALUES ((NEW.created_at + 32400000) / 86400000 * 86400000 - 32400000, 1, EXISTS (SELECT 1 FROM visit_guests WHERE guest = NEW.id))
  ON CONFLICT (day) DO UPDATE SET accounts = accounts + 1, converted = converted + excluded.converted;
END;
