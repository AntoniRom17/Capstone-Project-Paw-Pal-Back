import { query } from "../db/client.js";

export const createReview = async (req, res, next) => {
  try {
    const ownerId = req.user.id || req.user.userId;
    const { bookingId, rating, comment } = req.body;

    const numericBookingId = Number(bookingId);
    const numericRating = Number(rating);

    if (
      !Number.isInteger(numericBookingId) ||
      numericBookingId <= 0
    ) {
      return res.status(400).json({
        error: "bookingId must be a positive integer",
      });
    }

    if (
      !Number.isInteger(numericRating) ||
      numericRating < 1 ||
      numericRating > 5
    ) {
      return res.status(400).json({
        error: "rating must be an integer between 1 and 5",
      });
    }

    if (comment !== undefined && typeof comment !== "string") {
      return res.status(400).json({
        error: "comment must be a string",
      });
    }

    const bookingResult = await query(
      `
      SELECT
        id,
        owner_id AS "ownerId",
        sitter_id AS "sitterId",
        status
      FROM bookings
      WHERE id = $1;
      `,
      [numericBookingId],
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        error: "Booking not found",
      });
    }

    const booking = bookingResult.rows[0];

    if (booking.ownerId !== ownerId) {
      return res.status(404).json({
        error: "Booking not found",
      });
    }

    if (booking.status !== "completed") {
      return res.status(400).json({
        error: "Only completed bookings can be reviewed",
      });
    }

    const existingReview = await query(
      `
      SELECT id
      FROM reviews
      WHERE booking_id = $1;
      `,
      [numericBookingId],
    );

    if (existingReview.rows.length > 0) {
      return res.status(409).json({
        error: "This booking has already been reviewed",
      });
    }

    const normalizedComment =
      typeof comment === "string" && comment.trim()
        ? comment.trim()
        : null;

    const result = await query(
      `
      WITH inserted AS (
        INSERT INTO reviews (
          booking_id,
          reviewer_id,
          rating,
          comment
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          booking_id,
          reviewer_id,
          rating,
          comment,
          created_at
      )
      SELECT
        inserted.id,
        inserted.booking_id AS "bookingId",
        inserted.reviewer_id AS "reviewerId",
        bookings.sitter_id AS "sitterId",
        inserted.rating,
        inserted.comment,
        inserted.created_at AS "createdAt"
      FROM inserted
      JOIN bookings
        ON bookings.id = inserted.booking_id;
      `,
      [
        numericBookingId,
        ownerId,
        numericRating,
        normalizedComment,
      ],
    );

    res.status(201).json({
      review: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "This booking has already been reviewed",
      });
    }

    next(error);
  }
};