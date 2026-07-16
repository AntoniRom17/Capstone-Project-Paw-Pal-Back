CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM availability AS first_slot
    JOIN availability AS second_slot
      ON second_slot.sitter_id =
        first_slot.sitter_id
      AND second_slot.date =
        first_slot.date
      AND second_slot.id >
        first_slot.id
      AND tsrange(
        first_slot.date +
          first_slot.start_time,
        first_slot.date +
          first_slot.end_time,
        '[)'
      ) &&
      tsrange(
        second_slot.date +
          second_slot.start_time,
        second_slot.date +
          second_slot.end_time,
        '[)'
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot add availability overlap protection because overlapping slots already exist';
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid =
      'availability'::regclass
      AND contype = 'x'
  ) THEN
    ALTER TABLE availability
      ADD CONSTRAINT
        availability_no_overlapping_slots
      EXCLUDE USING gist (
        sitter_id WITH =,
        date WITH =,
        tsrange(
          date + start_time,
          date + end_time,
          '[)'
        ) WITH &&
      );
  END IF;
END
$migration$;