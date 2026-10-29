-- tools: models.dev's tool_call, 1 or 0, NULL where it does not say.
-- The stored list has no tool support: the next refresh fetches it again, under a new ETag.
ALTER TABLE models_dev ADD COLUMN tools INTEGER;
UPDATE models_dev_fetch SET fetched_at = NULL, tried_at = NULL;
