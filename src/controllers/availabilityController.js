import { query } from "../db/client.js";

const getUserId = (req) => {
  return req.user.id || req.user.userId;
};

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPastDate(value) {
  const today = new Date();
  const todayString = today.toISOString().slice(0, 10);
  return value < todayString;
}

function isValidTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isEndAfterStart(startTime, endTime) {
  return endTime > startTime;
}

function validateAvailabilityFields({ date, startTime, endTime }, requireAll = true) {
  if (requireAll && (!date || !startTime || !endTime)) {
    return "date, startTime, and endTime are required";
  }

  if (!requireAll && date === undefined && startTime === undefined && endTime === undefined) {
    return "At least one of date, startTime, or endTime is required";
  }

  if (date !== undefined) {
    if (!isValidDate(date)) {
      return "date must use YYYY-MM-DD format";
    }

    if (isPastDate(date)) {
      return "date cannot be in the past";
    }
  }

  if (startTime !== undefined && !isValidTime(startTime)) {
    return "startTime must use HH:MM format";
  }

  if (endTime !== undefined && !isValidTime(endTime)) {
    return "endTime must use HH:MM format";
  }

  if (startTime !== undefined && endTime !== undefined && !isEndAfterStart(startTime, endTime)) {
    return "endTime must be after startTime";
  }

  return null;
}

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
        AND date >= CURRENT_DATE
        AND is_booked = false
      ORDER BY date ASC, start_time ASC;
      `,
      [id],
    );

    res.json({
      availability: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const createAvailability = async (req, res, next) => {
  try {
    const sitterId = getUserId(req);
    const { date, startTime, endTime } = req.body;

    const validationError = validateAvailabilityFields(
      { date, startTime, endTime },
      true,
    );

    if (validationError) {
      return res.status(400).json({
        error: validationError,
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
      [sitterId, date, startTime, endTime],
    );

    res.status(201).json({
      availability: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Availability slot already exists",
      });
    }

    next(error);
  }
};

export const updateAvailability = async (req, res, next) => {
  try {
    const sitterId = getUserId(req);
    const { id } = req.params;
    const { date, startTime, endTime } = req.body;

    const existingResult = await query(
      `
      SELECT
        date,
        start_time AS "startTime",
        end_time AS "endTime"
      FROM availability
      WHERE id = $1 AND sitter_id = $2;
      `,
      [id, sitterId],
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: "Availability slot not found",
      });
    }

    const existing = existingResult.rows[0];

    const nextFields = {
      date: date ?? existing.date,
      startTime: startTime ?? existing.startTime,
      endTime: endTime ?? existing.endTime,
    };

    const validationError = validateAvailabilityFields(
      { date, startTime, endTime },
      false,
    );

    if (validationError) {
      return res.status(400).json({
        error: validationError,
      });
    }

    if (!isEndAfterStart(nextFields.startTime, nextFields.endTime)) {
      return res.status(400).json({
        error: "endTime must be after startTime",
      });
    }

    if (isPastDate(nextFields.date)) {
      return res.status(400).json({
        error: "date cannot be in the past",
      });
    }

    const result = await query(
      `
      UPDATE availability
      SET
        date = $1,
        start_time = $2,
        end_time = $3
      WHERE id = $4 AND sitter_id = $5
      RETURNING
        id,
        sitter_id AS "sitterId",
        date,
        start_time AS "startTime",
        end_time AS "endTime",
        is_booked AS "isBooked";
      `,
      [nextFields.date, nextFields.startTime, nextFields.endTime, id, sitterId],
    );

    res.json({
      availability: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Availability slot already exists",
      });
    }

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
      [id, sitterId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Availability slot not found",
      });
    }

    res.json({
      message: "Availability deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};