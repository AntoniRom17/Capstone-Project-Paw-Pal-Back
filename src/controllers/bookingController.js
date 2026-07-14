import { pool, query } from "../db/client.js";

function mapBooking(row) {
  return {
    id: row.id,
    ownerId: row.ownerId,
    sitterId: row.sitterId,
    petId: row.petId,
    sitterServiceId: row.sitterServiceId,
    availabilityId: row.availabilityId,
    status: row.status,
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
  return ["pending", "accepted", "completed"].includes(status);
}

// POST /api/bookings - owner requests a booking from an availability slot
export async function createBooking(req, res, next) {
  const client = await pool.connect();

  try {
    const { sitterId, petId, sitterServiceId, availabilityId } = req.body;

    if (!sitterId || !petId || !sitterServiceId || !availabilityId) {
      return res.status(400).json({
        error:
          "sitterId, petId, sitterServiceId, and availabilityId are required",
      });
    }

    await client.query("BEGIN");

    const { rows: petRows } = await client.query(
      `SELECT id FROM pets WHERE id = $1 AND owner_id = $2`,
      [petId, req.user.id],
    );

    if (!petRows[0]) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "That pet does not belong to you" });
    }

    const { rows: slotRows } = await client.query(
      `SELECT id, date, start_time, end_time, is_booked
       FROM availability
       WHERE id = $1 AND sitter_id = $2
       FOR UPDATE`,
      [availabilityId, sitterId],
    );

    const slot = slotRows[0];

    if (!slot) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Availability slot not found for that sitter",
      });
    }

    if (slot.is_booked) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "That slot is already booked" });
    }

    const { rows: serviceRows } = await client.query(
      `SELECT
         ss.id AS "sitterServiceId",
         COALESCE(ss.price_override, s.base_price) AS price
       FROM sitter_services ss
       JOIN services s ON s.id = ss.service_id
       WHERE ss.id = $1 AND ss.sitter_id = $2`,
      [sitterServiceId, sitterId],
    );

    const sitterService = serviceRows[0];

    if (!sitterService) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Sitter service not found for that sitter",
      });
    }

    const { rows } = await client.query(
      `INSERT INTO bookings (
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
       RETURNING
         id,
         owner_id AS "ownerId",
         sitter_id AS "sitterId",
         pet_id AS "petId",
         sitter_service_id AS "sitterServiceId",
         availability_id AS "availabilityId",
         status,
         total_price AS "totalPrice",
         date,
         start_time AS "startTime",
         end_time AS "endTime"`,
      [
        req.user.id,
        sitterId,
        petId,
        sitterServiceId,
        availabilityId,
        slot.date,
        slot.start_time,
        slot.end_time,
        sitterService.price,
      ],
    );

    await client.query(`UPDATE availability SET is_booked = true WHERE id = $1`, [
      availabilityId,
    ]);

    await client.query("COMMIT");

    res.status(201).json({
      booking: mapBooking(rows[0]),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

// GET /api/bookings - owners see bookings they made, sitters see requests for them
export async function getBookings(req, res, next) {
  try {
    const column = req.user.role === "sitter" ? "b.sitter_id" : "b.owner_id";

    const { rows } = await query(
      `SELECT
         b.id,
         b.owner_id AS "ownerId",
         b.sitter_id AS "sitterId",
         b.pet_id AS "petId",
         b.sitter_service_id AS "sitterServiceId",
         b.availability_id AS "availabilityId",
         b.date,
         b.start_time AS "startTime",
         b.end_time AS "endTime",
         b.status,
         b.total_price AS "totalPrice",
         p.name AS "petName",
         o.name AS "ownerName",
         si.name AS "sitterName",
         s.name AS "serviceName"
       FROM bookings b
       JOIN pets p ON p.id = b.pet_id
       JOIN users o ON o.id = b.owner_id
       JOIN users si ON si.id = b.sitter_id
       JOIN sitter_services ss ON ss.id = b.sitter_service_id
       JOIN services s ON s.id = ss.service_id
       WHERE ${column} = $1
       ORDER BY b.date DESC, b.start_time DESC`,
      [req.user.id],
    );

    res.status(200).json({
      bookings: rows.map(mapBooking),
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/bookings/:id/status - the state machine
export async function updateBookingStatus(req, res, next) {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { status } = req.body;

    await client.query("BEGIN");

    const { rows: bookingRows } = await client.query(
      `SELECT * FROM bookings WHERE id = $1 FOR UPDATE`,
      [id],
    );

    const booking = bookingRows[0];

    if (!booking) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Booking not found" });
    }

    const isSitter = req.user.id === booking.sitter_id;
    const isOwner = req.user.id === booking.owner_id;
    const sitterMoves = ["accepted", "declined", "completed"];
    const ownerMoves = ["cancelled"];

    if (
      !(isSitter && sitterMoves.includes(status)) &&
      !(isOwner && ownerMoves.includes(status))
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "You cannot set that status on this booking",
      });
    }

    const allowedTransitions = {
      pending: ["accepted", "declined", "cancelled"],
      accepted: ["completed", "cancelled"],
    };

    const legalNext = allowedTransitions[booking.status] || [];

    if (!legalNext.includes(status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Cannot go from '${booking.status}' to '${status}'`,
      });
    }

    await client.query(`SELECT id FROM availability WHERE id = $1 FOR UPDATE`, [
      booking.availability_id,
    ]);

    const { rows } = await client.query(
      `UPDATE bookings
       SET status = $1
       WHERE id = $2
       RETURNING
         id,
         owner_id AS "ownerId",
         sitter_id AS "sitterId",
         pet_id AS "petId",
         sitter_service_id AS "sitterServiceId",
         availability_id AS "availabilityId",
         status,
         total_price AS "totalPrice",
         date,
         start_time AS "startTime",
         end_time AS "endTime"`,
      [status, id],
    );

    await client.query(
      `UPDATE availability
       SET is_booked = $1
       WHERE id = $2`,
      [shouldAvailabilityBeBooked(status), booking.availability_id],
    );

    await client.query("COMMIT");

    res.status(200).json({
      booking: mapBooking(rows[0]),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}