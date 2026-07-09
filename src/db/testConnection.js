import { pool, query } from "./client.js";

try {
  const result = await query(`
    SELECT 
      NOW() AS current_time,
      current_database() AS database_name;
  `);

  console.log("PostgreSQL connected successfully.");
  console.log(result.rows[0]);
} catch (error) {
  console.error("PostgreSQL connection failed.");
  console.error(error.message);
  process.exit(1);
} finally {
  await pool.end();
}
