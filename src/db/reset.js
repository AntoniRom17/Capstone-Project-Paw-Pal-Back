import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function reset() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("✅ Database schema rebuilt");
  await pool.end();
}

reset().catch((err) => {
  console.error("❌ Schema reset failed:", err.message);
  process.exit(1);
});
