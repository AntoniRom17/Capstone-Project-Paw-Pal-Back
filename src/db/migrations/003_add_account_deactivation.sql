ALTER TABLE users
  ADD COLUMN IF NOT EXISTS
    is_active BOOLEAN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS
    deactivated_at TIMESTAMPTZ;

UPDATE users
SET is_active = true
WHERE is_active IS NULL;

UPDATE users
SET deactivated_at = NOW()
WHERE is_active = false
  AND deactivated_at IS NULL;

UPDATE users
SET deactivated_at = NULL
WHERE is_active = true
  AND deactivated_at IS NOT NULL;

ALTER TABLE users
  ALTER COLUMN is_active
    SET DEFAULT true;

ALTER TABLE users
  ALTER COLUMN is_active
    SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid =
      'users'::regclass
      AND constraint_record.contype = 'c'
      AND pg_get_constraintdef(
        constraint_record.oid
      ) ILIKE '%is_active%'
      AND pg_get_constraintdef(
        constraint_record.oid
      ) ILIKE '%deactivated_at%'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT
        users_active_deactivation_consistency
      CHECK (
        (
          is_active = true
          AND deactivated_at IS NULL
        )
        OR
        (
          is_active = false
          AND deactivated_at IS NOT NULL
        )
      );
  END IF;
END
$migration$;

DROP INDEX IF EXISTS
  idx_users_sitter_location;

CREATE INDEX IF NOT EXISTS
  idx_users_active_sitter_location
  ON users (
    role,
    is_active,
    city,
    state,
    zip_code
  );