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

describe(
  "message request validation",
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
      "message creation safely rejects a missing request body",
      async () => {
        const data = await seedTestData();

        const response = await request(
          "/api/messages",
          {
            method: "POST",
            headers:
              authHeader(data.owner),
          },
        );

        assert.equal(response.status, 400);

        assert.deepEqual(response.body, {
          error:
            "bookingId must be a positive integer",
        });
      },
    );

    test(
      "message creation rejects an array request body",
      async () => {
        const data = await seedTestData();

        const response = await request(
          "/api/messages",
          {
            method: "POST",
            headers:
              authHeader(data.owner),
            body: JSON.stringify([]),
          },
        );

        assert.equal(response.status, 400);

        assert.deepEqual(response.body, {
          error:
            "Request body must be a JSON object",
        });
      },
    );

    test(
      "message creation rejects coercive booking IDs",
      async () => {
        const data = await seedTestData();

        const invalidBookingIds = [
          true,
          "01",
          1.5,
          Number.MAX_SAFE_INTEGER + 1,
        ];

        for (
          const bookingId
          of invalidBookingIds
        ) {
          const response = await request(
            "/api/messages",
            {
              method: "POST",
              headers:
                authHeader(data.owner),
              body: JSON.stringify({
                bookingId,
                body: "Test message",
              }),
            },
          );

          assert.equal(
            response.status,
            400,
          );

          assert.deepEqual(
            response.body,
            {
              error:
                "bookingId must be a positive integer",
            },
          );
        }
      },
    );

    test(
      "message retrieval rejects malformed route IDs",
      async () => {
        const data = await seedTestData();

        const invalidBookingIds = [
          "01",
          "true",
          "1.5",
          "9007199254740992",
        ];

        for (
          const bookingId
          of invalidBookingIds
        ) {
          const response = await request(
            `/api/messages/${bookingId}`,
            {
              headers:
                authHeader(data.owner),
            },
          );

          assert.equal(
            response.status,
            400,
          );

          assert.deepEqual(
            response.body,
            {
              error:
                "bookingId must be a positive integer",
            },
          );
        }
      },
    );
  },
);