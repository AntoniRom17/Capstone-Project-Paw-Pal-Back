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
  });

  test("authenticated user can read and update profile", async () => {
    const data = await seedTestData();

    const getResponse = await request("/api/users/me", {
      headers: authHeader(data.owner),
    });

    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.user.id, data.owner.id);
    assert.equal(
      getResponse.body.user.email,
      "owner@example.com",
    );
    assert.equal(getResponse.body.user.isActive, true);
    assert.equal(
      Object.hasOwn(
        getResponse.body.user,
        "password_hash",
      ),
      false,
    );

    const updateResponse = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          name: "  Updated Owner  ",
          email:
            "  UPDATED.OWNER@EXAMPLE.COM  ",
          bio: "  Loves long walks  ",
          phone: "  312-555-0100  ",
          city: "  Evanston  ",
          state: " il ",
          zipCode: "60201-1234",
        }),
      },
    );

    assert.equal(updateResponse.status, 200);
    assert.equal(
      updateResponse.body.user.name,
      "Updated Owner",
    );
    assert.equal(
      updateResponse.body.user.email,
      "updated.owner@example.com",
    );
    assert.equal(
      updateResponse.body.user.bio,
      "Loves long walks",
    );
    assert.equal(
      updateResponse.body.user.phone,
      "312-555-0100",
    );
    assert.equal(
      updateResponse.body.user.city,
      "Evanston",
    );
    assert.equal(
      updateResponse.body.user.state,
      "IL",
    );
    assert.equal(
      updateResponse.body.user.zipCode,
      "60201-1234",
    );

    const refreshedResponse = await request(
      "/api/users/me",
      {
        headers: authHeader(data.owner),
      },
    );

    assert.equal(refreshedResponse.status, 200);
    assert.equal(
      refreshedResponse.body.user.email,
      "updated.owner@example.com",
    );
  });

  test("profile updates reject invalid fields and duplicate emails", async () => {
    const data = await seedTestData();

    const emptyBody = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({}),
      },
    );

    assert.equal(emptyBody.status, 400);

    const whitespaceName = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          name: "   ",
        }),
      },
    );

    assert.equal(whitespaceName.status, 400);

    const invalidEmail = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          email: "not-an-email",
        }),
      },
    );

    assert.equal(invalidEmail.status, 400);

    const invalidState = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          state: "Illinois",
        }),
      },
    );

    assert.equal(invalidState.status, 400);

    const invalidZipCode = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          zipCode: "invalid",
        }),
      },
    );

    assert.equal(invalidZipCode.status, 400);

    const invalidBio = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bio: 42,
        }),
      },
    );

    assert.equal(invalidBio.status, 400);

    const duplicateEmail = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          email: data.sitter.email,
        }),
      },
    );

    assert.equal(duplicateEmail.status, 409);
    assert.equal(
      duplicateEmail.body.error,
      "An account with that email already exists",
    );
  });

  test("user can intentionally clear nullable profile fields", async () => {
    const data = await seedTestData();

    const setResponse = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bio: "Available on weekends",
          phone: "312-555-0110",
        }),
      },
    );

    assert.equal(setResponse.status, 200);
    assert.equal(
      setResponse.body.user.bio,
      "Available on weekends",
    );
    assert.equal(
      setResponse.body.user.phone,
      "312-555-0110",
    );

    const clearResponse = await request(
      "/api/users/me",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bio: null,
          phone: null,
        }),
      },
    );

    assert.equal(clearResponse.status, 200);
    assert.equal(clearResponse.body.user.bio, null);
    assert.equal(clearResponse.body.user.phone, null);
  });

  test("user can change password and login with the new password", async () => {
    const data = await seedTestData();

    const changeResponse = await request(
      "/api/users/me/password",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          currentPassword: "PawPal123!",
          newPassword: "NewPawPal456!",
        }),
      },
    );

    assert.equal(changeResponse.status, 200);
    assert.equal(
      changeResponse.body.message,
      "Password changed successfully",
    );

    const oldLoginResponse = await request(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: data.owner.email,
          password: "PawPal123!",
        }),
      },
    );

    assert.equal(oldLoginResponse.status, 401);

    const newLoginResponse = await request(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: data.owner.email,
          password: "NewPawPal456!",
        }),
      },
    );

    assert.equal(newLoginResponse.status, 200);
    assert.ok(newLoginResponse.body.token);
  });

  test("password changes reject incorrect and invalid passwords", async () => {
    const data = await seedTestData();

    const incorrectCurrentPassword =
      await request(
        "/api/users/me/password",
        {
          method: "PATCH",
          headers: authHeader(data.owner),
          body: JSON.stringify({
            currentPassword: "WrongPassword!",
            newPassword: "NewPawPal456!",
          }),
        },
      );

    assert.equal(
      incorrectCurrentPassword.status,
      401,
    );

    const shortPassword = await request(
      "/api/users/me/password",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          currentPassword: "PawPal123!",
          newPassword: "short",
        }),
      },
    );

    assert.equal(shortPassword.status, 400);

    const unchangedPassword = await request(
      "/api/users/me/password",
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          currentPassword: "PawPal123!",
          newPassword: "PawPal123!",
        }),
      },
    );

    assert.equal(unchangedPassword.status, 400);
    assert.equal(
      unchangedPassword.body.error,
      "New password must be different from current password",
    );
  });

  test("user can deactivate account and can no longer authenticate", async () => {
    const data = await seedTestData();

    const deactivateResponse = await request(
      "/api/users/me",
      {
        method: "DELETE",
        headers: authHeader(data.otherOwner),
        body: JSON.stringify({
          password: "PawPal123!",
        }),
      },
    );

    assert.equal(deactivateResponse.status, 200);
    assert.equal(
      deactivateResponse.body.message,
      "Account deactivated successfully",
    );

    const { rows } = await pool.query(
      `
      SELECT
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt"
      FROM users
      WHERE id = $1;
      `,
      [data.otherOwner.id],
    );

    assert.equal(rows[0].isActive, false);
    assert.ok(rows[0].deactivatedAt);

    const profileResponse = await request(
      "/api/users/me",
      {
        headers: authHeader(data.otherOwner),
      },
    );

    assert.equal(profileResponse.status, 401);
    assert.equal(
      profileResponse.body.error,
      "Account is inactive or no longer exists",
    );

    const loginResponse = await request(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: data.otherOwner.email,
          password: "PawPal123!",
        }),
      },
    );

    assert.equal(loginResponse.status, 401);
    assert.equal(
      loginResponse.body.error,
      "Invalid email or password",
    );
  });

  test("account deactivation requires correct password and no active bookings", async () => {
    const data = await seedTestData();

    const wrongPasswordResponse = await request(
      "/api/users/me",
      {
        method: "DELETE",
        headers: authHeader(data.otherOwner),
        body: JSON.stringify({
          password: "WrongPassword!",
        }),
      },
    );

    assert.equal(wrongPasswordResponse.status, 401);

    await createTestBooking(data);

    const ownerResponse = await request(
      "/api/users/me",
      {
        method: "DELETE",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          password: "PawPal123!",
        }),
      },
    );

    assert.equal(ownerResponse.status, 409);
    assert.equal(
      ownerResponse.body.error,
      "Account cannot be deactivated while active bookings exist",
    );

    const sitterResponse = await request(
      "/api/users/me",
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          password: "PawPal123!",
        }),
      },
    );

    assert.equal(sitterResponse.status, 409);

    const { rows } = await pool.query(
      `
      SELECT
        id,
        is_active AS "isActive"
      FROM users
      WHERE id = ANY($1::integer[])
      ORDER BY id;
      `,
      [[data.owner.id, data.sitter.id]],
    );

    assert.equal(rows.length, 2);
    assert.ok(
      rows.every((user) => user.isActive),
    );
  });

  test("deactivated sitter is hidden and cannot receive bookings", async () => {
    const data = await seedTestData();

    const deactivateResponse = await request(
      "/api/users/me",
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          password: "PawPal123!",
        }),
      },
    );

    assert.equal(deactivateResponse.status, 200);

    const listResponse = await request(
      "/api/sitters",
    );

    assert.equal(listResponse.status, 200);
    assert.equal(
      listResponse.body.sitters.some(
        (sitter) => sitter.id === data.sitter.id,
      ),
      false,
    );

    const detailResponse = await request(
      `/api/sitters/${data.sitter.id}`,
    );

    assert.equal(detailResponse.status, 404);
    assert.equal(
      detailResponse.body.error,
      "Sitter not found",
    );

    const availabilityResponse = await request(
      `/api/sitters/${data.sitter.id}/availability`,
    );

    assert.equal(availabilityResponse.status, 200);
    assert.deepEqual(
      availabilityResponse.body.availability,
      [],
    );

    const bookingResponse = await request(
      "/api/bookings",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          sitterId: data.sitter.id,
          petId: data.ownerPet.id,
          sitterServiceId:
            data.sitterService.id,
          availabilityId:
            data.availability[0].id,
        }),
      },
    );

    assert.equal(bookingResponse.status, 404);
    assert.equal(
      bookingResponse.body.error,
      "Sitter not found",
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

    const deleteResponse = await request(
      "/api/pets/-1",
      {
        method: "DELETE",
        headers: authHeader(data.owner),
      },
    );

    assert.equal(deleteResponse.status, 400);
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
  });

  test("availability routes reject invalid IDs", async () => {
    const data = await seedTestData();

    const publicResponse = await request(
      "/api/sitters/not-a-number/availability",
    );

    assert.equal(publicResponse.status, 400);

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

    const deleteResponse = await request(
      "/api/availability/-1",
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(deleteResponse.status, 400);
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
  });

  test("sitter routes validate IDs and filters", async () => {
    const invalidId = await request(
      "/api/sitters/not-a-number",
    );

    assert.equal(invalidId.status, 400);

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
  });

  test("sitter can update and reset a service price", async () => {
    const data = await seedTestData();

    const updateResponse = await request(
      `/api/sitters/me/services/${data.sitterService.id}`,
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          priceOverride: 31.5,
        }),
      },
    );

    assert.equal(updateResponse.status, 200);
    assert.equal(
      updateResponse.body.sitterService
        .sitterServiceId,
      data.sitterService.id,
    );
    assert.equal(
      updateResponse.body.sitterService.price,
      31.5,
    );

    const { rows: updatedRows } =
      await pool.query(
        `
        SELECT price_override::float
          AS "priceOverride"
        FROM sitter_services
        WHERE id = $1;
        `,
        [data.sitterService.id],
      );

    assert.equal(
      updatedRows[0].priceOverride,
      31.5,
    );

    const resetResponse = await request(
      `/api/sitters/me/services/${data.sitterService.id}`,
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          priceOverride: null,
        }),
      },
    );

    assert.equal(resetResponse.status, 200);
    assert.equal(
      resetResponse.body.sitterService.price,
      22,
    );

    const { rows: resetRows } = await pool.query(
      `
      SELECT price_override AS "priceOverride"
      FROM sitter_services
      WHERE id = $1;
      `,
      [data.sitterService.id],
    );

    assert.equal(
      resetRows[0].priceOverride,
      null,
    );
  });

  test("sitter can delete an unused service", async () => {
    const data = await seedTestData();

    const response = await request(
      `/api/sitters/me/services/${data.sitterService.id}`,
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.body.message,
      "Sitter service deleted successfully",
    );

    const { rows } = await pool.query(
      `
      SELECT id
      FROM sitter_services
      WHERE id = $1;
      `,
      [data.sitterService.id],
    );

    assert.equal(rows.length, 0);
  });

  test("sitter cannot manage another sitter's service", async () => {
    const data = await seedTestData();

    const { rows: sitterRows } = await pool.query(
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
      SELECT
        'Sitter Two',
        'sitter2@example.com',
        password_hash,
        'sitter',
        'Chicago',
        'IL',
        '60601'
      FROM users
      WHERE id = $1
      RETURNING id;
      `,
      [data.sitter.id],
    );

    const { rows: serviceRows } =
      await pool.query(
        `
        INSERT INTO sitter_services (
          sitter_id,
          service_id,
          price_override
        )
        VALUES ($1, $2, 30.00)
        RETURNING id;
        `,
        [
          sitterRows[0].id,
          data.service.id,
        ],
      );

    const otherSitterServiceId =
      serviceRows[0].id;

    const updateResponse = await request(
      `/api/sitters/me/services/${otherSitterServiceId}`,
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          priceOverride: 40,
        }),
      },
    );

    assert.equal(updateResponse.status, 404);
    assert.equal(
      updateResponse.body.error,
      "Sitter service not found",
    );

    const deleteResponse = await request(
      `/api/sitters/me/services/${otherSitterServiceId}`,
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(deleteResponse.status, 404);

    const { rows: remainingRows } =
      await pool.query(
        `
        SELECT id
        FROM sitter_services
        WHERE id = $1;
        `,
        [otherSitterServiceId],
      );

    assert.equal(remainingRows.length, 1);
  });

  test("sitter cannot delete a service attached to a booking", async () => {
    const data = await seedTestData();

    await createTestBooking(data);

    const response = await request(
      `/api/sitters/me/services/${data.sitterService.id}`,
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(response.status, 409);
    assert.equal(
      response.body.error,
      "Sitter service is attached to a booking and cannot be deleted",
    );

    const { rows } = await pool.query(
      `
      SELECT id
      FROM sitter_services
      WHERE id = $1;
      `,
      [data.sitterService.id],
    );

    assert.equal(rows.length, 1);
  });

  test("sitter service management validates update and delete requests", async () => {
    const data = await seedTestData();

    const invalidUpdateId = await request(
      "/api/sitters/me/services/not-a-number",
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          priceOverride: 30,
        }),
      },
    );

    assert.equal(invalidUpdateId.status, 400);

    const invalidDeleteId = await request(
      "/api/sitters/me/services/0",
      {
        method: "DELETE",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(invalidDeleteId.status, 400);

    const missingPrice = await request(
      `/api/sitters/me/services/${data.sitterService.id}`,
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({}),
      },
    );

    assert.equal(missingPrice.status, 400);
    assert.equal(
      missingPrice.body.error,
      "priceOverride is required",
    );

    const negativePrice = await request(
      `/api/sitters/me/services/${data.sitterService.id}`,
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          priceOverride: -1,
        }),
      },
    );

    assert.equal(negativePrice.status, 400);

    const excessivePrice = await request(
      `/api/sitters/me/services/${data.sitterService.id}`,
      {
        method: "PATCH",
        headers: authHeader(data.sitter),
        body: JSON.stringify({
          priceOverride: 1000000,
        }),
      },
    );

    assert.equal(excessivePrice.status, 400);

    const ownerResponse = await request(
      `/api/sitters/me/services/${data.sitterService.id}`,
      {
        method: "PATCH",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          priceOverride: 30,
        }),
      },
    );

    assert.equal(ownerResponse.status, 403);
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
  });

  test("message endpoints require authentication", async () => {
    const response = await request(
      "/api/messages",
    );

    assert.equal(response.status, 401);
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
  });

  test("booking messages are returned in chronological order", async () => {
    const data = await seedTestData();
    const booking = await createTestBooking(data);

    await request("/api/messages", {
      method: "POST",
      headers: authHeader(data.owner),
      body: JSON.stringify({
        bookingId: booking.id,
        body: "First message",
      }),
    });

    await request("/api/messages", {
      method: "POST",
      headers: authHeader(data.sitter),
      body: JSON.stringify({
        bookingId: booking.id,
        body: "Second message",
      }),
    });

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
      error:
        "Request body contains invalid JSON",
    });
  });
});