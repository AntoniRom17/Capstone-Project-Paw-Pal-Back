import { query } from "../db/client.js";

// POST /api/bookings — owner requests a booking from an availability slot
export async function createBooking(req, res, next) {
  try {
    const { sitterId, petId, serviceId, availabilityId } = req.body;

    if (!sitterId || !petId || !serviceId || !availabilityId) {
      return res
        .status(400)
        .json({
          error: "sitterId, petId, serviceId, and availabilityId are required",
        });
    }

    // The pet must belong to the person making the request
    const { rows: petRows } = await query(
      `SELECT id FROM pets WHERE id = $1 AND owner_id = $2`,
      [petId, req.user.id],
    );
    if (!petRows[0]) {
      return res.status(403).json({ error: "That pet does not belong to you" });
    }

    // The slot must belong to that sitter and still be open
    const { rows: slotRows } = await query(
      `SELECT id, date, start_time, end_time, is_booked
       FROM availability WHERE id = $1 AND sitter_id = $2`,
      [availabilityId, sitterId],
    );
    const slot = slotRows[0];
    if (!slot) {
      return res
        .status(404)
        .json({ error: "Availability slot not found for that sitter" });
    }
    if (slot.is_booked) {
      return res.status(400).json({ error: "That slot is already booked" });
    }

    // Price: sitter's override if they set one, otherwise the service base price
    const { rows: priceRows } = await query(
      `SELECT COALESCE(ss.price_override, s.base_price) AS price
       FROM services s
       LEFT JOIN sitter_services ss ON ss.service_id = s.id AND ss.sitter_id = $1
       WHERE s.id = $2`,
      [sitterId, serviceId],
    );
    if (!priceRows[0]) {
      return res.status(404).json({ error: "Service not found" });
    }
    const price = priceRows[0].price;

    // Create the booking and claim the slot
    const { rows } = await query(
      `INSERT INTO bookings (owner_id, sitter_id, pet_id, service_id, date, start_time, end_time, status, total_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       RETURNING *`,
      [
        req.user.id,
        sitterId,
        petId,
        serviceId,
        slot.date,
        slot.start_time,
        slot.end_time,
        price,
      ],
    );
    await query(`UPDATE availability SET is_booked = true WHERE id = $1`, [
      availabilityId,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// GET /api/bookings — owners see bookings they made, sitters see requests for them
export async function getBookings(req, res, next) {
  try {
    const column = req.user.role === "sitter" ? "b.sitter_id" : "b.owner_id";

    const { rows } = await query(
      `SELECT b.id, b.date, b.start_time, b.end_time, b.status, b.total_price,
              p.name AS pet_name,
              o.name AS owner_name,
              si.name AS sitter_name,
              s.name AS service_name
       FROM bookings b
       JOIN pets p ON p.id = b.pet_id
       JOIN users o ON o.id = b.owner_id
       JOIN users si ON si.id = b.sitter_id
       JOIN services s ON s.id = b.service_id
       WHERE ${column} = $1
       ORDER BY b.date DESC, b.start_time DESC`,
      [req.user.id],
    );

    res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
}

// PATCH /api/bookings/:id/status — the state machine
export async function updateBookingStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { rows: bookingRows } = await query(
      `SELECT * FROM bookings WHERE id = $1`,
      [id],
    );
    const booking = bookingRows[0];
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Who can move a booking to which status
    const isSitter = req.user.id === booking.sitter_id;
    const isOwner = req.user.id === booking.owner_id;
    const sitterMoves = ["accepted", "declined", "completed"];
    const ownerMoves = ["cancelled"];

    if (
      !(isSitter && sitterMoves.includes(status)) &&
      !(isOwner && ownerMoves.includes(status))
    ) {
      return res
        .status(403)
        .json({ error: "You cannot set that status on this booking" });
    }

    // Which statuses can move to which — everything else is an illegal jump
    const allowedTransitions = {
      pending: ["accepted", "declined", "cancelled"],
      accepted: ["completed", "cancelled"],
    };
    const legalNext = allowedTransitions[booking.status] || [];
    if (!legalNext.includes(status)) {
      return res
        .status(400)
        .json({ error: `Cannot go from '${booking.status}' to '${status}'` });
    }

    const { rows } = await query(
      `UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id],
    );

    res.status(200).json(rows[0]);
  } catch (err) {
    next(err);
  }
}
