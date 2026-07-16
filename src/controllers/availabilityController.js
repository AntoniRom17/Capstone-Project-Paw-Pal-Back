import { pool, query } from "../db/client.js";

const getUserId = (req) => {
  return req.user.id || req.user.userId;
};

function normalizeDateValue(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value || "").slice(0, 10);
}

function isValidDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentTimeString() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

function isPastDate(value) {
  return normalizeDateValue(value) < getTodayString();
}

function isPastDateTime(date, startTime) {
  const normalizedDate = normalizeDateValue(date);

  if (normalizedDate < getTodayString()) {
    return true;
  }

  if (normalizedDate > getTodayString()) {
    return false;
  }

  return startTime <= getCurrentTimeString();
}

function isValidTime(value) {
  return (
    typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  );
}

function isEndAfterStart(startTime, endTime) {
  return endTime > startTime;
}

function isAvailabilityConflict(error) {
  return error.code === "23505" || error.code === "23P01";
}

function validateAvailabilityFields(
  { date, startTime, endTime },
  requireAll = true,
) {
  if (requireAll && (!date || !startTime || !endTime)) {
    return "date, startTime, and endTime are required";
  }

  if (
    !requireAll &&
    date === undefined &&
    startTime === undefined &&
    endTime === undefined
  ) {
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

  if (
    startTime !== undefined &&
    endTime !== undefined &&
    !isEndAfterStart(startTime, endTime)
  ) {
    return "endTime must be after startTime";
  }

  return null;
}

async function findOverlappingAvailability(
  client,
  { sitterId, date, startTime, endTime, excludeId = null },
) {
  const result = await client.query(
    `
    SELECT id
    FROM availability
    WHERE sitter_id = $1
      AND date = $2
      AND ($5::integer IS NULL OR id <> $5::integer)
      AND start_time < $4::time
      AND end_time > $3::time
    LIMIT 1;
    `,
    [sitterId, date, startTime, endTime, excludeId],
  );

  return result.rows[0] || null;
}

async function hasAttachedBooking(client, availabilityId) {
  const result = await client.query(
    `
    SELECT id
    FROM bookings
    WHERE availability_id = $1
    LIMIT 1;
    `,
    [availabilityId],
  );

  return Boolean(result.rows[0]);
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
        AND (
          date > CURRENT_DATE
          OR (
            date = CURRENT_DATE
            AND start_time > LOCALTIME
          )
        )
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
  const client = await pool.connect();

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

    if (isPastDateTime(date, startTime)) {
      return res.status(400).json({
        error: "startTime cannot be in the past",
      });
    }

    await client.query("BEGIN");

    const overlappingAvailability =
      await findOverlappingAvailability(client, {
        sitterId,
        date,
        startTime,
        endTime,
      });

    if (overlappingAvailability) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Availability slot overlaps an existing slot",
      });
    }

    const result = await client.query(
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

    await client.query("COMMIT");

    res.status(201).json({
      availability: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (isAvailabilityConflict(error)) {
      return res.status(409).json({
        error: "Availability slot overlaps an existing slot",
      });
    }

    next(error);
  } finally {
    client.release();
  }
};

export const updateAvailability = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const sitterId = getUserId(req);
    const { id } = req.params;
    const { date, startTime, endTime } = req.body;

    const validationError = validateAvailabilityFields(
      { date, startTime, endTime },
      false,
    );

    if (validationError) {
      return res.status(400).json({
        error: validationError,
      });
    }

    await client.query("BEGIN");

    const existingResult = await client.query(
      `
      SELECT
        id,
        date,
        start_time AS "startTime",
        end_time AS "endTime"
      FROM availability
      WHERE id = $1 AND sitter_id = $2
      FOR UPDATE;
      `,
      [id, sitterId],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Availability slot not found",
      });
    }

    if (await hasAttachedBooking(client, id)) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Availability slot is attached to a booking and cannot be changed",
      });
    }

    const existing = existingResult.rows[0];

    const nextFields = {
      date: date ?? normalizeDateValue(existing.date),
      startTime: startTime ?? existing.startTime,
      endTime: endTime ?? existing.endTime,
    };

    if (!isEndAfterStart(nextFields.startTime, nextFields.endTime)) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "endTime must be after startTime",
      });
    }

    if (isPastDate(nextFields.date)) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "date cannot be in the past",
      });
    }

    if (isPastDateTime(nextFields.date, nextFields.startTime)) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "startTime cannot be in the past",
      });
    }

    const overlappingAvailability =
      await findOverlappingAvailability(client, {
        sitterId,
        date: nextFields.date,
        startTime: nextFields.startTime,
        endTime: nextFields.endTime,
        excludeId: Number(id),
      });

    if (overlappingAvailability) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Availability slot overlaps an existing slot",
      });
    }

    const result = await client.query(
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
      [
        nextFields.date,
        nextFields.startTime,
        nextFields.endTime,
        id,
        sitterId,
      ],
    );

    await client.query("COMMIT");

    res.json({
      availability: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (isAvailabilityConflict(error)) {
      return res.status(409).json({
        error: "Availability slot overlaps an existing slot",
      });
    }

    next(error);
  } finally {
    client.release();
  }
};

export const deleteAvailability = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const sitterId = getUserId(req);
    const { id } = req.params;

    await client.query("BEGIN");

    const existingResult = await client.query(
      `
      SELECT id
      FROM availability
      WHERE id = $1 AND sitter_id = $2
      FOR UPDATE;
      `,
      [id, sitterId],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Availability slot not found",
      });
    }

    if (await hasAttachedBooking(client, id)) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Availability slot is attached to a booking and cannot be deleted",
      });
    }

    await client.query(
      `
      DELETE FROM availability
      WHERE id = $1 AND sitter_id = $2;
      `,
      [id, sitterId],
    );

    await client.query("COMMIT");

    res.json({
      message: "Availability deleted successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};