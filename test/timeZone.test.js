import assert from "node:assert/strict";
import {
  after,
  describe,
  test,
} from "node:test";
import {
  APP_TIME_ZONE,
  pool,
} from "../src/db/client.js";
import {
  DEFAULT_APP_TIME_ZONE,
  resolveAppTimeZone,
} from "../src/config/timeZone.js";

describe(
  "application timezone configuration",
  () => {
    after(async () => {
      await pool.end();
    });

    test(
      "uses UTC when APP_TIME_ZONE is omitted",
      () => {
        assert.equal(
          resolveAppTimeZone(undefined),
          DEFAULT_APP_TIME_ZONE,
        );

        assert.equal(
          resolveAppTimeZone(null),
          DEFAULT_APP_TIME_ZONE,
        );

        assert.equal(
          resolveAppTimeZone(""),
          DEFAULT_APP_TIME_ZONE,
        );

        assert.equal(
          resolveAppTimeZone("   "),
          DEFAULT_APP_TIME_ZONE,
        );
      },
    );

    test(
      "accepts and trims valid IANA timezones",
      () => {
        assert.equal(
          resolveAppTimeZone(
            " America/Chicago ",
          ),
          "America/Chicago",
        );

        assert.equal(
          resolveAppTimeZone("UTC"),
          "UTC",
        );
      },
    );

    test(
      "rejects invalid or unsafe timezone values",
      () => {
        assert.throws(
          () =>
            resolveAppTimeZone(
              "Not/A_Real_Timezone",
            ),
          /APP_TIME_ZONE must be a valid IANA time zone/,
        );

        assert.throws(
          () =>
            resolveAppTimeZone(
              "UTC -c statement_timeout=0",
            ),
          /APP_TIME_ZONE must be a valid IANA time zone/,
        );

        assert.throws(
          () => resolveAppTimeZone(123),
          /APP_TIME_ZONE must be a valid IANA time zone/,
        );
      },
    );

    test(
      "configures PostgreSQL sessions with APP_TIME_ZONE",
      async () => {
        const { rows } = await pool.query(
          `
          SELECT current_setting(
            'TimeZone'
          ) AS "timeZone";
          `,
        );

        assert.equal(
          rows[0].timeZone,
          APP_TIME_ZONE,
        );
      },
    );

    test(
      "returns PostgreSQL DATE values as calendar strings",
      async () => {
        const { rows } = await pool.query(
          `
          SELECT
            DATE '2026-01-02'
              AS "calendarDate";
          `,
        );

        assert.equal(
          rows[0].calendarDate,
          "2026-01-02",
        );

        assert.equal(
          typeof rows[0].calendarDate,
          "string",
        );
      },
    );
  },
);