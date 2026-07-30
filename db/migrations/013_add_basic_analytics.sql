BEGIN;

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id BIGSERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
  session_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'logout', 'page_view')),
  page_key TEXT,
  device_type TEXT NOT NULL CHECK (device_type IN ('mobile', 'tablet', 'desktop')),
  country_code VARCHAR(2),
  region VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (event_type = 'page_view' AND page_key IS NOT NULL)
    OR (event_type IN ('login', 'logout') AND page_key IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created
  ON analytics_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created
  ON analytics_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created
  ON analytics_events(event_type, created_at DESC);

COMMIT;
