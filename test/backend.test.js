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

async function createTestBooking(
  data,
  availabilityIndex = 0,
) {
  const response = await request("/api/bookings", {
    method: "POST",
    headers: authHeader(data.owner),
    body: JSON.stringify({
      sitterId: data.sitter.id,
      petId: data.ownerPet.id,
      sitterServiceId: data.sitterService.id,
      availabilityId:
        data.availability[availabilityIndex].id,
    }),
  });

  assert.equal(response.status, 201);
  return response.body.booking;
}

async function getDatabaseDate(daysFromToday = 0) {
  const { rows } = await pool.query(
    `
    SELECT TO_CHAR(
      CURRENT_DATE + $1::integer,
      'YYYY-MM-DD'
    ) AS date;
    `,
    [daysFromToday],
  );

  return rows[0].date;
}

function registrationBody(overrides = {}) {
  return {
    name: "New Owner",
    email: "new.owner@example.com",
    password: "PawPal123!",
    role: "owner",
    city: "Chicago",
    state: "IL",
    zipCode: "60601",
    ...overrides,
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

  test("user can register and login with normalized account data", async () => {
    const registerResponse = await request(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify(
          registrationBody({
            name: "  New Owner  ",
            email: "  NEW.OWNER@EXAMPLE.COM  ",
            role: " OWNER ",
            city: "  Chicago  ",
            state: " il ",
            zipCode: "60601",
          }),
        ),
      },
    );

    assert.equal(registerResponse.status, 201);
    assert.equal(
      registerResponse.body.user.name,
      "New Owner",
    );
    assert.equal(
      registerResponse.body.user.email,
      "new.owner@example.com",
    );
    assert.equal(
      registerResponse.body.user.role,
      "owner",
    );
    assert.equal(
      registerResponse.body.user.city,
      "Chicago",
    );
    assert.equal(
      registerResponse.body.user.state,
      "IL",
    );
    assert.ok(registerResponse.body.token);

    const loginResponse = await request(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: " NEW.OWNER@EXAMPLE.COM ",
          password: "PawPal123!",
        }),
      },
    );

    assert.equal(loginResponse.status, 200);
    assert.equal(
      loginResponse.body.user.email,
      "new.owner@example.com",
    );
    assert.ok(loginResponse.body.token);
  });

  test("registration rejects invalid strings and location formats", async () => {
    const whitespaceName = await request(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify(
          registrationBody({
            name: "   ",
          }),
        ),
      },
    );

    assert.equal(whitespaceName.status, 400);
    assert.equal(
      whitespaceName.body.error,
      "name must be a non-empty string no longer than 100 characters",
    );

    const invalidEmail = await request(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify(
          registrationBody({
            email: "not-an-email",
          }),
        ),
      },
    );

    assert.equal(invalidEmail.status, 400);
    assert.equal(
      invalidEmail.body.error,
      "email must be a valid email address",
    );

    const whitespaceCity = await request(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify(
          registrationBody({
            city: "   ",
          }),
        ),
      },
    );

    assert.equal(whitespaceCity.status, 400);
    assert.equal(
      whitespaceCity.body.error,
      "city must be a non-empty string no longer than 100 characters",
    );

    const invalidState = await request(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify(
          registrationBody({
            state: "Illinois",
          }),
        ),
      },
    );

    assert.equal(invalidState.status, 400);
    assert.equal(
      invalidState.body.error,
      "state must be a two-letter abbreviation",
    );

    const invalidZipCode = await request(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify(
          registrationBody({
            zipCode: "invalid",
          }),
        ),
      },
    );

    assert.equal(invalidZipCode.status, 400);
    assert.equal(
      invalidZipCode.body.error,
      "zipCode must use 12345 or 12345-6789 format",
    );
  });

  test("login rejects malformed credentials", async () => {
    const invalidEmail = await request(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: "   ",
          password: "PawPal123!",
        }),
      },
    );

    assert.equal(invalidEmail.status, 400);
    assert.equal(
      invalidEmail.body.error,
      "email must be a valid email address",
    );

    const invalidPassword = await request(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          password: 12345678,
        }),
      },
    );

    assert.equal(invalidPassword.status, 400);
    assert.equal(
      invalidPassword.body.error,
      "password must be a non-empty string no longer than 128 characters",
    );
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
    assert.equal(
      response.body.pets[0].ownerId,
      data.owner.id,
    );
  });

  test("sitter cannot access owner-only pet routes", async () => {
    const data = await seedTestData();

    const response = await request("/api/pets", {
      headers: authHeader(data.sitter),
    });

    assert.equal(response.status, 403);
  });

  test("pet routes reject invalid IDs", async () => {
    const data = await seedTestData();

    const getResponse = await request(
      "/api/pets/not-a-number",
      {
        headers: authHeader(data.owner),
      },
    );

    assert.equal(getResponse.status, 400);
    assert.equal(
      getResponse.body.error,
      "id must be a positive integer",
    );

    const updateResponse = await request(
      "/api/pets/0",
      {
        method: "PUT",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          name: "Rocky",
        }),
      },
    );

    assert.equal(updateResponse.status, 400);
    assert.equal(
      updateResponse.body.error,
      "id must be a positive integer",
    );

    const deleteResponse = await request(
      "/api/pets/-1",
      {
        method: "DELETE",
        headers: authHeader(data.owner),
      },
    );

    assert.equal(deleteResponse.status, 400);
    assert.equal(
      deleteResponse.body.error,
      "id must be a positive integer",
    );
  });

  test("pet creation rejects invalid fields", async () => {
    const data = await seedTestData();

    const whitespaceName = await request(
      "/api/pets",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          name: "   ",
          species: "Dog",
        }),
      },
    );

    assert.equal(whitespaceName.status, 400);
    assert.equal(
      whitespaceName.body.error,
      "name must be a non-empty string no longer than 50 characters",
    );

    const whitespaceSpecies = await request(
      "/api/pets",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          name: "Rocky",
          species: "   ",
        }),
      },
    );

    assert.equal(whitespaceSpecies.status, 400);
    assert.equal(
      whitespaceSpecies.body.error,
      "species must be a non-empty string no longer than 30 characters",
    );

    const invalidAge = await request(
      "/api/pets",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          name: "Rocky",
          species: "Dog",
          age: "4",
        }),
      },
    );

    assert.equal(invalidAge.status, 400);
    assert.equal(
      invalidAge.body.error,
      "age must be a non-negative integer or null",
    );

    const invalidPhotoUrl = await request(
      "/api/pets",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          name: "Rocky",
          species: "Dog",
          photoUrl: "not-a-url",
        }),
      },
    );

    assert.equal(invalidPhotoUrl.status, 400);
    assert.equal(
      invalidPhotoUrl.body.error,
      "photoUrl must be a valid HTTP or HTTPS URL",
    );

    const longName = await request(
      "/api/pets",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          name: "a".repeat(51),
          species: "Dog",
        }),
      },
    );

    assert.equal(longName.status, 400);
  });

  test("owner can intentionally clear nullable pet fields", async () => {
    const data = await seedTestData();

    const setResponse = await request(
      `/api/pets/${data.ownerPet.id}`,
      {
        method: "PUT",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          breed: "Labrador",
          age: 5,
          careNotes: "Daily medication",
          photoUrl:
            "https://example.com/rocky.jpg",
        }),
      },
    );

    assert.equal(setResponse.status, 200);
    assert.equal(
      setResponse.body.pet.breed,
      "Labrador",
    );
    assert.equal(setResponse.body.pet.age, 5);
    assert.equal(
      setResponse.body.pet.careNotes,
      "Daily medication",
    );

    const clearResponse = await request(
      `/api/pets/${data.ownerPet.id}`,
      {
        method: "PUT",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          breed: null,
          age: null,
          careNotes: null,
          photoUrl: null,
        }),
      },
    );

    assert.equal(clearResponse.status, 200);
    assert.equal(clearResponse.body.pet.breed, null);
    assert.equal(clearResponse.body.pet.age, null);
    assert.equal(
      clearResponse.body.pet.careNotes,
      null,
    );
    assert.equal(
      clearResponse.body.pet.photoUrl,
      null,
    );
  });

  test("owner can delete a pet without bookings", async () => {
    const data = await seedTestData();

    const response = await request(
      `/api/pets/${data.otherOwnerPet.id}`,
      {
        method: "DELETE",
        headers: authHeader(data.otherOwner),
      },
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.body.message,
      "Pet deleted successfully",
    );

    const { rows } = await pool.query(
      `
      SELECT id
      FROM pets
      WHERE id = $1;
      `,
      [data.otherOwnerPet.id],
    );

    assert.equal(rows.length, 0);
  });

  test("owner cannot delete a pet attached to a booking", async () => {
    const data = await seedTestData();

    await createTestBooking(data);

    const response = await request(
      `/api/pets/${data.ownerPet.id}`,
      {
        method: "DELETE",
        headers: authHeader(data.owner),
      },
    );

    assert.equal(response.status, 409);
    assert.equal(
      response.body.error,
      "Pet is attached to a booking and cannot be deleted",
    );

    const { rows } = await pool.query(
      `
      SELECT id
      FROM pets
      WHERE id = $1;
      `,
      [data.ownerPet.id],
    );

    assert.equal(rows.length, 1);
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

    const response = await request(
      `/api/sitters/${data.sitter.id}/availability`,
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.body.availability.length,
      2,
    );

    assert.ok(
      response.body.availability.every(
        (slot) => slot.isBooked === false,
      ),
    );
  });

  test("sitter cannot create availability in the past", async () => {
    const data = await seedTestData();
    const yesterdayString =
      await getDatabaseDate(-1);

    const response = await request(
      "/api/availability",
      {
        method: "POST",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          date: yesterdayString,
          startTime: "09:00",
          endTime: "09:30",
        }),
      },
    );

    assert.equal(response.status, 400);
    assert.equal(
      response.body.error,
      "date cannot be in the past",
    );
  });

  test("sitter cannot create same-day availability after the start time passed", async () => {
    const data = await seedTestData();
    const todayString = await getDatabaseDate();

    const response = await request(
      "/api/availability",
      {
        method: "POST",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          date: todayString,
          startTime: "00:00",
          endTime: "00:30",
        }),
      },
    );

    assert.equal(response.status, 400);
    assert.equal(
      response.body.error,
      "startTime cannot be in the past",
    );
  });

  test("sitter cannot create overlapping availability", async () => {
    const data = await seedTestData();
    const overlapDate = await getDatabaseDate(1);

    const response = await request(
      "/api/availability",
      {
        method: "POST",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          date: overlapDate,
          startTime: "09:15",
          endTime: "09:45",
        }),
      },
    );

    assert.equal(response.status, 409);
    assert.equal(
      response.body.error,
      "Availability slot overlaps an existing slot",
    );
  });

  test("sitter cannot update availability to overlap another slot", async () => {
    const data = await seedTestData();
    const overlapDate = await getDatabaseDate(1);

    const response = await request(
      `/api/availability/${data.availability[1].id}`,
      {
        method: "PUT",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          date: overlapDate,
          startTime: "09:15",
          endTime: "09:45",
        }),
      },
    );

    assert.equal(response.status, 409);
    assert.equal(
      response.body.error,
      "Availability slot overlaps an existing slot",
    );
  });

  test("availability routes reject invalid IDs", async () => {
    const data = await seedTestData();

    const publicResponse = await request(
      "/api/sitters/not-a-number/availability",
    );

    assert.equal(publicResponse.status, 400);
    assert.equal(
      publicResponse.body.error,
      "id must be a positive integer",
    );

    const updateResponse = await request(
      "/api/availability/0",
      {
        method: "PUT",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          startTime: "11:00",
        }),
      },
    );

    assert.equal(updateResponse.status, 400);
    assert.equal(
      updateResponse.body.error,
      "id must be a positive integer",
    );

    const deleteResponse = await request(
      "/api/availability/-1",
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(deleteResponse.status, 400);
    assert.equal(
      deleteResponse.body.error,
      "id must be a positive integer",
    );
  });

  test("owner cannot book expired availability directly", async () => {
    const data = await seedTestData();

    const { rows } = await pool.query(
      `
      INSERT INTO availability (
        sitter_id,
        date,
        start_time,
        end_time,
        is_booked
      )
      VALUES (
        $1,
        CURRENT_DATE - 1,
        '09:00',
        '09:30',
        false
      )
      RETURNING id;
      `,
      [data.sitter.id],
    );

    const response = await request("/api/bookings", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        sitterId: data.sitter.id,
        petId: data.ownerPet.id,
        sitterServiceId: data.sitterService.id,
        availabilityId: rows[0].id,
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(
      response.body.error,
      "Availability slot has expired",
    );
  });

  test("sitter cannot update availability attached to a booking", async () => {
    const data = await seedTestData();
    const futureDate = await getDatabaseDate(1);

    await createTestBooking(data);

    const response = await request(
      `/api/availability/${data.availability[0].id}`,
      {
        method: "PUT",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          date: futureDate,
          startTime: "11:00",
          endTime: "11:30",
        }),
      },
    );

    assert.equal(response.status, 409);
    assert.equal(
      response.body.error,
      "Availability slot is attached to a booking and cannot be changed",
    );
  });

  test("sitter cannot delete availability attached to a booking", async () => {
    const data = await seedTestData();

    await createTestBooking(data);

    const response = await request(
      `/api/availability/${data.availability[0].id}`,
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(response.status, 409);
    assert.equal(
      response.body.error,
      "Availability slot is attached to a booking and cannot be deleted",
    );
  });

  test("sitter routes validate IDs and filters", async () => {
    const invalidId = await request(
      "/api/sitters/not-a-number",
    );

    assert.equal(invalidId.status, 400);
    assert.equal(
      invalidId.body.error,
      "id must be a positive integer",
    );

    const blankCity = await request(
      "/api/sitters?city=%20%20",
    );

    assert.equal(blankCity.status, 400);

    const invalidState = await request(
      "/api/sitters?state=Illinois",
    );

    assert.equal(invalidState.status, 400);

    const invalidZipCode = await request(
      "/api/sitters?zipCode=invalid",
    );

    assert.equal(invalidZipCode.status, 400);

    const invalidMaxPrice = await request(
      "/api/sitters?maxPrice=-1",
    );

    assert.equal(invalidMaxPrice.status, 400);

    const invalidMinRating = await request(
      "/api/sitters?minRating=6",
    );

    assert.equal(invalidMinRating.status, 400);
  });

  test("sitter service creation validates IDs and prices", async () => {
    const data = await seedTestData();

    const invalidService = await request(
      "/api/sitters/me/services",
      {
        method: "POST",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          serviceId: "invalid",
        }),
      },
    );

    assert.equal(invalidService.status, 400);
    assert.equal(
      invalidService.body.error,
      "serviceId must be a positive integer",
    );

    const invalidPrice = await request(
      "/api/sitters/me/services",
      {
        method: "POST",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          serviceId: data.service.id,
          priceOverride: -1,
        }),
      },
    );

    assert.equal(invalidPrice.status, 400);
    assert.equal(
      invalidPrice.body.error,
      "priceOverride must be a non-negative number or null",
    );
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
    assert.equal(
      response.body.booking.ownerId,
      data.owner.id,
    );
    assert.equal(
      response.body.booking.sitterId,
      data.sitter.id,
    );
    assert.equal(
      response.body.booking.petId,
      data.ownerPet.id,
    );
    assert.equal(
      response.body.booking.sitterServiceId,
      data.sitterService.id,
    );
    assert.equal(
      response.body.booking.availabilityId,
      data.availability[0].id,
    );
    assert.equal(
      response.body.booking.status,
      "pending",
    );

    const { rows } = await pool.query(
      `
      SELECT is_booked
      FROM availability
      WHERE id = $1;
      `,
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

  test("booking creation validates every ID", async () => {
    const data = await seedTestData();

    const baseBody = {
      sitterId: data.sitter.id,
      petId: data.ownerPet.id,
      sitterServiceId: data.sitterService.id,
      availabilityId: data.availability[0].id,
    };

    const fields = [
      "sitterId",
      "petId",
      "sitterServiceId",
      "availabilityId",
    ];

    for (const field of fields) {
      const response = await request(
        "/api/bookings",
        {
          method: "POST",
          headers: authHeader(data.owner),
          body: JSON.stringify({
            ...baseBody,
            [field]: "invalid",
          }),
        },
      );

      assert.equal(response.status, 400);

      assert.equal(
        response.body.error,
        `${field} must be a positive integer`,
      );
    }
  });

  test("booking status is validated before authorization", async () => {
    const data = await seedTestData();
    const booking = await createTestBooking(data);

    const missingStatus = await request(
      `/api/bookings/${booking.id}/status`,
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({}),
      },
    );

    assert.equal(missingStatus.status, 400);
    assert.equal(
      missingStatus.body.error,
      "status must be one of: accepted, declined, cancelled, completed",
    );

    const invalidStatus = await request(
      `/api/bookings/${booking.id}/status`,
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          status: "invalid",
        }),
      },
    );

    assert.equal(invalidStatus.status, 400);
    assert.equal(
      invalidStatus.body.error,
      "status must be one of: accepted, declined, cancelled, completed",
    );

    const invalidId = await request(
      "/api/bookings/not-a-number/status",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          status: "cancelled",
        }),
      },
    );

    assert.equal(invalidId.status, 400);
    assert.equal(
      invalidId.body.error,
      "id must be a positive integer",
    );
  });

  test("booking list returns bookings wrapper", async () => {
    const data = await seedTestData();

    await createTestBooking(data);

    const response = await request("/api/bookings", {
      headers: authHeader(data.owner),
    });

    assert.equal(response.status, 200);
    assert.ok(
      Array.isArray(response.body.bookings),
    );
    assert.equal(response.body.bookings.length, 1);
    assert.equal(
      response.body.bookings[0].serviceName,
      "Dog Walking",
    );
  });

  test("declined booking releases availability", async () => {
    const data = await seedTestData();
    const booking = await createTestBooking(data);

    const updateResponse = await request(
      `/api/bookings/${booking.id}/status`,
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          status: "declined",
        }),
      },
    );

    assert.equal(updateResponse.status, 200);
    assert.equal(
      updateResponse.body.booking.status,
      "declined",
    );

    const { rows } = await pool.query(
      `
      SELECT is_booked
      FROM availability
      WHERE id = $1;
      `,
      [data.availability[0].id],
    );

    assert.equal(rows[0].is_booked, false);
  });

  test("owner can review completed booking once", async () => {
    const data = await seedTestData();

    const { rows: bookingRows } =
      await pool.query(
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
    assert.equal(
      response.body.review.bookingId,
      bookingRows[0].id,
    );
    assert.equal(
      response.body.review.rating,
      5,
    );

    const duplicateResponse = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: bookingRows[0].id,
          rating: 5,
          comment: "Second review",
        }),
      },
    );

    assert.equal(duplicateResponse.status, 409);
  });

  test("review creation validates IDs, ratings, and comments", async () => {
    const data = await seedTestData();

    const invalidBookingId = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: "invalid",
          rating: 5,
        }),
      },
    );

    assert.equal(invalidBookingId.status, 400);
    assert.equal(
      invalidBookingId.body.error,
      "bookingId must be a positive integer",
    );

    const stringRating = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: 1,
          rating: "5",
        }),
      },
    );

    assert.equal(stringRating.status, 400);
    assert.equal(
      stringRating.body.error,
      "rating must be an integer between 1 and 5",
    );

    const invalidComment = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: 1,
          rating: 5,
          comment: 42,
        }),
      },
    );

    assert.equal(invalidComment.status, 400);
    assert.equal(
      invalidComment.body.error,
      "comment must be a string or null",
    );

    const longComment = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: 1,
          rating: 5,
          comment: "a".repeat(2001),
        }),
      },
    );

    assert.equal(longComment.status, 400);
    assert.equal(
      longComment.body.error,
      "comment cannot exceed 2000 characters",
    );
  });

  test("message endpoints require authentication", async () => {
    const response = await request(
      "/api/messages",
    );

    assert.equal(response.status, 401);
    assert.equal(
      response.body.error,
      "Login required",
    );
  });

  test("booking participants can exchange and read messages", async () => {
    const data = await seedTestData();
    const booking = await createTestBooking(data);

    const ownerConversations = await request(
      "/api/messages",
      {
        headers: authHeader(data.owner),
      },
    );

    assert.equal(
      ownerConversations.status,
      200,
    );
    assert.equal(
      ownerConversations.body.conversations.length,
      1,
    );

    const initialConversation =
      ownerConversations.body.conversations[0];

    assert.equal(
      initialConversation.id,
      booking.id,
    );
    assert.equal(
      initialConversation.bookingId,
      booking.id,
    );
    assert.equal(
      initialConversation.participantId,
      data.sitter.id,
    );
    assert.equal(
      initialConversation.participantName,
      data.sitter.name,
    );
    assert.equal(
      initialConversation.bookingLabel,
      "Dog Walking - Rocky",
    );
    assert.equal(
      initialConversation.lastMessage,
      null,
    );
    assert.equal(
      initialConversation.unreadCount,
      0,
    );

    const sendResponse = await request(
      "/api/messages",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: booking.id,
          body: "Is tomorrow still a good time?",
        }),
      },
    );

    assert.equal(sendResponse.status, 201);
    assert.equal(
      sendResponse.body.message.bookingId,
      booking.id,
    );
    assert.equal(
      sendResponse.body.message.senderId,
      data.owner.id,
    );
    assert.equal(
      sendResponse.body.message.recipientId,
      data.sitter.id,
    );
    assert.equal(
      sendResponse.body.message.body,
      "Is tomorrow still a good time?",
    );

    const sitterConversations = await request(
      "/api/messages",
      {
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(
      sitterConversations.status,
      200,
    );
    assert.equal(
      sitterConversations.body.conversations[0]
        .unreadCount,
      1,
    );
    assert.equal(
      sitterConversations.body.conversations[0]
        .lastMessage,
      "Is tomorrow still a good time?",
    );

    const messagesResponse = await request(
      `/api/messages/${booking.id}`,
      {
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(messagesResponse.status, 200);
    assert.equal(
      messagesResponse.body.messages.length,
      1,
    );
    assert.equal(
      messagesResponse.body.messages[0].body,
      "Is tomorrow still a good time?",
    );
    assert.ok(
      messagesResponse.body.messages[0].readAt,
    );

    const conversationsAfterRead = await request(
      "/api/messages",
      {
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(
      conversationsAfterRead.body.conversations[0]
        .unreadCount,
      0,
    );
  });

  test("unrelated users cannot access booking messages", async () => {
    const data = await seedTestData();
    const booking = await createTestBooking(data);

    const readResponse = await request(
      `/api/messages/${booking.id}`,
      {
        headers: authHeader(data.otherOwner),
      },
    );

    assert.equal(readResponse.status, 404);
    assert.equal(
      readResponse.body.error,
      "Booking conversation not found",
    );

    const sendResponse = await request(
      "/api/messages",
      {
        method: "POST",
        headers: authHeader(data.otherOwner),
        body: JSON.stringify({
          bookingId: booking.id,
          body:
            "I should not be able to send this.",
        }),
      },
    );

    assert.equal(sendResponse.status, 404);
    assert.equal(
      sendResponse.body.error,
      "Booking conversation not found",
    );
  });

  test("message body validation rejects invalid messages", async () => {
    const data = await seedTestData();
    const booking = await createTestBooking(data);

    const emptyResponse = await request(
      "/api/messages",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: booking.id,
          body: "   ",
        }),
      },
    );

    assert.equal(emptyResponse.status, 400);
    assert.equal(
      emptyResponse.body.error,
      "Message body cannot be empty",
    );

    const longResponse = await request(
      "/api/messages",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: booking.id,
          body: "a".repeat(2001),
        }),
      },
    );

    assert.equal(longResponse.status, 400);
    assert.equal(
      longResponse.body.error,
      "Message body cannot exceed 2000 characters",
    );
  });

  test("booking messages are returned in chronological order", async () => {
    const data = await seedTestData();
    const booking = await createTestBooking(data);

    const firstResponse = await request(
      "/api/messages",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: booking.id,
          body: "First message",
        }),
      },
    );

    assert.equal(firstResponse.status, 201);

    const secondResponse = await request(
      "/api/messages",
      {
        method: "POST",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          bookingId: booking.id,
          body: "Second message",
        }),
      },
    );

    assert.equal(secondResponse.status, 201);

    const messagesResponse = await request(
      `/api/messages/${booking.id}`,
      {
        headers: authHeader(data.owner),
      },
    );

    assert.equal(messagesResponse.status, 200);

    assert.deepEqual(
      messagesResponse.body.messages.map(
        (message) => message.body,
      ),
      ["First message", "Second message"],
    );

    assert.deepEqual(
      messagesResponse.body.messages.map(
        (message) => message.senderId,
      ),
      [data.owner.id, data.sitter.id],
    );
  });

  test("global error handler returns a safe invalid JSON response", async () => {
    const response = await request(
      "/api/auth/login",
      {
        method: "POST",
        body: '{"email":',
      },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: "Request body contains invalid JSON",
    });
  });
});