BEGIN;

CREATE TABLE IF NOT EXISTS lounge_rooms (
  room_id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lounge_rooms (slug, name)
VALUES ('community-lounge', 'Community Lounge')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS lounge_messages (
  message_id BIGSERIAL PRIMARY KEY,
  room_id INT NOT NULL REFERENCES lounge_rooms(room_id),
  author_id INT REFERENCES users(user_id) ON DELETE SET NULL,
  author_username TEXT NOT NULL,
  body TEXT NOT NULL CHECK (LENGTH(TRIM(body)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by INT REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lounge_messages_room_created
  ON lounge_messages(room_id, message_id DESC);

CREATE TABLE IF NOT EXISTS lounge_reads (
  room_id INT NOT NULL REFERENCES lounge_rooms(room_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  last_read_message_id BIGINT REFERENCES lounge_messages(message_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

COMMIT;
