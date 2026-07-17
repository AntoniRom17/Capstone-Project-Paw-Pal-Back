LOCK TABLE bookings
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bookings
    WHERE status IN (
      'pending',
      'accepted',
      'completed'
    )
    GROUP BY availability_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce active booking uniqueness because an availability slot has multiple pending, accepted, or completed bookings';
  END IF;
END;
$$;

DROP INDEX IF EXISTS
  idx_one_active_booking_per_availability;

CREATE UNIQUE INDEX
  idx_one_active_booking_per_availability
  ON bookings (availability_id)
  WHERE status IN (
    'pending',
    'accepted',
    'completed'
  );