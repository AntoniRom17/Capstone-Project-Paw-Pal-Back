import assert from "node:assert/strict";
import {
  after,
  beforeEach,
  describe,
  test,
} from "node:test";
import {
  authHeader,
  closeDb,
  resetTestDatabase,
  seedTestData,
  startTestServer,
} from "./helpers.js";
import { pool } from "../src/db/client.js";

const BACKGROUND_CHECK_WEBHOOK_SECRET =
  "test-background-check-secret";

process.env.BACKGROUND_CHECK_WEBHOOK_SECRET =
  BACKGROUND_CHECK_WEBHOOK_SECRET;

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

  const body = text
    ? JSON.parse(text)
    : null;

  return {
    status: response.status,
    body,
  };
}

async function createTestBooking(
  data,
  availabilityIndex = 0,
) {
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
          data.availability[
            availabilityIndex
          ].id,
      }),
    },
  );

  assert.equal(response.status, 201);

  return response.body.booking;
}

async function completeTestBooking(
  data,
  availabilityIndex = 0,
) {
  const booking = await createTestBooking(
    data,
    availabilityIndex,
  );

  const acceptedResponse = await request(
    `/api/bookings/${booking.id}/status`,
    {
      method: "PATCH",
      headers: authHeader(data.sitter),
      body: JSON.stringify({
        status: "accepted",
      }),
    },
  );

  assert.equal(acceptedResponse.status, 200);

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
    [booking.id],
  );

  const completedResponse = await request(
    `/api/bookings/${booking.id}/status`,
    {
      method: "PATCH",
      headers: authHeader(data.sitter),
      body: JSON.stringify({
        status: "completed",
      }),
    },
  );

  assert.equal(completedResponse.status, 200);

  return completedResponse.body.booking;
}

function webhookHeaders(
  secret = BACKGROUND_CHECK_WEBHOOK_SECRET,
) {
  return {
    "x-background-check-secret": secret,
  };
}

describe("Trust Score behavior", () => {
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

  test("review rating and punctuality update sitter trust metrics", async () => {
    const data = await seedTestData();

    const booking =
      await completeTestBooking(data);

    const reviewResponse = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: booking.id,
          rating: 5,
          wasOnTime: true,
          comment:
            "Excellent care and right on time.",
        }),
      },
    );

    assert.equal(reviewResponse.status, 201);

    assert.equal(
      reviewResponse.body.review.wasOnTime,
      true,
    );

    assert.equal(
      reviewResponse.body.trustMetrics
        .trustScore,
      90,
    );

    assert.equal(
      reviewResponse.body.trustMetrics
        .onTimePercentage,
      100,
    );

    assert.equal(
      reviewResponse.body.trustMetrics
        .backgroundCheckStatus,
      "not_submitted",
    );

    const { rows } = await pool.query(
      `
      SELECT
        trust_score AS "trustScore",
        on_time_percentage
          AS "onTimePercentage"
      FROM users
      WHERE id = $1;
      `,
      [data.sitter.id],
    );

    assert.equal(rows[0].trustScore, 90);

    assert.equal(
      rows[0].onTimePercentage,
      100,
    );
  });

  test("multiple reviews recalculate rating and punctuality averages", async () => {
    const data = await seedTestData();

    const firstBooking =
      await completeTestBooking(data, 0);

    const firstReview = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: firstBooking.id,
          rating: 5,
          wasOnTime: true,
        }),
      },
    );

    assert.equal(firstReview.status, 201);

    const secondBooking =
      await completeTestBooking(data, 1);

    const secondReview = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: secondBooking.id,
          rating: 3,
          wasOnTime: false,
        }),
      },
    );

    assert.equal(secondReview.status, 201);

    assert.equal(
      secondReview.body.trustMetrics
        .onTimePercentage,
      50,
    );

    assert.equal(
      secondReview.body.trustMetrics
        .trustScore,
      66,
    );

    const sitterResponse = await request(
      `/api/sitters/${data.sitter.id}`,
    );

    assert.equal(sitterResponse.status, 200);

    assert.equal(
      sitterResponse.body.sitter.trustScore,
      66,
    );

    assert.equal(
      sitterResponse.body.sitter
        .onTimePercentage,
      50,
    );
  });

  test("only sitters can submit background checks and duplicate submissions conflict", async () => {
    const data = await seedTestData();

    const ownerResponse = await request(
      "/api/sitters/me/background-check",
      {
        method: "POST",
        headers: authHeader(data.owner),
      },
    );

    assert.equal(ownerResponse.status, 403);

    const submitResponse = await request(
      "/api/sitters/me/background-check",
      {
        method: "POST",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(submitResponse.status, 200);

    assert.equal(
      submitResponse.body.backgroundCheck
        .backgroundCheckStatus,
      "pending",
    );

    assert.equal(
      submitResponse.body.trustMetrics
        .trustScore,
      0,
    );

    const duplicateResponse = await request(
      "/api/sitters/me/background-check",
      {
        method: "POST",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(
      duplicateResponse.status,
      409,
    );

    assert.equal(
      duplicateResponse.body.error,
      "Background check is already pending",
    );

    const { rows } = await pool.query(
      `
      SELECT
        background_check_status
          AS "backgroundCheckStatus"
      FROM users
      WHERE id = $1;
      `,
      [data.sitter.id],
    );

    assert.equal(
      rows[0].backgroundCheckStatus,
      "pending",
    );
  });

  test("verified background check adds the Trust Score bonus", async () => {
    const data = await seedTestData();

    const booking =
      await completeTestBooking(data);

    const reviewResponse = await request(
      "/api/reviews",
      {
        method: "POST",
        headers: authHeader(data.owner),
        body: JSON.stringify({
          bookingId: booking.id,
          rating: 5,
          wasOnTime: true,
        }),
      },
    );

    assert.equal(reviewResponse.status, 201);

    assert.equal(
      reviewResponse.body.trustMetrics
        .trustScore,
      90,
    );

    const submitResponse = await request(
      "/api/sitters/me/background-check",
      {
        method: "POST",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(submitResponse.status, 200);

    const verifiedResponse = await request(
      `/api/background-checks/${data.sitter.id}`,
      {
        method: "PATCH",
        headers: webhookHeaders(),
        body: JSON.stringify({
          status: "verified",
        }),
      },
    );

    assert.equal(verifiedResponse.status, 200);

    assert.equal(
      verifiedResponse.body.backgroundCheck
        .backgroundCheckStatus,
      "verified",
    );

    assert.equal(
      verifiedResponse.body.trustMetrics
        .trustScore,
      100,
    );

    assert.equal(
      verifiedResponse.body.trustMetrics
        .onTimePercentage,
      100,
    );

    const repeatedResponse = await request(
      `/api/background-checks/${data.sitter.id}`,
      {
        method: "PATCH",
        headers: webhookHeaders(),
        body: JSON.stringify({
          status: "verified",
        }),
      },
    );

    assert.equal(repeatedResponse.status, 200);

    assert.equal(
      repeatedResponse.body.trustMetrics
        .trustScore,
      100,
    );

    const sitterResponse = await request(
      `/api/sitters/${data.sitter.id}`,
    );

    assert.equal(sitterResponse.status, 200);

    assert.equal(
      sitterResponse.body.sitter
        .backgroundCheckStatus,
      "verified",
    );

    assert.equal(
      sitterResponse.body.sitter.trustScore,
      100,
    );
  });

  test("background check callbacks validate requests and rejected sitters can resubmit", async () => {
    const data = await seedTestData();

    const invalidPunctuality =
      await request(
        "/api/reviews",
        {
          method: "POST",
          headers: authHeader(data.owner),
          body: JSON.stringify({
            bookingId: 1,
            rating: 5,
            wasOnTime: "yes",
          }),
        },
      );

    assert.equal(
      invalidPunctuality.status,
      400,
    );

    assert.equal(
      invalidPunctuality.body.error,
      "wasOnTime must be a boolean or null",
    );

    const invalidSecret = await request(
      `/api/background-checks/${data.sitter.id}`,
      {
        method: "PATCH",
        headers: webhookHeaders(
          "incorrect-secret",
        ),
        body: JSON.stringify({
          status: "verified",
        }),
      },
    );

    assert.equal(invalidSecret.status, 401);

    const invalidId = await request(
      "/api/background-checks/not-a-number",
      {
        method: "PATCH",
        headers: webhookHeaders(),
        body: JSON.stringify({
          status: "verified",
        }),
      },
    );

    assert.equal(invalidId.status, 400);

    const invalidStatus = await request(
      `/api/background-checks/${data.sitter.id}`,
      {
        method: "PATCH",
        headers: webhookHeaders(),
        body: JSON.stringify({
          status: "pending",
        }),
      },
    );

    assert.equal(invalidStatus.status, 400);

    const nonPendingResponse = await request(
      `/api/background-checks/${data.sitter.id}`,
      {
        method: "PATCH",
        headers: webhookHeaders(),
        body: JSON.stringify({
          status: "verified",
        }),
      },
    );

    assert.equal(
      nonPendingResponse.status,
      409,
    );

    const submitResponse = await request(
      "/api/sitters/me/background-check",
      {
        method: "POST",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(submitResponse.status, 200);

    const rejectedResponse = await request(
      `/api/background-checks/${data.sitter.id}`,
      {
        method: "PATCH",
        headers: webhookHeaders(),
        body: JSON.stringify({
          status: "rejected",
        }),
      },
    );

    assert.equal(rejectedResponse.status, 200);

    assert.equal(
      rejectedResponse.body.backgroundCheck
        .backgroundCheckStatus,
      "rejected",
    );

    assert.equal(
      rejectedResponse.body.trustMetrics
        .trustScore,
      0,
    );

    const resubmitResponse = await request(
      "/api/sitters/me/background-check",
      {
        method: "POST",
        headers: authHeader(data.sitter),
      },
    );

    assert.equal(resubmitResponse.status, 200);

    assert.equal(
      resubmitResponse.body.backgroundCheck
        .backgroundCheckStatus,
      "pending",
    );
  });
});