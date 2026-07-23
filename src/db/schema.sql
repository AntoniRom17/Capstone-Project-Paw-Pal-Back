CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS availability CASCADE;
DROP TABLE IF EXISTS sitter_services CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS pet_vaccinations CASCADE;
DROP TABLE IF EXISTS pets CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS schema_migrations CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(10) NOT NULL
    CHECK (role IN ('owner', 'sitter')),
  bio TEXT,
  phone VARCHAR(20),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL,
  zip_code VARCHAR(10) NOT NULL,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  profile_photo_filename VARCHAR(255),
  profile_photo_content_type VARCHAR(50),
  trust_score INTEGER
    CHECK (trust_score BETWEEN 0 AND 100),
  background_check_status VARCHAR(20) NOT NULL
    DEFAULT 'not_submitted'
    CHECK (
      background_check_status IN (
        'not_submitted',
        'pending',
        'verified',
        'rejected'
      )
    ),
  on_time_percentage INTEGER
    CHECK (on_time_percentage BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  password_reset_token_hash TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_profile_photo_metadata_complete
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
    ),
  CONSTRAINT users_active_deactivation_consistency
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
    )
);

CREATE TABLE pets (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  species VARCHAR(30) NOT NULL,
  breed VARCHAR(50),
  age INTEGER CHECK (age >= 0),
  care_notes TEXT,
  photo_filename VARCHAR(255),
  photo_content_type VARCHAR(50),
  vet_name VARCHAR(100),
  vet_phone VARCHAR(20),
  microchip_number VARCHAR(50),
  weight_lbs NUMERIC(5, 1),
  allergies TEXT,
  medications TEXT,
  spayed_neutered BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pets_photo_metadata_complete
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
    ),
  CONSTRAINT pets_weight_lbs_check
    CHECK (
      weight_lbs IS NULL
      OR weight_lbs > 0
    )
);

CREATE TABLE pet_vaccinations (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL
    REFERENCES pets(id) ON DELETE CASCADE,
  vaccine_name VARCHAR(100) NOT NULL,
  administered_date DATE NOT NULL,
  expiration_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  base_price NUMERIC(8, 2) NOT NULL
    CHECK (base_price >= 0)
);

CREATE TABLE sitter_services (
  id SERIAL PRIMARY KEY,
  sitter_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL
    REFERENCES services(id) ON DELETE CASCADE,
  price_override NUMERIC(8, 2)
    CHECK (price_override >= 0),
  UNIQUE (sitter_id, service_id)
);

CREATE TABLE availability (
  id SERIAL PRIMARY KEY,
  sitter_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_booked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  UNIQUE (
    sitter_id,
    date,
    start_time,
    end_time
  ),
  EXCLUDE USING gist (
    sitter_id WITH =,
    date WITH =,
    tsrange(
      date + start_time,
      date + end_time,
      '[)'
    ) WITH &&
  )
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL
    REFERENCES users(id),
  sitter_id INTEGER NOT NULL
    REFERENCES users(id),
  pet_id INTEGER NOT NULL
    REFERENCES pets(id),
  sitter_service_id INTEGER NOT NULL
    REFERENCES sitter_services(id),
  availability_id INTEGER NOT NULL
    REFERENCES availability(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'accepted',
        'declined',
        'cancelled',
        'completed'
      )
    ),
  cancelled_by_role VARCHAR(10)
    CHECK (
      cancelled_by_role IS NULL
      OR cancelled_by_role IN (
        'owner',
        'sitter'
      )
    ),
  total_price NUMERIC(8, 2) NOT NULL
    CHECK (total_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER UNIQUE NOT NULL
    REFERENCES bookings(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL
    REFERENCES users(id),
  rating INTEGER NOT NULL
    CHECK (rating BETWEEN 1 AND 5),
  was_on_time BOOLEAN,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL
    REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL
    REFERENCES users(id),
  recipient_id INTEGER NOT NULL
    REFERENCES users(id),
  body TEXT NOT NULL
    CHECK (
      CHAR_LENGTH(BTRIM(body))
      BETWEEN 1 AND 2000
    ),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX idx_users_active_sitter_location
  ON users (
    role,
    is_active,
    city,
    state,
    zip_code
  );

CREATE INDEX idx_users_password_reset_token_hash
  ON users (password_reset_token_hash);

CREATE INDEX idx_pets_owner_id
  ON pets (owner_id);

CREATE INDEX idx_pet_vaccinations_pet_id
  ON pet_vaccinations (pet_id);

CREATE INDEX idx_sitter_services_sitter_id
  ON sitter_services (sitter_id);

CREATE INDEX idx_availability_sitter_date
  ON availability (sitter_id, date);

CREATE INDEX idx_bookings_owner_id
  ON bookings (owner_id);

CREATE INDEX idx_bookings_sitter_id
  ON bookings (sitter_id);

CREATE UNIQUE INDEX
  idx_one_active_booking_per_availability
  ON bookings (availability_id)
  WHERE status IN (
    'pending',
    'accepted',
    'completed'
  );

CREATE INDEX idx_messages_booking_created_at
  ON messages (
    booking_id,
    created_at,
    id
  );

CREATE INDEX idx_messages_unread_recipient
  ON messages (
    recipient_id,
    created_at
  )
  WHERE read_at IS NULL;
