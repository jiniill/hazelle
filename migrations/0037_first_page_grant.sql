-- The first page's sign-in at a provider in place of a pasted key (runtime/account/grant.ts): who left for it and who
-- came back with a key, counted as the page's other steps are (0032).
ALTER TABLE visit_days ADD COLUMN asked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visit_days ADD COLUMN granted INTEGER NOT NULL DEFAULT 0;
