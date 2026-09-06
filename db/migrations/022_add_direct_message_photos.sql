ALTER TABLE direct_messages
  DROP CONSTRAINT IF EXISTS direct_messages_body_check;

ALTER TABLE direct_messages
  ALTER COLUMN body SET DEFAULT '';

CREATE TABLE IF NOT EXISTS direct_message_images (
  message_id INT NOT NULL REFERENCES direct_messages(message_id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL UNIQUE REFERENCES media_assets(media_id) ON DELETE CASCADE,
  display_order SMALLINT NOT NULL CHECK (display_order BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, media_id),
  UNIQUE (message_id, display_order)
);
