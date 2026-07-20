ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS
    cancelled_by_role VARCHAR(10);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid =
      'bookings'::regclass
      AND constraint_record.contype = 'c'
      AND pg_get_constraintdef(
        constraint_record.oid
      ) ILIKE '%cancelled_by_role%'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT
        bookings_cancelled_by_role_check
      CHECK (
        cancelled_by_role IS NULL
        OR cancelled_by_role IN (
          'owner',
          'sitter'
        )
      );
  END IF;
END
$migration$;
