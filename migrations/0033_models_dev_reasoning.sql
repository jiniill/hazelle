-- reasoning: models.dev's reasoning_options as JSON, NULL where it does not say.
-- The stored list has no reasoning controls: the next refresh fetches it again, under a new ETag.
ALTER TABLE models_dev ADD COLUMN reasoning TEXT;
UPDATE models_dev_fetch SET fetched_at = NULL, tried_at = NULL;
