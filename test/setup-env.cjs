require("dotenv").config({ override: true });

const LOCAL_TEST_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

function fail(message) {
  throw new Error(
    [
      "Unsafe test database configuration.",
      message,
      "Set TEST_DATABASE_URL to a separate PostgreSQL database whose name includes 'test'.",
    ].join(" "),
  );
}

function parseDatabaseUrl(value, variableName) {
  if (!value) {
    fail(`${variableName} is required before running backend tests.`);
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    fail(`${variableName} must be a valid PostgreSQL connection string.`);
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    fail(`${variableName} must use the postgres:// or postgresql:// protocol.`);
  }

  return parsedUrl;
}

function getDatabaseName(parsedUrl) {
  return decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
}

function requireSafeTestDatabase() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const normalDatabaseUrl = process.env.DATABASE_URL;

  const parsedTestUrl = parseDatabaseUrl(
    testDatabaseUrl,
    "TEST_DATABASE_URL",
  );

  const testDatabaseName = getDatabaseName(parsedTestUrl);

  if (!testDatabaseName) {
    fail("TEST_DATABASE_URL must include a database name.");
  }

  if (!testDatabaseName.toLowerCase().includes("test")) {
    fail(
      `Refusing to run destructive tests against database '${testDatabaseName}' because its name does not include 'test'.`,
    );
  }

  if (normalDatabaseUrl && normalDatabaseUrl === testDatabaseUrl) {
    fail(
      "TEST_DATABASE_URL must not be the same value as DATABASE_URL.",
    );
  }

  if (
    !LOCAL_TEST_HOSTS.has(parsedTestUrl.hostname) &&
    process.env.ALLOW_NON_LOCAL_TEST_DATABASE !== "true"
  ) {
    fail(
      "TEST_DATABASE_URL must point to localhost unless ALLOW_NON_LOCAL_TEST_DATABASE=true is explicitly set.",
    );
  }

  process.env.DATABASE_URL = testDatabaseUrl;
}

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

requireSafeTestDatabase();