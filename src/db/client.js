import "dotenv/config";
import pg from "pg";
import {
  resolveAppTimeZone,
} from "../config/timeZone.js";

const { Pool, types } = pg;

const POSTGRES_DATE_OID = 1082;

export const APP_TIME_ZONE =
  resolveAppTimeZone(
    process.env.APP_TIME_ZONE,
  );

// Calendar dates must remain YYYY-MM-DD values
// instead of shifting with the host timezone.
types.setTypeParser(
  POSTGRES_DATE_OID,
  (value) => value,
);

if (!process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL is not set. Check your backend .env file.",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options:
    `-c timezone=${APP_TIME_ZONE}`,
});

export const query = (text, params) => {
  return pool.query(text, params);
};