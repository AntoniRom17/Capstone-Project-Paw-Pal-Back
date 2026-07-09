import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Check your server/.env file.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export const query = (text, params) => {
  return pool.query(text, params);
};
