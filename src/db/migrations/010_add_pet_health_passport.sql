ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS
    vet_name VARCHAR(100);

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS
    vet_phone VARCHAR(20);

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS
    microchip_number VARCHAR(50);

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS
    weight_lbs NUMERIC(5, 1);

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS
    allergies TEXT;

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS
    medications TEXT;

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS
    spayed_neutered BOOLEAN;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid =
      'pets'::regclass
      AND constraint_record.contype = 'c'
      AND pg_get_constraintdef(
        constraint_record.oid
      ) ILIKE '%weight_lbs%'
  ) THEN
    ALTER TABLE pets
      ADD CONSTRAINT
        pets_weight_lbs_check
      CHECK (
        weight_lbs IS NULL
        OR weight_lbs > 0
      );
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS pet_vaccinations (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL
    REFERENCES pets(id)
    ON DELETE CASCADE,
  vaccine_name VARCHAR(100) NOT NULL,
  administered_date DATE NOT NULL,
  expiration_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
  idx_pet_vaccinations_pet_id
  ON pet_vaccinations (pet_id);
