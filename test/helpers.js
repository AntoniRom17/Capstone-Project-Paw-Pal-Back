import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import app from "../src/index.js";
import { pool } from "../src/db/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const databaseSchema = fs.readFileSync(
  path.join(__dirname, "../src/db/schema.sql"),
  "utf8",
);

function getDatabaseName(databaseUrl) {
  try {
    const parsedUrl = new URL(databaseUrl);
    return decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

function assertSafeResetDatabase() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Refusing to reset the database outside NODE_ENV=test.",
    );
  }

  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "Refusing to reset the database because TEST_DATABASE_URL is not set.",
    );
  }

  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error(
      "Refusing to reset the database because DATABASE_URL is not using TEST_DATABASE_URL.",
    );
  }

  const databaseName = getDatabaseName(process.env.DATABASE_URL);

  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(
      `Refusing to reset database '${databaseName}' because its name does not include 'test'.`,
    );
  }
}

export async function startTestServer() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => server.close(resolve)),
  };
}

export async function closeDb() {
  await pool.end();
}

export function authHeader(user) {
  assert.ok(
    process.env.JWT_SECRET,
    "JWT_SECRET must be set for tests",
  );

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
  assertSafeResetDatabase();
  await pool.query(databaseSchema);
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
      (
        'Owner One',
        'owner@example.com',
        $1,
        'owner',
        'Chicago',
        'IL',
        '60601'
      ),
      (
        'Owner Two',
        'owner2@example.com',
        $1,
        'owner',
        'Chicago',
        'IL',
        '60601'
      ),
      (
        'Sitter One',
        'sitter@example.com',
        $1,
        'sitter',
        'Chicago',
        'IL',
        '60601'
      )
    RETURNING id, name, email, role;
    `,
    [passwordHash],
  );

  const owner = userRows.find(
    (user) => user.email === "owner@example.com",
  );

  const otherOwner = userRows.find(
    (user) => user.email === "owner2@example.com",
  );

  const sitter = userRows.find(
    (user) => user.email === "sitter@example.com",
  );

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
    RETURNING
      id,
      owner_id AS "ownerId",
      name,
      species,
      age;
    `,
    [owner.id, otherOwner.id],
  );

  const ownerPet = petRows.find(
    (pet) => pet.ownerId === owner.id,
  );

  const otherOwnerPet = petRows.find(
    (pet) => pet.ownerId === otherOwner.id,
  );

  const { rows: serviceRows } = await pool.query(`
    INSERT INTO services (
      name,
      description,
      base_price
    )
    VALUES (
      'Dog Walking',
      '30-minute walk',
      22.00
    )
    RETURNING
      id,
      name,
      base_price AS "basePrice";
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
    RETURNING
      id,
      sitter_id AS "sitterId",
      service_id AS "serviceId";
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
      (
        $1,
        CURRENT_DATE + 1,
        '09:00',
        '09:30',
        false
      ),
      (
        $1,
        CURRENT_DATE + 2,
        '10:00',
        '10:30',
        false
      )
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