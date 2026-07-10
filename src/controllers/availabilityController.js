import { query } from "../db/client.js";

const getUserId = (req) => {
  return req.user.id || req.user.userId;
};

export const getSitterAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT
        id,
        sitter_id AS "sitterId",
        date,
        start_time AS "startTime",
        end_time AS "endTime",
        is_booked AS "isBooked"
      FROM availability
      WHERE sitter_id = $1
      ORDER BY date ASC, start_time ASC;
      `,
      [id]
    );

    res.json({
      availability: result.rows
    });
  } catch (error) {
    next(error);
  }
};