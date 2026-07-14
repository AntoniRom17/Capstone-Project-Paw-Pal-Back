import { pool, query } from "../db/client.js";

function getUserId(req) {
  return req.user.id || req.user.userId;
}

function parsePositiveInteger(value) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
}

async function getAuthorizedBooking(client, bookingId, userId) {
  const result = await client.query(
    `
    SELECT
      id,
      owner_id AS "ownerId",
      sitter_id AS "sitterId"
    FROM bookings
    WHERE id = $1
      AND (
        owner_id = $2
        OR sitter_id = $2
      );
    `,
    [bookingId, userId],
  );

  return result.rows[0] || null;
}

export async function getConversations(req, res, next) {
  try {
    const userId = getUserId(req);

    const result = await query(
      `
      SELECT
        bookings.id,
        bookings.id AS "bookingId",
        CASE
          WHEN bookings.owner_id = $1
            THEN bookings.sitter_id
          ELSE bookings.owner_id
        END AS "participantId",
        CASE
          WHEN bookings.owner_id = $1
            THEN sitter_user.name
          ELSE owner_user.name
        END AS "participantName",
        CONCAT(
          services.name,
          ' - ',
          pets.name
        ) AS "bookingLabel",
        latest_message.body AS "lastMessage",
        COALESCE(
          latest_message.created_at,
          bookings.created_at
        ) AS "updatedAt",
        COALESCE(
          unread_messages.unread_count,
          0
        )::int AS "unreadCount"
      FROM bookings
      JOIN users owner_user
        ON owner_user.id = bookings.owner_id
      JOIN users sitter_user
        ON sitter_user.id = bookings.sitter_id
      JOIN pets
        ON pets.id = bookings.pet_id
      JOIN sitter_services
        ON sitter_services.id = bookings.sitter_service_id
      JOIN services
        ON services.id = sitter_services.service_id
      LEFT JOIN LATERAL (
        SELECT
          messages.body,
          messages.created_at
        FROM messages
        WHERE messages.booking_id = bookings.id
        ORDER BY
          messages.created_at DESC,
          messages.id DESC
        LIMIT 1
      ) latest_message
        ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS unread_count
        FROM messages
        WHERE messages.booking_id = bookings.id
          AND messages.recipient_id = $1
          AND messages.read_at IS NULL
      ) unread_messages
        ON true
      WHERE bookings.owner_id = $1
        OR bookings.sitter_id = $1
      ORDER BY
        COALESCE(
          latest_message.created_at,
          bookings.created_at
        ) DESC,
        bookings.id DESC;
      `,
      [userId],
    );

    res.status(200).json({
      conversations: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function getBookingMessages(req, res, next) {
  const client = await pool.connect();

  try {
    const userId = getUserId(req);
    const bookingId = parsePositiveInteger(req.params.bookingId);

    if (!bookingId) {
      return res.status(400).json({
        error: "bookingId must be a positive integer",
      });
    }

    await client.query("BEGIN");

    const booking = await getAuthorizedBooking(
      client,
      bookingId,
      userId,
    );

    if (!booking) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Booking conversation not found",
      });
    }

    await client.query(
      `
      UPDATE messages
      SET read_at = NOW()
      WHERE booking_id = $1
        AND recipient_id = $2
        AND read_at IS NULL;
      `,
      [bookingId, userId],
    );

    const result = await client.query(
      `
      SELECT
        id,
        booking_id AS "bookingId",
        sender_id AS "senderId",
        recipient_id AS "recipientId",
        body,
        read_at AS "readAt",
        created_at AS "createdAt"
      FROM messages
      WHERE booking_id = $1
      ORDER BY
        created_at ASC,
        id ASC;
      `,
      [bookingId],
    );

    await client.query("COMMIT");

    res.status(200).json({
      messages: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

export async function createMessage(req, res, next) {
  const client = await pool.connect();

  try {
    const userId = getUserId(req);
    const bookingId = parsePositiveInteger(req.body.bookingId);
    const { body } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        error: "bookingId must be a positive integer",
      });
    }

    if (typeof body !== "string") {
      return res.status(400).json({
        error: "body must be a string",
      });
    }

    const normalizedBody = body.trim();

    if (!normalizedBody) {
      return res.status(400).json({
        error: "Message body cannot be empty",
      });
    }

    if (normalizedBody.length > 2000) {
      return res.status(400).json({
        error: "Message body cannot exceed 2000 characters",
      });
    }

    await client.query("BEGIN");

    const booking = await getAuthorizedBooking(
      client,
      bookingId,
      userId,
    );

    if (!booking) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Booking conversation not found",
      });
    }

    const recipientId =
      userId === booking.ownerId
        ? booking.sitterId
        : booking.ownerId;

    const result = await client.query(
      `
      INSERT INTO messages (
        booking_id,
        sender_id,
        recipient_id,
        body
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        booking_id AS "bookingId",
        sender_id AS "senderId",
        recipient_id AS "recipientId",
        body,
        read_at AS "readAt",
        created_at AS "createdAt";
      `,
      [
        bookingId,
        userId,
        recipientId,
        normalizedBody,
      ],
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}