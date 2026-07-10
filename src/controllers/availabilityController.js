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

export const updateAvailability = async (req, res, next) => {
  try {
    const sitterId = getUserId(req);
    const { id } = req.params;
    const { date, startTime, endTime } = req.body;

    const result = await query(
      `
      UPDATE availability
      SET
        date = COALESCE($1, date),
        start_time = COALESCE($2, start_time),
        end_time = COALESCE($3, end_time)
      WHERE id = $4 AND sitter_id = $5
      RETURNING
        id,
        sitter_id AS "sitterId",
        date,
        start_time AS "startTime",
        end_time AS "endTime",
        is_booked AS "isBooked";
      `,
      [date, startTime, endTime, id, sitterId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Availability slot not found"
      });
    }

    res.json({
      availability: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

export const deleteAvailability = async (req, res, next) => {
  try {
    const sitterId = getUserId(req);
    const { id } = req.params;

    const result = await query(
      `
      DELETE FROM availability
      WHERE id = $1 AND sitter_id = $2
      RETURNING id;
      `,
      [id, sitterId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Availability slot not found"
      });
    }

    res.json({
      message: "Availability deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};