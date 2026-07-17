import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeResetTarget,
} from "../src/db/reset.js";

const safeDevelopmentConfiguration = {
  nodeEnv: "development",
  databaseUrl:
    "postgresql://postgres:password@localhost:5432/pawpal",
  confirmation: "pawpal",
};

test(
  "allows a development reset with exact database confirmation",
  () => {
    const result = assertSafeResetTarget(
      safeDevelopmentConfiguration,
    );

    assert.deepEqual(result, {
      databaseName: "pawpal",
    });
  },
);

test(
  "rejects database resets outside development",
  () => {
    assert.throws(
      () =>
        assertSafeResetTarget({
          ...safeDevelopmentConfiguration,
          nodeEnv: "production",
        }),
      /allowed only when NODE_ENV=development/,
    );
  },
);

test(
  "requires DATABASE_URL before resetting",
  () => {
    assert.throws(
      () =>
        assertSafeResetTarget({
          ...safeDevelopmentConfiguration,
          databaseUrl: "",
        }),
      /DATABASE_URL is required/,
    );
  },
);

test(
  "rejects malformed database URLs",
  () => {
    assert.throws(
      () =>
        assertSafeResetTarget({
          ...safeDevelopmentConfiguration,
          databaseUrl: "not-a-database-url",
        }),
      /valid PostgreSQL connection string/,
    );
  },
);

test(
  "rejects non-PostgreSQL database URLs",
  () => {
    assert.throws(
      () =>
        assertSafeResetTarget({
          ...safeDevelopmentConfiguration,
          databaseUrl:
            "mysql://root:password@localhost:3306/pawpal",
        }),
      /must use the postgres:\/\/ or postgresql:\/\//,
    );
  },
);

test(
  "requires a database name in DATABASE_URL",
  () => {
    assert.throws(
      () =>
        assertSafeResetTarget({
          ...safeDevelopmentConfiguration,
          databaseUrl:
            "postgresql://postgres:password@localhost:5432",
        }),
      /must include a database name/,
    );
  },
);

test(
  "rejects reserved PostgreSQL database names",
  () => {
    for (const databaseName of [
      "postgres",
      "template0",
      "template1",
    ]) {
      assert.throws(
        () =>
          assertSafeResetTarget({
            ...safeDevelopmentConfiguration,
            databaseUrl:
              `postgresql://postgres:password@localhost:5432/${databaseName}`,
            confirmation: databaseName,
          }),
        /Refusing to reset reserved database/,
      );
    }
  },
);

test(
  "requires database reset confirmation",
  () => {
    assert.throws(
      () =>
        assertSafeResetTarget({
          ...safeDevelopmentConfiguration,
          confirmation: undefined,
        }),
      /Set CONFIRM_DATABASE_RESET/,
    );
  },
);

test(
  "requires confirmation to exactly match the database name",
  () => {
    assert.throws(
      () =>
        assertSafeResetTarget({
          ...safeDevelopmentConfiguration,
          confirmation: "different_database",
        }),
      /Set CONFIRM_DATABASE_RESET/,
    );
  },
);