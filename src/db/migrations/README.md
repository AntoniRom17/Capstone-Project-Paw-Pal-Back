# Database Migrations

This folder contains PawPal's numbered, forward-only PostgreSQL migrations.

## Deployment

Run pending migrations with:

```powershell
npm run db:migrate
```

The migration runner:

- Applies migrations in version order.
- Runs each migration inside a transaction.
- Records completed migrations in `schema_migrations`.
- Uses SHA-256 checksums to detect edited migrations.
- Uses a PostgreSQL advisory lock to prevent simultaneous migration runs.
- Skips migrations that were already applied.

## Creating A Migration

When a schema change is needed, create the next numbered SQL file:

```powershell
New-Item -ItemType File -Path src\db\migrations\007_describe_the_change.sql
```

Migration filenames must use this format:

```text
NNN_lowercase_description.sql
```

Current application migrations:

```text
001_initial_schema.sql
002_prevent_availability_overlaps.sql
003_add_account_deactivation.sql
004_add_review_punctuality.sql
005_replace_pet_photo_urls.sql
006_add_user_profile_photos.sql
```

A future migration might contain SQL such as:

```sql
ALTER TABLE example_table
  ADD COLUMN IF NOT EXISTS
    example_column TEXT;

CREATE INDEX IF NOT EXISTS
  idx_example_table_example_column
  ON example_table (example_column);
```

Replace the example table, column, and index names with the names required by the actual schema change.

Never add `DROP TABLE` statements to a deployment migration unless permanent data deletion is explicitly intended and reviewed.

## Applied Migrations

Never edit, rename, or delete a migration after it has been applied to a shared database.

The runner rejects changed files because their names or checksums no longer match the records in `schema_migrations`.

Create a new numbered migration for every later schema change.

## Local Reset Script

`npm run db:reset` executes `src/db/schema.sql`, which drops and rebuilds all application tables.

Use the reset script only for disposable local databases. Never use it to update staging or production.

## Backups

Create and verify a database backup before running migrations against staging or production.

Migrations are designed to preserve existing rows, but backups remain part of a safe deployment process.