import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import app from "../src/index.js";
import { pool } from "../src/db/client.js";

export async function startTestServer() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function closeDb() {
  await pool.end();
}

export function authHeader(user) {
  assert.ok(process.env.JWT_SECRET, "JWT_SECRET must be set for tests");

  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1h",
    },
  );

  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function resetTestDatabase() {
  await pool.query(`
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

    CREATE UNIQUE INDEX idx_one_active_booking_per_availability
      ON bookings (availability_id)
      WHERE status IN ('accepted', 'completed');
  `);
}

export async function seedTestData() {
  const passwordHash = await bcrypt.hash("PawPal123!", 10);

  const { rows: userRows } = await pool.query(
    `
    INSERT INTO users (
      name,
      email,
      password_hash,
      role,
      city,
      state,
      zip_code
    )
    VALUES
      ('Owner One', 'owner@example.com', $1, 'owner', 'Chicago', 'IL', '60601'),
      ('Owner Two', 'owner2@example.com', $1, 'owner', 'Chicago', 'IL', '60601'),
      ('Sitter One', 'sitter@example.com', $1, 'sitter', 'Chicago', 'IL', '60601')
    RETURNING id, name, email, role;
    `,
    [passwordHash],
  );

  const owner = userRows.find((user) => user.email === "owner@example.com");
  const otherOwner = userRows.find((user) => user.email === "owner2@example.com");
  const sitter = userRows.find((user) => user.email === "sitter@example.com");

  const { rows: petRows } = await pool.query(
    `
    INSERT INTO pets (
      owner_id,
      name,
      species,
      age
    )
    VALUES
      ($1, 'Rocky', 'Dog', 4),
      ($2, 'Luna', 'Dog', 2)
    RETURNING id, owner_id AS "ownerId", name, species, age;
    `,
    [owner.id, otherOwner.id],
  );

  const ownerPet = petRows.find((pet) => pet.ownerId === owner.id);
  const otherOwnerPet = petRows.find((pet) => pet.ownerId === otherOwner.id);

  const { rows: serviceRows } = await pool.query(`
    INSERT INTO services (
      name,
      description,
      base_price
    )
    VALUES
      ('Dog Walking', '30-minute walk', 22.00)
    RETURNING id, name, base_price AS "basePrice";
  `);

  const service = serviceRows[0];

  const { rows: sitterServiceRows } = await pool.query(
    `
    INSERT INTO sitter_services (
      sitter_id,
      service_id,
      price_override
    )
    VALUES ($1, $2, 25.00)
    RETURNING id, sitter_id AS "sitterId", service_id AS "serviceId";
    `,
    [sitter.id, service.id],
  );

  const sitterService = sitterServiceRows[0];

  const { rows: availabilityRows } = await pool.query(
    `
    INSERT INTO availability (
      sitter_id,
      date,
      start_time,
      end_time,
      is_booked
    )
    VALUES
      ($1, CURRENT_DATE + 1, '09:00', '09:30', false),
      ($1, CURRENT_DATE + 2, '10:00', '10:30', false)
    RETURNING
      id,
      sitter_id AS "sitterId",
      date,
      start_time AS "startTime",
      end_time AS "endTime",
      is_booked AS "isBooked";
    `,
    [sitter.id],
  );

  return {
    owner,
    otherOwner,
    sitter,
    ownerPet,
    otherOwnerPet,
    service,
    sitterService,
    availability: availabilityRows,
  };
}