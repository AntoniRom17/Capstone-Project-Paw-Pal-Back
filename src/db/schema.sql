DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS availability CASCADE;
DROP TABLE IF EXISTS sitter_services CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS pets CASCADE;
DROP TABLE IF EXISTS users CASCADE;

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
  trust_score INTEGER
    CHECK (trust_score BETWEEN 0 AND 100),
  background_check_status VARCHAR(20) NOT NULL DEFAULT 'not_submitted'
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  photo_url TEXT,
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
  UNIQUE (sitter_id, date, start_time, end_time)
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
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_sitter_location
  ON users (role, city, state, zip_code);

CREATE INDEX idx_pets_owner_id
  ON pets (owner_id);

CREATE INDEX idx_sitter_services_sitter_id
  ON sitter_services (sitter_id);

CREATE INDEX idx_availability_sitter_date
  ON availability (sitter_id, date);

CREATE INDEX idx_bookings_owner_id
  ON bookings (owner_id);

CREATE INDEX idx_bookings_sitter_id
  ON bookings (sitter_id);

CREATE UNIQUE INDEX idx_one_active_booking_per_availability
  ON bookings (availability_id)
  WHERE status IN ('accepted', 'completed');