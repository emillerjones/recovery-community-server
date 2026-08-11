BEGIN;

CREATE TABLE IF NOT EXISTS media_assets (
  media_id BIGSERIAL PRIMARY KEY,
  uploaded_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'cloudinary'
    CHECK (provider = 'cloudinary'),
  provider_asset_id TEXT NOT NULL UNIQUE,
  delivery_type TEXT NOT NULL DEFAULT 'authenticated'
    CHECK (delivery_type = 'authenticated'),
  format TEXT NOT NULL,
  byte_size INT NOT NULL CHECK (byte_size > 0),
  width INT NOT NULL CHECK (width > 0),
  height INT NOT NULL CHECK (height > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'attached', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_assets_pending_cleanup
  ON media_assets(created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS forum_post_images (
  post_id INT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL UNIQUE REFERENCES media_assets(media_id) ON DELETE CASCADE,
  display_order SMALLINT NOT NULL CHECK (display_order BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, media_id),
  UNIQUE (post_id, display_order)
);

CREATE TABLE IF NOT EXISTS forum_comment_images (
  comment_id INT NOT NULL REFERENCES comments(comment_id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL UNIQUE REFERENCES media_assets(media_id) ON DELETE CASCADE,
  display_order SMALLINT NOT NULL CHECK (display_order BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, media_id),
  UNIQUE (comment_id, display_order)
);

COMMIT;
