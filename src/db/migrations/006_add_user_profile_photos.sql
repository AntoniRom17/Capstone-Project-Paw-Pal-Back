ALTER TABLE users
  ADD COLUMN IF NOT EXISTS
    profile_photo_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS
    profile_photo_content_type VARCHAR(50);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS
    users_profile_photo_metadata_complete;

ALTER TABLE users
  ADD CONSTRAINT
    users_profile_photo_metadata_complete
  CHECK (
    (
      profile_photo_filename IS NULL
      AND profile_photo_content_type IS NULL
    )
    OR
    (
      profile_photo_filename IS NOT NULL
      AND profile_photo_content_type IS NOT NULL
    )
  );