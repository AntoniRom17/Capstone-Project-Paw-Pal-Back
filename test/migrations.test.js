import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  after,
  beforeEach,
  describe,
  test,
} from "node:test";
import {
  closeDb,
  resetTestDatabase,
} from "./helpers.js";
import { pool } from "../src/db/client.js";
import {
  runMigrations,
} from "../src/db/migrate.js";

const silentLogger = {
  log() {},
};

const APPLICATION_MIGRATIONS = [
  "001_initial_schema.sql",
  "002_prevent_availability_overlaps.sql",
  "003_add_account_deactivation.sql",
  "004_add_review_punctuality.sql",
  "005_replace_pet_photo_urls.sql",
  "006_add_user_profile_photos.sql",
];

function assertSafeTestDatabase() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Migration tests require NODE_ENV=test",
    );
  }

  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "Migration tests require TEST_DATABASE_URL",
    );
  }

  if (
    process.env.DATABASE_URL !==
    process.env.TEST_DATABASE_URL
  ) {
    throw new Error(
      "Migration tests must use TEST_DATABASE_URL",
    );
  }

  const parsedUrl = new URL(
    process.env.DATABASE_URL,
  );

  const databaseName = decodeURIComponent(
    parsedUrl.pathname.replace(/^\/+/, ""),
  );

  if (
    !databaseName
      .toLowerCase()
      .includes("test")
  ) {
    throw new Error(
      "Migration tests require a database name containing 'test'",
    );
  }
}

async function cleanupMigrationTestArtifacts() {
  assertSafeTestDatabase();

  await pool.query(`
    DROP TABLE IF EXISTS
      migration_rollback_test CASCADE;

    DROP TABLE IF EXISTS
      migration_first_test CASCADE;

    DROP TABLE IF EXISTS
      migration_checksum_test CASCADE;

    DROP TABLE IF EXISTS
      schema_migrations CASCADE;
  `);
}

async function dropApplicationTables() {
  assertSafeTestDatabase();

  await pool.query(`
    DROP TABLE IF EXISTS messages CASCADE;
    DROP TABLE IF EXISTS reviews CASCADE;
    DROP TABLE IF EXISTS bookings CASCADE;
    DROP TABLE IF EXISTS availability CASCADE;
    DROP TABLE IF EXISTS sitter_services CASCADE;
    DROP TABLE IF EXISTS services CASCADE;
    DROP TABLE IF EXISTS pets CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS schema_migrations CASCADE;
  `);
}

async function createTemporaryMigrations(
  files,
) {
  const directory = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "pawpal-migrations-",
    ),
  );

  for (
    const [filename, sql]
    of Object.entries(files)
  ) {
    await fs.writeFile(
      path.join(directory, filename),
      `${sql.trim()}\n`,
      "utf8",
    );
  }

  return directory;
}

describe(
  "non-destructive database migrations",
  () => {
    beforeEach(async () => {
      await resetTestDatabase();
      await cleanupMigrationTestArtifacts();
    });

    after(async () => {
      await cleanupMigrationTestArtifacts();
      await closeDb();
    });

    test("migrations upgrade an existing database without deleting rows", async () => {
      const { rows: insertedRows } =
        await pool.query(
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
          VALUES (
            'Migration Test User',
            'migration@example.com',
            'not-a-real-password-hash',
            'owner',
            'Chicago',
            'IL',
            '60601'
          )
          RETURNING id;
          `,
        );

      const userId = insertedRows[0].id;

      const firstRun = await runMigrations({
        databasePool: pool,
        logger: silentLogger,
      });

      assert.equal(
        firstRun.total,
        APPLICATION_MIGRATIONS.length,
      );

      assert.deepEqual(
        firstRun.applied,
        APPLICATION_MIGRATIONS,
      );

      const { rows: userRows } =
        await pool.query(
          `
          SELECT
            id,
            email,
            is_active AS "isActive",
            profile_photo_filename
              AS "profilePhotoFilename",
            profile_photo_content_type
              AS "profilePhotoContentType"
          FROM users
          WHERE id = $1;
          `,
          [userId],
        );

      assert.equal(userRows.length, 1);

      assert.equal(
        userRows[0].email,
        "migration@example.com",
      );

      assert.equal(
        userRows[0].isActive,
        true,
      );

      assert.equal(
        userRows[0].profilePhotoFilename,
        null,
      );

      assert.equal(
        userRows[0].profilePhotoContentType,
        null,
      );

      const { rows: migrationRows } =
        await pool.query(
          `
          SELECT
            version,
            name,
            CHAR_LENGTH(checksum)
              AS "checksumLength"
          FROM schema_migrations
          ORDER BY version;
          `,
        );

      assert.equal(
        migrationRows.length,
        APPLICATION_MIGRATIONS.length,
      );

      assert.ok(
        migrationRows.every(
          (migration) =>
            migration.checksumLength === 64,
        ),
      );

      const secondRun = await runMigrations({
        databasePool: pool,
        logger: silentLogger,
      });

      assert.equal(
        secondRun.total,
        APPLICATION_MIGRATIONS.length,
      );

      assert.deepEqual(
        secondRun.applied,
        [],
      );

      const { rows: userCountRows } =
        await pool.query(
          `
          SELECT COUNT(*)::integer AS count
          FROM users
          WHERE id = $1;
          `,
          [userId],
        );

      assert.equal(
        userCountRows[0].count,
        1,
      );
    });

    test("migrations build the complete schema in a fresh database", async () => {
      await dropApplicationTables();

      const result = await runMigrations({
        databasePool: pool,
        logger: silentLogger,
      });

      assert.equal(
        result.total,
        APPLICATION_MIGRATIONS.length,
      );

      assert.deepEqual(
        result.applied,
        APPLICATION_MIGRATIONS,
      );

      const { rows: tableRows } =
        await pool.query(
          `
          SELECT
            table_name AS "tableName"
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'users',
              'pets',
              'services',
              'sitter_services',
              'availability',
              'bookings',
              'reviews',
              'messages'
            )
          ORDER BY table_name;
          `,
        );

      assert.deepEqual(
        tableRows.map(
          (table) => table.tableName,
        ),
        [
          "availability",
          "bookings",
          "messages",
          "pets",
          "reviews",
          "services",
          "sitter_services",
          "users",
        ],
      );

      const { rows: columnRows } =
        await pool.query(
          `
          SELECT
            table_name AS "tableName",
            column_name AS "columnName"
          FROM information_schema.columns
          WHERE (
            table_name = 'users'
            AND column_name IN (
              'is_active',
              'deactivated_at',
              'profile_photo_filename',
              'profile_photo_content_type'
            )
          )
          OR (
            table_name = 'reviews'
            AND column_name = 'was_on_time'
          )
          ORDER BY
            table_name,
            column_name;
          `,
        );

      assert.deepEqual(columnRows, [
        {
          tableName: "reviews",
          columnName: "was_on_time",
        },
        {
          tableName: "users",
          columnName: "deactivated_at",
        },
        {
          tableName: "users",
          columnName: "is_active",
        },
        {
          tableName: "users",
          columnName:
            "profile_photo_content_type",
        },
        {
          tableName: "users",
          columnName:
            "profile_photo_filename",
        },
      ]);

      const { rows: constraintRows } =
        await pool.query(
          `
          SELECT COUNT(*)::integer AS count
          FROM pg_constraint
          WHERE conrelid =
            'availability'::regclass
            AND contype = 'x';
          `,
        );

      assert.equal(
        constraintRows[0].count,
        1,
      );

      const {
        rows: profileConstraintRows,
      } = await pool.query(
        `
        SELECT COUNT(*)::integer AS count
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname =
            'users_profile_photo_metadata_complete'
          AND contype = 'c';
        `,
      );

      assert.equal(
        profileConstraintRows[0].count,
        1,
      );

      const { rows: indexRows } =
        await pool.query(
          `
          SELECT
            to_regclass(
              'public.idx_users_active_sitter_location'
            ) AS "activeIndex",
            to_regclass(
              'public.idx_users_sitter_location'
            ) AS "oldIndex";
          `,
        );

      assert.ok(indexRows[0].activeIndex);

      assert.equal(
        indexRows[0].oldIndex,
        null,
      );

      const { rows: migrationRows } =
        await pool.query(
          `
          SELECT COUNT(*)::integer AS count
          FROM schema_migrations;
          `,
        );

      assert.equal(
        migrationRows[0].count,
        APPLICATION_MIGRATIONS.length,
      );
    });

    test("runner rejects an applied migration whose checksum changed", async () => {
      const filename =
        "001_create_checksum_table.sql";

      const migrationsDirectory =
        await createTemporaryMigrations({
          [filename]: `
            CREATE TABLE IF NOT EXISTS
              migration_checksum_test (
                id INTEGER PRIMARY KEY
              );
          `,
        });

      try {
        const firstRun = await runMigrations({
          databasePool: pool,
          migrationsDirectory,
          logger: silentLogger,
        });

        assert.deepEqual(
          firstRun.applied,
          [filename],
        );

        await fs.writeFile(
          path.join(
            migrationsDirectory,
            filename,
          ),
          `
          CREATE TABLE IF NOT EXISTS
            migration_checksum_test (
              id INTEGER PRIMARY KEY,
              changed_value TEXT
            );
          `,
          "utf8",
        );

        await assert.rejects(
          () =>
            runMigrations({
              databasePool: pool,
              migrationsDirectory,
              logger: silentLogger,
            }),
          /modified after it was applied/,
        );
      } finally {
        await fs.rm(
          migrationsDirectory,
          {
            recursive: true,
            force: true,
          },
        );
      }
    });

    test("failed migration rolls back and is not recorded", async () => {
      const migrationsDirectory =
        await createTemporaryMigrations({
          "001_create_first_table.sql": `
            CREATE TABLE
              migration_first_test (
                id INTEGER PRIMARY KEY
              );
          `,
          "002_fail_transaction.sql": `
            CREATE TABLE
              migration_rollback_test (
                id INTEGER PRIMARY KEY
              );

            INSERT INTO
              migration_rollback_test (id)
            VALUES (1);

            SELECT *
            FROM migration_table_that_does_not_exist;
          `,
        });

      try {
        await assert.rejects(
          () =>
            runMigrations({
              databasePool: pool,
              migrationsDirectory,
              logger: silentLogger,
            }),
          /Migration '002_fail_transaction\.sql' failed/,
        );

        const { rows: tableRows } =
          await pool.query(
            `
            SELECT
              to_regclass(
                'public.migration_first_test'
              ) AS "firstTable",
              to_regclass(
                'public.migration_rollback_test'
              ) AS "rolledBackTable";
            `,
          );

        assert.ok(
          tableRows[0].firstTable,
        );

        assert.equal(
          tableRows[0].rolledBackTable,
          null,
        );

        const { rows: migrationRows } =
          await pool.query(
            `
            SELECT version
            FROM schema_migrations
            ORDER BY version;
            `,
          );

        assert.deepEqual(
          migrationRows.map(
            (migration) =>
              migration.version,
          ),
          ["001"],
        );
      } finally {
        await fs.rm(
          migrationsDirectory,
          {
            recursive: true,
            force: true,
          },
        );
      }
    });
  },
);