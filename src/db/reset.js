import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./client.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const defaultSchemaPath = path.join(
  currentDirectory,
  "schema.sql",
);

const reservedDatabaseNames = new Set([
  "postgres",
  "template0",
  "template1",
]);

function parseDatabaseUrl(value) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      "DATABASE_URL is required before resetting the database",
    );
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(
      "DATABASE_URL must be a valid PostgreSQL connection string",
    );
  }

  if (
    !["postgres:", "postgresql:"].includes(
      parsedUrl.protocol,
    )
  ) {
    throw new Error(
      "DATABASE_URL must use the postgres:// or postgresql:// protocol",
    );
  }

  return parsedUrl;
}

function getDatabaseName(parsedUrl) {
  return decodeURIComponent(
    parsedUrl.pathname.replace(/^\/+/, ""),
  );
}

export function assertSafeResetTarget({
  nodeEnv = process.env.NODE_ENV,
  databaseUrl = process.env.DATABASE_URL,
  confirmation = process.env.CONFIRM_DATABASE_RESET,
} = {}) {
  if (nodeEnv !== "development") {
    throw new Error(
      "Database reset is allowed only when NODE_ENV=development",
    );
  }

  const parsedUrl = parseDatabaseUrl(databaseUrl);
  const databaseName = getDatabaseName(parsedUrl);

  if (!databaseName) {
    throw new Error(
      "DATABASE_URL must include a database name",
    );
  }

  if (
    reservedDatabaseNames.has(
      databaseName.toLowerCase(),
    )
  ) {
    throw new Error(
      `Refusing to reset reserved database '${databaseName}'`,
    );
  }

  if (confirmation !== databaseName) {
    throw new Error(
      "Set CONFIRM_DATABASE_RESET to the exact database name before running db:reset",
    );
  }

  return {
    databaseName,
  };
}

export async function resetDatabase({
  databasePool = pool,
  schemaPath = defaultSchemaPath,
  environment = process.env,
  logger = console,
} = {}) {
  const { databaseName } = assertSafeResetTarget({
    nodeEnv: environment.NODE_ENV,
    databaseUrl: environment.DATABASE_URL,
    confirmation:
      environment.CONFIRM_DATABASE_RESET,
  });

  const schema = await fs.readFile(
    schemaPath,
    "utf8",
  );

  await databasePool.query(schema);

  logger.log(
    `Database '${databaseName}' schema rebuilt`,
  );

  return {
    databaseName,
  };
}

async function runResetCommand() {
  try {
    await resetDatabase();
  } catch (error) {
    console.error(
      "Database reset failed:",
      error.message,
    );

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(currentFile);

if (isMainModule) {
  runResetCommand();
}