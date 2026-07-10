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

export const createAvailability = async (req, res, next) => {
  try {
    const sitterId = getUserId(req);
    const { date, startTime, endTime } = req.body;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({
        error: "date, startTime, and endTime are required"
      });
    }

    const result = await query(
      `
      INSERT INTO availability (
        sitter_id,
        date,
        start_time,
        end_time,
        is_booked
      )
      VALUES ($1, $2, $3, $4, false)
      RETURNING
        id,
        sitter_id AS "sitterId",
        date,
        start_time AS "startTime",
        end_time AS "endTime",
        is_booked AS "isBooked";
      `,
      [sitterId, date, startTime, endTime]
    );

    res.status(201).json({
      availability: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};