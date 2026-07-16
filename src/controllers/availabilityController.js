import { pool, query } from "../db/client.js";
import {
  isPlainObject,
  isValidDate,
  isValidTime,
  parsePositiveInteger,
} from "../utils/validation.js";

const getUserId = (req) => {
  return req.user.id || req.user.userId;
};

function normalizeDateValue(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();

    const month = String(
      value.getMonth() + 1,
    ).padStart(2, "0");

    const day = String(
      value.getDate(),
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  return String(value || "").slice(0, 10);
}

function isEndAfterStart(
  startTime,
  endTime,
) {
  return endTime > startTime;
}

function isAvailabilityConflict(error) {
  return (
    error.code === "23505" ||
    error.code === "23P01"
  );
}

function validateAvailabilityFields(
  { date, startTime, endTime },
  requireAll = true,
) {
  if (
    requireAll &&
    (!date || !startTime || !endTime)
  ) {
    return (
      "date, startTime, and endTime " +
      "are required"
    );
  }

  if (
    !requireAll &&
    date === undefined &&
    startTime === undefined &&
    endTime === undefined
  ) {
    return (
      "At least one of date, startTime, " +
      "or endTime is required"
    );
  }

  if (
    date !== undefined &&
    !isValidDate(date)
  ) {
    return "date must use YYYY-MM-DD format";
  }

  if (
    startTime !== undefined &&
    !isValidTime(startTime)
  ) {
    return "startTime must use HH:MM format";
  }

  if (
    endTime !== undefined &&
    !isValidTime(endTime)
  ) {
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

async function getAvailabilityTimingError(
  client,
  date,
  startTime,
) {
  const result = await client.query(
    `
    SELECT
      $1::date < CURRENT_DATE AS "isPastDate",
      (
        $1::date = CURRENT_DATE
        AND $2::time <= LOCALTIME
      ) AS "isPastStartTime";
    `,
    [date, startTime],
  );

  const timing = result.rows[0];

  if (timing.isPastDate) {
    return "date cannot be in the past";
  }

  if (timing.isPastStartTime) {
    return "startTime cannot be in the past";
  }

  return null;
}

async function findOverlappingAvailability(
  client,
  {
    sitterId,
    date,
    startTime,
    endTime,
    excludeId = null,
  },
) {
  const result = await client.query(
    `
    SELECT id
    FROM availability
    WHERE sitter_id = $1
      AND date = $2
      AND (
        $5::integer IS NULL
        OR id <> $5::integer
      )
      AND start_time < $4::time
      AND end_time > $3::time
    LIMIT 1;
    `,
    [
      sitterId,
      date,
      startTime,
      endTime,
      excludeId,
    ],
  );

  return result.rows[0] || null;
}

async function hasAttachedBooking(
  client,
  availabilityId,
) {
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

export const getSitterAvailability = async (
  req,
  res,
  next,
) => {
  try {
    const sitterId =
      parsePositiveInteger(req.params.id);

    if (!sitterId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

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
        AND EXISTS (
          SELECT 1
          FROM users
          WHERE users.id =
            availability.sitter_id
            AND users.role = 'sitter'
            AND users.is_active = true
        )
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
      [sitterId],
    );

    res.json({
      availability: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const createAvailability = async (
  req,
  res,
  next,
) => {
  const client = await pool.connect();

  try {
    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error:
          "Request body must be a JSON object",
      });
    }

    const sitterId = getUserId(req);

    const {
      date,
      startTime,
      endTime,
    } = req.body;

    const validationError =
      validateAvailabilityFields(
        {
          date,
          startTime,
          endTime,
        },
        true,
      );

    if (validationError) {
      return res.status(400).json({
        error: validationError,
      });
    }

    await client.query("BEGIN");

    const timingError =
      await getAvailabilityTimingError(
        client,
        date,
        startTime,
      );

    if (timingError) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: timingError,
      });
    }

    const overlappingAvailability =
      await findOverlappingAvailability(
        client,
        {
          sitterId,
          date,
          startTime,
          endTime,
        },
      );

    if (overlappingAvailability) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Availability slot overlaps an existing slot",
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
      [
        sitterId,
        date,
        startTime,
        endTime,
      ],
    );

    await client.query("COMMIT");

    res.status(201).json({
      availability: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (isAvailabilityConflict(error)) {
      return res.status(409).json({
        error:
          "Availability slot overlaps an existing slot",
      });
    }

    next(error);
  } finally {
    client.release();
  }
};

export const updateAvailability = async (
  req,
  res,
  next,
) => {
  const client = await pool.connect();

  try {
    const sitterId = getUserId(req);

    const availabilityId =
      parsePositiveInteger(req.params.id);

    if (!availabilityId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error:
          "Request body must be a JSON object",
      });
    }

    const {
      date,
      startTime,
      endTime,
    } = req.body;

    const validationError =
      validateAvailabilityFields(
        {
          date,
          startTime,
          endTime,
        },
        false,
      );

    if (validationError) {
      return res.status(400).json({
        error: validationError,
      });
    }

    await client.query("BEGIN");

    const existingResult =
      await client.query(
        `
        SELECT
          id,
          TO_CHAR(
            date,
            'YYYY-MM-DD'
          ) AS date,
          start_time AS "startTime",
          end_time AS "endTime"
        FROM availability
        WHERE id = $1
          AND sitter_id = $2
        FOR UPDATE;
        `,
        [availabilityId, sitterId],
      );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Availability slot not found",
      });
    }

    if (
      await hasAttachedBooking(
        client,
        availabilityId,
      )
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Availability slot is attached to a booking and cannot be changed",
      });
    }

    const existing =
      existingResult.rows[0];

    const nextFields = {
      date:
        date ??
        normalizeDateValue(existing.date),
      startTime:
        startTime ?? existing.startTime,
      endTime:
        endTime ?? existing.endTime,
    };

    if (
      !isEndAfterStart(
        nextFields.startTime,
        nextFields.endTime,
      )
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          "endTime must be after startTime",
      });
    }

    const timingError =
      await getAvailabilityTimingError(
        client,
        nextFields.date,
        nextFields.startTime,
      );

    if (timingError) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: timingError,
      });
    }

    const overlappingAvailability =
      await findOverlappingAvailability(
        client,
        {
          sitterId,
          date: nextFields.date,
          startTime:
            nextFields.startTime,
          endTime: nextFields.endTime,
          excludeId: availabilityId,
        },
      );

    if (overlappingAvailability) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Availability slot overlaps an existing slot",
      });
    }

    const result = await client.query(
      `
      UPDATE availability
      SET
        date = $1,
        start_time = $2,
        end_time = $3
      WHERE id = $4
        AND sitter_id = $5
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
        availabilityId,
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
        error:
          "Availability slot overlaps an existing slot",
      });
    }

    next(error);
  } finally {
    client.release();
  }
};

export const deleteAvailability = async (
  req,
  res,
  next,
) => {
  const client = await pool.connect();

  try {
    const sitterId = getUserId(req);

    const availabilityId =
      parsePositiveInteger(req.params.id);

    if (!availabilityId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

    await client.query("BEGIN");

    const existingResult =
      await client.query(
        `
        SELECT id
        FROM availability
        WHERE id = $1
          AND sitter_id = $2
        FOR UPDATE;
        `,
        [availabilityId, sitterId],
      );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Availability slot not found",
      });
    }

    if (
      await hasAttachedBooking(
        client,
        availabilityId,
      )
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Availability slot is attached to a booking and cannot be deleted",
      });
    }

    await client.query(
      `
      DELETE FROM availability
      WHERE id = $1
        AND sitter_id = $2;
      `,
      [availabilityId, sitterId],
    );

    await client.query("COMMIT");

    res.json({
      message:
        "Availability deleted successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};