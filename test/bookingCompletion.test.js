import assert from "node:assert/strict";
import {
  after,
  beforeEach,
  describe,
  test,
} from "node:test";
import { pool } from "../src/db/client.js";
import {
  authHeader,
  closeDb,
  resetTestDatabase,
  seedTestData,
  startTestServer,
} from "./helpers.js";

let server;

async function request(path, options = {}) {
  const { headers = {}, ...requestOptions } =
    options;

  const response = await fetch(
    `${server.baseUrl}${path}`,
    {
      ...requestOptions,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    },
  );

  const text = await response.text();

  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function createTestBooking(data) {
  const response = await request(
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

  assert.equal(response.status, 201);

  return response.body.booking;
}

async function acceptTestBooking(
  data,
  bookingId,
) {
  const response = await request(
    `/api/bookings/${bookingId}/status`,
    {
      method: "PATCH",
      headers: authHeader(data.sitter),
      body: JSON.stringify({
        status: "accepted",
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.body.booking.status,
    "accepted",
  );
}

async function completeTestBooking(
  data,
  bookingId,
) {
  return request(
    `/api/bookings/${bookingId}/status`,
    {
      method: "PATCH",
      headers: authHeader(data.sitter),
      body: JSON.stringify({
        status: "completed",
      }),
    },
  );
}

async function moveBookingToPast(
  bookingId,
) {
  await pool.query(
    `
    WITH updated_booking AS (
      UPDATE bookings
      SET date = CURRENT_DATE - 1
      WHERE id = $1
      RETURNING availability_id
    )
    UPDATE availability a
    SET date = CURRENT_DATE - 1
    FROM updated_booking b
    WHERE a.id = b.availability_id;
    `,
    [bookingId],
  );
}

describe(
  "booking completion timing",
  () => {
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

    test(
      "sitter cannot complete a future booking",
      async () => {
        const data = await seedTestData();
        const booking =
          await createTestBooking(data);

        await acceptTestBooking(
          data,
          booking.id,
        );

        const response =
          await completeTestBooking(
            data,
            booking.id,
          );

        assert.equal(response.status, 400);

        assert.deepEqual(response.body, {
          error:
            "Booking cannot be completed before its scheduled end time",
        });

        const { rows: bookingRows } =
          await pool.query(
            `
            SELECT status
            FROM bookings
            WHERE id = $1;
            `,
            [booking.id],
          );

        assert.equal(
          bookingRows[0].status,
          "accepted",
        );

        const { rows: availabilityRows } =
          await pool.query(
            `
            SELECT
              is_booked AS "isBooked"
            FROM availability
            WHERE id = $1;
            `,
            [booking.availabilityId],
          );

        assert.equal(
          availabilityRows[0].isBooked,
          true,
        );
      },
    );

    test(
      "sitter can complete a booking after its scheduled end time",
      async () => {
        const data = await seedTestData();
        const booking =
          await createTestBooking(data);

        await acceptTestBooking(
          data,
          booking.id,
        );

        await moveBookingToPast(
          booking.id,
        );

        const response =
          await completeTestBooking(
            data,
            booking.id,
          );

        assert.equal(response.status, 200);

        assert.equal(
          response.body.booking.status,
          "completed",
        );

        const { rows } = await pool.query(
          `
          SELECT status
          FROM bookings
          WHERE id = $1;
          `,
          [booking.id],
        );

        assert.equal(
          rows[0].status,
          "completed",
        );
      },
    );
  },
);