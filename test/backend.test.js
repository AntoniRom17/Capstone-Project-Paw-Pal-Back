import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import {
  authHeader,
  closeDb,
  resetTestDatabase,
  seedTestData,
  startTestServer,
} from "./helpers.js";
import { pool } from "../src/db/client.js";

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-secret";
}

let server;

async function request(path, options = {}) {
  const { headers = {}, ...requestOptions } = options;

  const response = await fetch(`${server.baseUrl}${path}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  return {
    status: response.status,
    body,
  };
}

describe("backend API", () => {
  beforeEach(async () => {
    if (!server) {
      server = await startTestServer();
    }

    await resetTestDatabase();
  });

  after(async () => {
    if (server) {
      await server.close();
    }

    await closeDb();
  });

  test("health endpoint returns ok", async () => {
    const response = await request("/api/health");

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
  });

  test("owner can create a pet with age zero", async () => {
    const data = await seedTestData();

    const response = await request("/api/pets", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        name: "Baby",
        species: "Dog",
        age: 0,
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.pet.age, 0);
  });

  test("owner cannot list another owner's pets", async () => {
    const data = await seedTestData();

    const response = await request("/api/pets", {
      headers: authHeader(data.owner),
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.pets.length, 1);
    assert.equal(response.body.pets[0].ownerId, data.owner.id);
  });

  test("sitter cannot access owner-only pet routes", async () => {
    const data = await seedTestData();

    const response = await request("/api/pets", {
      headers: authHeader(data.sitter),
    });

    assert.equal(response.status, 403);
  });

  test("public availability only returns future unbooked slots", async () => {
    const data = await seedTestData();

    await pool.query(
      `
      INSERT INTO availability (
        sitter_id,
        date,
        start_time,
        end_time,
        is_booked
      )
      VALUES
        ($1, CURRENT_DATE - 1, '08:00', '08:30', false),
        ($1, CURRENT_DATE + 3, '11:00', '11:30', true);
      `,
      [data.sitter.id],
    );

    const response = await request(`/api/sitters/${data.sitter.id}/availability`);

    assert.equal(response.status, 200);
    assert.equal(response.body.availability.length, 2);
    assert.ok(
      response.body.availability.every((slot) => slot.isBooked === false),
    );
  });

  test("sitter cannot create availability in the past", async () => {
    const data = await seedTestData();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toISOString().slice(0, 10);

    const response = await request("/api/availability", {
      method: "POST",
      headers: authHeader(data.sitter),
      body: JSON.stringify({
        date: yesterdayString,
        startTime: "09:00",
        endTime: "09:30",
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "date cannot be in the past");
  });

  test("owner can create booking with sitter service", async () => {
    const data = await seedTestData();

    const response = await request("/api/bookings", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        sitterId: data.sitter.id,
        petId: data.ownerPet.id,
        sitterServiceId: data.sitterService.id,
        availabilityId: data.availability[0].id,
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.booking.ownerId, data.owner.id);
    assert.equal(response.body.booking.sitterId, data.sitter.id);
    assert.equal(response.body.booking.petId, data.ownerPet.id);
    assert.equal(response.body.booking.sitterServiceId, data.sitterService.id);
    assert.equal(response.body.booking.availabilityId, data.availability[0].id);
    assert.equal(response.body.booking.status, "pending");

    const { rows } = await pool.query(
      `SELECT is_booked FROM availability WHERE id = $1`,
      [data.availability[0].id],
    );

    assert.equal(rows[0].is_booked, true);
  });

  test("owner cannot create booking with someone else's pet", async () => {
    const data = await seedTestData();

    const response = await request("/api/bookings", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        sitterId: data.sitter.id,
        petId: data.otherOwnerPet.id,
        sitterServiceId: data.sitterService.id,
        availabilityId: data.availability[0].id,
      }),
    });

    assert.equal(response.status, 403);
  });

  test("booking list returns bookings wrapper", async () => {
    const data = await seedTestData();

    await request("/api/bookings", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        sitterId: data.sitter.id,
        petId: data.ownerPet.id,
        sitterServiceId: data.sitterService.id,
        availabilityId: data.availability[0].id,
      }),
    });

    const response = await request("/api/bookings", {
      headers: authHeader(data.owner),
    });

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.bookings));
    assert.equal(response.body.bookings.length, 1);
    assert.equal(response.body.bookings[0].serviceName, "Dog Walking");
  });

  test("declined booking releases availability", async () => {
    const data = await seedTestData();

    const createResponse = await request("/api/bookings", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        sitterId: data.sitter.id,
        petId: data.ownerPet.id,
        sitterServiceId: data.sitterService.id,
        availabilityId: data.availability[0].id,
      }),
    });

    const updateResponse = await request(
      `/api/bookings/${createResponse.body.booking.id}/status`,
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          status: "declined",
        }),
      },
    );

    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.booking.status, "declined");

    const { rows } = await pool.query(
      `SELECT is_booked FROM availability WHERE id = $1`,
      [data.availability[0].id],
    );

    assert.equal(rows[0].is_booked, false);
  });

  test("owner can review completed booking once", async () => {
    const data = await seedTestData();

    const { rows: bookingRows } = await pool.query(
      `
      INSERT INTO bookings (
        owner_id,
        sitter_id,
        pet_id,
        sitter_service_id,
        availability_id,
        date,
        start_time,
        end_time,
        status,
        total_price
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        CURRENT_DATE,
        '09:00',
        '09:30',
        'completed',
        25.00
      )
      RETURNING id;
      `,
      [
        data.owner.id,
        data.sitter.id,
        data.ownerPet.id,
        data.sitterService.id,
        data.availability[0].id,
      ],
    );

    const response = await request("/api/reviews", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        bookingId: bookingRows[0].id,
        rating: 5,
        comment: "Great sitter",
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.review.bookingId, bookingRows[0].id);
    assert.equal(response.body.review.rating, 5);

    const duplicateResponse = await request("/api/reviews", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        bookingId: bookingRows[0].id,
        rating: 5,
        comment: "Second review",
      }),
    });

    assert.equal(duplicateResponse.status, 409);
  });
});