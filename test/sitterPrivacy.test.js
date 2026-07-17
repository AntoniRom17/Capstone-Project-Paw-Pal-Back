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

const TEST_PHONE = "312-555-0184";

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

async function seedSitterWithPhone() {
  const data = await seedTestData();

  await pool.query(
    `
    UPDATE users
    SET phone = $1
    WHERE id = $2;
    `,
    [
      TEST_PHONE,
      data.sitter.id,
    ],
  );

  return data;
}

describe(
  "sitter phone privacy",
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
      "public sitter list does not expose phone numbers",
      async () => {
        const data =
          await seedSitterWithPhone();

        const response = await request(
          "/api/sitters",
        );

        assert.equal(response.status, 200);

        const sitter =
          response.body.sitters.find(
            (candidate) =>
              candidate.id ===
              data.sitter.id,
          );

        assert.ok(sitter);

        assert.equal(
          Object.hasOwn(
            sitter,
            "phone",
          ),
          false,
        );
      },
    );

    test(
      "public sitter detail does not expose the phone number",
      async () => {
        const data =
          await seedSitterWithPhone();

        const response = await request(
          `/api/sitters/${data.sitter.id}`,
        );

        assert.equal(response.status, 200);

        assert.equal(
          Object.hasOwn(
            response.body.sitter,
            "phone",
          ),
          false,
        );
      },
    );

    test(
      "authenticated sitter can retrieve their own phone number",
      async () => {
        const data =
          await seedSitterWithPhone();

        const response = await request(
          "/api/users/me",
          {
            headers:
              authHeader(data.sitter),
          },
        );

        assert.equal(response.status, 200);

        assert.equal(
          response.body.user.phone,
          TEST_PHONE,
        );
      },
    );
  },
);