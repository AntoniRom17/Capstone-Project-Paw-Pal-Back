import { pool, query } from "../db/client.js";
import {
  isPlainObject,
  parsePositiveInteger,
} from "../utils/validation.js";

const VALID_STATUS_UPDATES = new Set([
  "accepted",
  "declined",
  "cancelled",
  "completed",
]);

function mapBooking(row) {
  return {
    id: row.id,
    ownerId: row.ownerId,
    sitterId: row.sitterId,
    petId: row.petId,
    sitterServiceId: row.sitterServiceId,
    availabilityId: row.availabilityId,
    status: row.status,
    cancelledByRole: row.cancelledByRole,
    totalPrice: row.totalPrice,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    petName: row.petName,
    ownerName: row.ownerName,
    sitterName: row.sitterName,
    serviceName: row.serviceName,
  };
}

function shouldAvailabilityBeBooked(status) {
  return [
    "pending",
    "accepted",
    "completed",
  ].includes(status);
}

export async function createBooking(
  req,
  res,
  next,
) {
  const client = await pool.connect();

  try {
    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error:
          "Request body must be a JSON object",
      });
    }

    const {
      sitterId,
      petId,
      sitterServiceId,
      availabilityId,
    } = req.body;

    if (
      sitterId === undefined ||
      petId === undefined ||
      sitterServiceId === undefined ||
      availabilityId === undefined
    ) {
      return res.status(400).json({
        error:
          "sitterId, petId, sitterServiceId, and availabilityId are required",
      });
    }

    const numericSitterId =
      parsePositiveInteger(sitterId);

    const numericPetId =
      parsePositiveInteger(petId);

    const numericSitterServiceId =
      parsePositiveInteger(
        sitterServiceId,
      );

    const numericAvailabilityId =
      parsePositiveInteger(
        availabilityId,
      );

    if (!numericSitterId) {
      return res.status(400).json({
        error:
          "sitterId must be a positive integer",
      });
    }

    if (!numericPetId) {
      return res.status(400).json({
        error:
          "petId must be a positive integer",
      });
    }

    if (!numericSitterServiceId) {
      return res.status(400).json({
        error:
          "sitterServiceId must be a positive integer",
      });
    }

    if (!numericAvailabilityId) {
      return res.status(400).json({
        error:
          "availabilityId must be a positive integer",
      });
    }

    await client.query("BEGIN");

    const { rows: sitterRows } =
      await client.query(
        `
        SELECT id
        FROM users
        WHERE id = $1
          AND role = 'sitter'
          AND is_active = true
        FOR SHARE;
        `,
        [numericSitterId],
      );

    if (!sitterRows[0]) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Sitter not found",
      });
    }

    const { rows: petRows } =
      await client.query(
        `
        SELECT id
        FROM pets
        WHERE id = $1
          AND owner_id = $2;
        `,
        [
          numericPetId,
          req.user.id,
        ],
      );

    if (!petRows[0]) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error:
          "That pet does not belong to you",
      });
    }

    const { rows: slotRows } =
      await client.query(
        `
        SELECT
          id,
          date,
          start_time,
          end_time,
          is_booked,
          (
            date < CURRENT_DATE
            OR (
              date = CURRENT_DATE
              AND start_time <= LOCALTIME
            )
          ) AS "isExpired"
        FROM availability
        WHERE id = $1
          AND sitter_id = $2
        FOR UPDATE;
        `,
        [
          numericAvailabilityId,
          numericSitterId,
        ],
      );

    const slot = slotRows[0];

    if (!slot) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error:
          "Availability slot not found for that sitter",
      });
    }

    if (slot.is_booked) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          "That slot is already booked",
      });
    }

    if (slot.isExpired) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          "Availability slot has expired",
      });
    }

    const { rows: serviceRows } =
      await client.query(
        `
        SELECT
          ss.id AS "sitterServiceId",
          COALESCE(
            ss.price_override,
            s.base_price
          ) AS price
        FROM sitter_services ss
        JOIN services s
          ON s.id = ss.service_id
        WHERE ss.id = $1
          AND ss.sitter_id = $2;
        `,
        [
          numericSitterServiceId,
          numericSitterId,
        ],
      );

    const sitterService = serviceRows[0];

    if (!sitterService) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error:
          "Sitter service not found for that sitter",
      });
    }

    const { rows } = await client.query(
      `
      INSERT INTO bookings (
        owner_id,
        sitter_id,
        pet_id,
        sitter_service_id,
        availability_id,
        date,
        start_time,
        end_time,
        status,
        total_price
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        'pending',
        $9
      )
      RETURNING
        id,
        owner_id AS "ownerId",
        sitter_id AS "sitterId",
        pet_id AS "petId",
        sitter_service_id
          AS "sitterServiceId",
        availability_id
          AS "availabilityId",
        status,
        total_price AS "totalPrice",
        date,
        start_time AS "startTime",
        end_time AS "endTime";
      `,
      [
        req.user.id,
        numericSitterId,
        numericPetId,
        numericSitterServiceId,
        numericAvailabilityId,
        slot.date,
        slot.start_time,
        slot.end_time,
        sitterService.price,
      ],
    );

    await client.query(
      `
      UPDATE availability
      SET is_booked = true
      WHERE id = $1;
      `,
      [numericAvailabilityId],
    );

    await client.query("COMMIT");

    res.status(201).json({
      booking: mapBooking(rows[0]),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

export async function getBookings(
  req,
  res,
  next,
) {
  try {
    const column =
      req.user.role === "sitter"
        ? "b.sitter_id"
        : "b.owner_id";

    const { rows } = await query(
      `
      SELECT
        b.id,
        b.owner_id AS "ownerId",
        b.sitter_id AS "sitterId",
        b.pet_id AS "petId",
        b.sitter_service_id
          AS "sitterServiceId",
        b.availability_id
          AS "availabilityId",
        b.date,
        b.start_time AS "startTime",
        b.end_time AS "endTime",
        b.status,
        b.cancelled_by_role AS "cancelledByRole",
        b.total_price AS "totalPrice",
        p.name AS "petName",
        o.name AS "ownerName",
        si.name AS "sitterName",
        s.name AS "serviceName"
      FROM bookings b
      JOIN pets p
        ON p.id = b.pet_id
      JOIN users o
        ON o.id = b.owner_id
      JOIN users si
        ON si.id = b.sitter_id
      JOIN sitter_services ss
        ON ss.id = b.sitter_service_id
      JOIN services s
        ON s.id = ss.service_id
      WHERE ${column} = $1
      ORDER BY
        b.date DESC,
        b.start_time DESC;
      `,
      [req.user.id],
    );

    res.status(200).json({
      bookings: rows.map(mapBooking),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateBookingStatus(
  req,
  res,
  next,
) {
  const client = await pool.connect();

  try {
    const bookingId =
      parsePositiveInteger(req.params.id);

    if (!bookingId) {
      return res.status(400).json({
        error:
          "id must be a positive integer",
      });
    }

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error:
          "Request body must be a JSON object",
      });
    }

    const { status } = req.body;

    if (
      typeof status !== "string" ||
      !VALID_STATUS_UPDATES.has(
        status.trim().toLowerCase(),
      )
    ) {
      return res.status(400).json({
        error:
          "status must be one of: accepted, declined, cancelled, completed",
      });
    }

    const normalizedStatus = status
      .trim()
      .toLowerCase();

    await client.query("BEGIN");

    const { rows: bookingRows } =
      await client.query(
        `
        SELECT
          b.*,
          (
            b.date < CURRENT_DATE
            OR (
              b.date = CURRENT_DATE
              AND b.end_time <= LOCALTIME
            )
          ) AS "hasEnded"
        FROM bookings b
        WHERE b.id = $1
        FOR UPDATE;
        `,
        [bookingId],
      );

    const booking = bookingRows[0];

    if (!booking) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Booking not found",
      });
    }

    const isSitter =
      req.user.id === booking.sitter_id;

    const isOwner =
      req.user.id === booking.owner_id;

    const sitterMoves = [
      "accepted",
      "declined",
      "completed",
      "cancelled",
    ];

    const ownerMoves = ["cancelled"];

    if (
      !(
        isSitter &&
        sitterMoves.includes(
          normalizedStatus,
        )
      ) &&
      !(
        isOwner &&
        ownerMoves.includes(
          normalizedStatus,
        )
      )
    ) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error:
          "You cannot set that status on this booking",
      });
    }

    const allowedTransitions = {
      pending: [
        "accepted",
        "declined",
        "cancelled",
      ],
      accepted: [
        "completed",
        "cancelled",
      ],
    };

    const legalNext =
      allowedTransitions[booking.status] || [];

    if (
      !legalNext.includes(
        normalizedStatus,
      )
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          `Cannot go from '${booking.status}' ` +
          `to '${normalizedStatus}'`,
      });
    }

    if (
      normalizedStatus === "completed" &&
      !booking.hasEnded
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          "Booking cannot be completed before its scheduled end time",
      });
    }

    await client.query(
      `
      SELECT id
      FROM availability
      WHERE id = $1
      FOR UPDATE;
      `,
      [booking.availability_id],
    );

    const cancelledByRole =
      normalizedStatus === "cancelled"
        ? req.user.role
        : null;

    const { rows } = await client.query(
      `
      UPDATE bookings
      SET
        status = $1,
        cancelled_by_role = $2
      WHERE id = $3
      RETURNING
        id,
        owner_id AS "ownerId",
        sitter_id AS "sitterId",
        pet_id AS "petId",
        sitter_service_id
          AS "sitterServiceId",
        availability_id
          AS "availabilityId",
        status,
        cancelled_by_role AS "cancelledByRole",
        total_price AS "totalPrice",
        date,
        start_time AS "startTime",
        end_time AS "endTime";
      `,
      [
        normalizedStatus,
        cancelledByRole,
        bookingId,
      ],
    );

    await client.query(
      `
      UPDATE availability
      SET is_booked = $1
      WHERE id = $2;
      `,
      [
        shouldAvailabilityBeBooked(
          normalizedStatus,
        ),
        booking.availability_id,
      ],
    );

    await client.query("COMMIT");

    res.status(200).json({
      booking: mapBooking(rows[0]),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

export async function getBackupSitters(
  req,
  res,
  next,
) {
  try {
    const bookingId = parsePositiveInteger(
      req.params.id,
    );

    if (!bookingId) {
      return res.status(400).json({
        error:
          "id must be a positive integer",
      });
    }

    const { rows: bookingRows } = await query(
      `
      SELECT
        b.owner_id AS "ownerId",
        b.sitter_id AS "sitterId",
        b.status,
        b.cancelled_by_role
          AS "cancelledByRole",
        b.date,
        b.start_time AS "startTime",
        b.end_time AS "endTime",
        ss.service_id AS "serviceId"
      FROM bookings b
      JOIN sitter_services ss
        ON ss.id = b.sitter_service_id
      WHERE b.id = $1;
      `,
      [bookingId],
    );

    const booking = bookingRows[0];

    if (!booking) {
      return res.status(404).json({
        error: "Booking not found",
      });
    }

    if (booking.ownerId !== req.user.id) {
      return res.status(403).json({
        error:
          "This booking does not belong to you",
      });
    }

    if (
      booking.status !== "cancelled" ||
      booking.cancelledByRole !== "sitter"
    ) {
      return res.status(400).json({
        error:
          "Backup sitters are only available after a sitter cancels a confirmed booking",
      });
    }

    const { rows } = await query(
      `
      SELECT
        u.id,
        u.name,
        u.bio,
        u.city,
        u.state,
        COALESCE(u.trust_score, 0)
          AS "trustScore",
        COALESCE(
          (
            SELECT ROUND(
              AVG(reviews.rating)::numeric,
              1
            )::float
            FROM bookings booking_history
            JOIN reviews
              ON reviews.booking_id =
                booking_history.id
            WHERE booking_history.sitter_id =
              u.id
          ),
          0
        ) AS "averageRating",
        sitter_service.id
          AS "sitterServiceId",
        COALESCE(
          sitter_service.price_override,
          service.base_price
        )::float AS price,
        availability.id
          AS "availabilityId",
        availability.date,
        availability.start_time
          AS "startTime",
        availability.end_time
          AS "endTime"
      FROM users u
      JOIN sitter_services sitter_service
        ON sitter_service.sitter_id = u.id
        AND sitter_service.service_id = $1
      JOIN services service
        ON service.id =
          sitter_service.service_id
      JOIN availability
        ON availability.sitter_id = u.id
        AND availability.date = $2
        AND availability.start_time = $3
        AND availability.end_time = $4
        AND availability.is_booked = false
      WHERE u.role = 'sitter'
        AND u.is_active = true
        AND u.id != $5
      ORDER BY
        "trustScore" DESC,
        "averageRating" DESC;
      `,
      [
        booking.serviceId,
        booking.date,
        booking.startTime,
        booking.endTime,
        booking.sitterId,
      ],
    );

    res.status(200).json({
      backupSitters: rows,
    });
  } catch (error) {
    next(error);
  }
}