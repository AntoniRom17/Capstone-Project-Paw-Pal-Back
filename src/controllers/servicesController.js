import { query } from "../db/client.js";

export const getServices = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        id,
        name,
        description,
        base_price AS "basePrice"
      FROM services
      ORDER BY name;
    `);

    res.json({
      services: result.rows
    });
  } catch (error) {
    next(error);
  }
};