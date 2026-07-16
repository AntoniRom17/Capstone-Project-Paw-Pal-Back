import { pool } from "../db/client.js";
import {
  isPlainObject,
  parseNumber,
  parsePositiveInteger,
} from "../utils/validation.js";
import {
  recalculateSitterTrustMetrics,
} from "../utils/trustMetrics.js";

export const createReview = async (
  req,
  res,
  next,
) => {
  let client;
  let transactionStarted = false;

  try {
    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error: "Request body must be a JSON object",
      });
    }

    const ownerId =
      req.user.id || req.user.userId;

    const {
      bookingId,
      rating,
      wasOnTime,
      comment,
    } = req.body;

    if (bookingId === undefined) {
      return res.status(400).json({
        error: "bookingId is required",
      });
    }

    if (rating === undefined) {
      return res.status(400).json({
        error: "rating is required",
      });
    }

    const numericBookingId =
      parsePositiveInteger(bookingId);

    if (!numericBookingId) {
      return res.status(400).json({
        error:
          "bookingId must be a positive integer",
      });
    }

    const numericRating = parseNumber(rating, {
      min: 1,
      max: 5,
      integer: true,
      allowString: false,
    });

    if (numericRating === null) {
      return res.status(400).json({
        error:
          "rating must be an integer between 1 and 5",
      });
    }

    if (
      wasOnTime !== undefined &&
      wasOnTime !== null &&
      typeof wasOnTime !== "boolean"
    ) {
      return res.status(400).json({
        error:
          "wasOnTime must be a boolean or null",
      });
    }

    if (
      comment !== undefined &&
      comment !== null &&
      typeof comment !== "string"
    ) {
      return res.status(400).json({
        error:
          "comment must be a string or null",
      });
    }

    if (
      typeof comment === "string" &&
      comment.trim().length > 2000
    ) {
      return res.status(400).json({
        error:
          "comment cannot exceed 2000 characters",
      });
    }

    const normalizedWasOnTime =
      typeof wasOnTime === "boolean"
        ? wasOnTime
        : null;

    const normalizedComment =
      typeof comment === "string" &&
      comment.trim()
        ? comment.trim()
        : null;

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const bookingResult = await client.query(
      `
      SELECT
        id,
        owner_id AS "ownerId",
        sitter_id AS "sitterId",
        status
      FROM bookings
      WHERE id = $1
      FOR UPDATE;
      `,
      [numericBookingId],
    );

    if (bookingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Booking not found",
      });
    }

    const booking = bookingResult.rows[0];

    if (booking.ownerId !== ownerId) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Booking not found",
      });
    }

    if (booking.status !== "completed") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        error:
          "Only completed bookings can be reviewed",
      });
    }

    const existingReview =
      await client.query(
        `
        SELECT id
        FROM reviews
        WHERE booking_id = $1;
        `,
        [numericBookingId],
      );

    if (existingReview.rows.length > 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        error:
          "This booking has already been reviewed",
      });
    }

    const result = await client.query(
      `
      WITH inserted AS (
        INSERT INTO reviews (
          booking_id,
          reviewer_id,
          rating,
          was_on_time,
          comment
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          booking_id,
          reviewer_id,
          rating,
          was_on_time,
          comment,
          created_at
      )
      SELECT
        inserted.id,
        inserted.booking_id AS "bookingId",
        inserted.reviewer_id AS "reviewerId",
        bookings.sitter_id AS "sitterId",
        inserted.rating,
        inserted.was_on_time AS "wasOnTime",
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
        normalizedWasOnTime,
        normalizedComment,
      ],
    );

    const trustMetrics =
      await recalculateSitterTrustMetrics(
        client,
        booking.sitterId,
      );

    await client.query("COMMIT");
    transactionStarted = false;

    res.status(201).json({
      review: result.rows[0],
      trustMetrics,
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        return next(rollbackError);
      }
    }

    if (error.code === "23505") {
      return res.status(409).json({
        error:
          "This booking has already been reviewed",
      });
    }

    next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
};