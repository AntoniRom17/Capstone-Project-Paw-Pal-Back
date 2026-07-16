import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./client.js";

const currentFile = fileURLToPath(
  import.meta.url,
);

const currentDirectory = path.dirname(
  currentFile,
);

const DEFAULT_MIGRATIONS_DIRECTORY =
  path.join(
    currentDirectory,
    "migrations",
  );

const MIGRATION_FILE_PATTERN =
  /^(\d{3})_([a-z0-9_]+)\.sql$/;

const MIGRATION_LOCK_ID = 724150301;

function calculateChecksum(sql) {
  return crypto
    .createHash("sha256")
    .update(sql, "utf8")
    .digest("hex");
}

async function loadMigrations(
  migrationsDirectory,
) {
  const entries = await fs.readdir(
    migrationsDirectory,
    {
      withFileTypes: true,
    },
  );

  const sqlFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".sql"),
    )
    .map((entry) => entry.name)
    .sort();

  if (sqlFiles.length === 0) {
    throw new Error(
      `No migration files were found in ${migrationsDirectory}`,
    );
  }

  const seenVersions = new Set();
  const migrations = [];

  for (const filename of sqlFiles) {
    const match = filename.match(
      MIGRATION_FILE_PATTERN,
    );

    if (!match) {
      throw new Error(
        `Invalid migration filename '${filename}'. ` +
          "Expected a name such as 001_initial_schema.sql",
      );
    }

    const version = match[1];

    if (seenVersions.has(version)) {
      throw new Error(
        `Duplicate migration version '${version}'`,
      );
    }

    seenVersions.add(version);

    const filePath = path.join(
      migrationsDirectory,
      filename,
    );

    const rawSql = await fs.readFile(
      filePath,
      "utf8",
    );

    const sql = rawSql.replace(
      /\r\n/g,
      "\n",
    );

    if (!sql.trim()) {
      throw new Error(
        `Migration '${filename}' is empty`,
      );
    }

    migrations.push({
      version,
      filename,
      sql,
      checksum:
        calculateChecksum(sql),
    });
  }

  return migrations.sort((first, second) =>
    first.version.localeCompare(
      second.version,
    ),
  );
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS
      schema_migrations (
        version VARCHAR(20) PRIMARY KEY,
        name TEXT NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query(`
    SELECT
      version,
      name,
      checksum,
      applied_at AS "appliedAt"
    FROM schema_migrations
    ORDER BY version;
  `);

  return new Map(
    rows.map((migration) => [
      migration.version,
      migration,
    ]),
  );
}

function validateAppliedMigrations(
  migrations,
  appliedMigrations,
) {
  const migrationsByVersion = new Map(
    migrations.map((migration) => [
      migration.version,
      migration,
    ]),
  );

  for (
    const appliedMigration
    of appliedMigrations.values()
  ) {
    const localMigration =
      migrationsByVersion.get(
        appliedMigration.version,
      );

    if (!localMigration) {
      throw new Error(
        `Applied migration version ` +
          `'${appliedMigration.version}' ` +
          "does not exist in the migrations folder",
      );
    }

    if (
      appliedMigration.name !==
      localMigration.filename
    ) {
      throw new Error(
        `Migration version ` +
          `'${localMigration.version}' ` +
          "has been renamed after it was applied",
      );
    }

    if (
      appliedMigration.checksum.trim() !==
      localMigration.checksum
    ) {
      throw new Error(
        `Migration '${localMigration.filename}' ` +
          "has been modified after it was applied",
      );
    }
  }
}

async function applyMigration(
  client,
  migration,
) {
  await client.query("BEGIN");

  try {
    await client.query(migration.sql);

    await client.query(
      `
      INSERT INTO schema_migrations (
        version,
        name,
        checksum
      )
      VALUES ($1, $2, $3);
      `,
      [
        migration.version,
        migration.filename,
        migration.checksum,
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");

    throw new Error(
      `Migration '${migration.filename}' failed: ` +
        error.message,
      {
        cause: error,
      },
    );
  }
}

export async function runMigrations({
  databasePool = pool,
  migrationsDirectory =
    DEFAULT_MIGRATIONS_DIRECTORY,
  logger = console,
} = {}) {
  const migrations = await loadMigrations(
    migrationsDirectory,
  );

  const client =
    await databasePool.connect();

  let lockAcquired = false;
  let unlockError = null;

  try {
    await client.query(
      "SELECT pg_advisory_lock($1);",
      [MIGRATION_LOCK_ID],
    );

    lockAcquired = true;

    await ensureMigrationTable(client);

    const appliedMigrations =
      await getAppliedMigrations(client);

    validateAppliedMigrations(
      migrations,
      appliedMigrations,
    );

    const newlyApplied = [];

    for (const migration of migrations) {
      if (
        appliedMigrations.has(
          migration.version,
        )
      ) {
        logger.log(
          `Already applied: ${migration.filename}`,
        );

        continue;
      }

      logger.log(
        `Applying: ${migration.filename}`,
      );

      await applyMigration(
        client,
        migration,
      );

      newlyApplied.push(
        migration.filename,
      );

      logger.log(
        `Applied: ${migration.filename}`,
      );
    }

    if (newlyApplied.length === 0) {
      logger.log(
        "Database is already up to date.",
      );
    }

    return {
      applied: newlyApplied,
      total: migrations.length,
    };
  } finally {
    if (lockAcquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock($1);",
          [MIGRATION_LOCK_ID],
        );
      } catch (error) {
        unlockError = error;
      }
    }

    if (unlockError) {
      client.release(unlockError);
      throw unlockError;
    }

    client.release();
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(currentFile);

if (isMainModule) {
  runMigrations()
    .catch((error) => {
      console.error(
        "Database migration failed:",
        error.message,
      );

      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}