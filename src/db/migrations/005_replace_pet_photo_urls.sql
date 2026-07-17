ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS
    photo_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS
    photo_content_type VARCHAR(50);

ALTER TABLE pets
  DROP COLUMN IF EXISTS photo_url;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'pets_photo_metadata_complete'
      AND conrelid = 'pets'::regclass
  ) THEN
    ALTER TABLE pets
      ADD CONSTRAINT
        pets_photo_metadata_complete
      CHECK (
        (
          photo_filename IS NULL
          AND photo_content_type IS NULL
        )
        OR
        (
          photo_filename IS NOT NULL
          AND photo_content_type IS NOT NULL
        )
      );
  END IF;
END
$$;