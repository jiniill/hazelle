-- How far the first page's visitors came, per address a day and with no id: server/visits.ts, FIRST_PAGE_STEPS.
ALTER TABLE visit_days ADD COLUMN shown INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visit_days ADD COLUMN read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visit_days ADD COLUMN door INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visit_days ADD COLUMN keyed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visit_days ADD COLUMN entered INTEGER NOT NULL DEFAULT 0;
