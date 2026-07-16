import { query } from "../db/client.js";
import {
  hasOwn,
  isPlainObject,
  isStringWithinLength,
  isValidState,
  isValidZipCode,
  parseNumber,
  parsePositiveInteger,
} from "../utils/validation.js";

const MAX_SERVICE_PRICE = 999999.99;

function addParameter(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function parsePriceOverride(value) {
  if (value === null) {
    return {
      value: null,
      error: null,
    };
  }

  const numericValue = parseNumber(value, {
    min: 0,
    max: MAX_SERVICE_PRICE,
  });

  if (numericValue === null) {
    return {
      value: null,
      error:
        "priceOverride must be a non-negative number or null",
    };
  }

  return {
    value: numericValue,
    error: null,
  };
}

export const getSitters = async (req, res, next) => {
  try {
    const {
      service,
      city,
      state,
      zipCode,
      maxPrice,
      minRating,
    } = req.query;

    const params = [];
    const conditions = ["u.role = 'sitter'"];

    if (service !== undefined) {
      if (
        !isStringWithinLength(service, {
          min: 1,
          max: 50,
        })
      ) {
        return res.status(400).json({
          error:
            "service must be a non-empty string no longer than 50 characters",
        });
      }

      const parameter = addParameter(
        params,
        `%${service.trim()}%`,
      );

      conditions.push(`
        EXISTS (
          SELECT 1
          FROM sitter_services filter_ss
          JOIN services filter_service
            ON filter_service.id = filter_ss.service_id
          WHERE filter_ss.sitter_id = u.id
            AND filter_service.name ILIKE ${parameter}
        )
      `);
    }

    if (city !== undefined) {
      if (
        !isStringWithinLength(city, {
          min: 1,
          max: 100,
        })
      ) {
        return res.status(400).json({
          error:
            "city must be a non-empty string no longer than 100 characters",
        });
      }

      const parameter = addParameter(
        params,
        `%${city.trim()}%`,
      );

      conditions.push(`u.city ILIKE ${parameter}`);
    }

    if (state !== undefined) {
      if (!isValidState(state)) {
        return res.status(400).json({
          error:
            "state must be a two-letter abbreviation",
        });
      }

      const parameter = addParameter(
        params,
        state.trim().toUpperCase(),
      );

      conditions.push(`u.state = ${parameter}`);
    }

    if (zipCode !== undefined) {
      if (!isValidZipCode(zipCode)) {
        return res.status(400).json({
          error:
            "zipCode must use 12345 or 12345-6789 format",
        });
      }

      const parameter = addParameter(
        params,
        String(zipCode).trim(),
      );

      conditions.push(`u.zip_code = ${parameter}`);
    }

    if (maxPrice !== undefined) {
      const numericMaxPrice = parseNumber(maxPrice, {
        min: 0,
        max: MAX_SERVICE_PRICE,
      });

      if (numericMaxPrice === null) {
        return res.status(400).json({
          error:
            "maxPrice must be a number between 0 and 999999.99",
        });
      }

      const parameter = addParameter(
        params,
        numericMaxPrice,
      );

      conditions.push(`
        EXISTS (
          SELECT 1
          FROM sitter_services price_ss
          JOIN services price_service
            ON price_service.id = price_ss.service_id
          WHERE price_ss.sitter_id = u.id
            AND COALESCE(
              price_ss.price_override,
              price_service.base_price
            ) <= ${parameter}
        )
      `);
    }

    if (minRating !== undefined) {
      const numericMinRating = parseNumber(minRating, {
        min: 0,
        max: 5,
      });

      if (numericMinRating === null) {
        return res.status(400).json({
          error: "minRating must be between 0 and 5",
        });
      }

      const parameter = addParameter(
        params,
        numericMinRating,
      );

      conditions.push(`
        COALESCE(
          (
            SELECT AVG(review_filter.rating)
            FROM bookings booking_filter
            JOIN reviews review_filter
              ON review_filter.booking_id =
                booking_filter.id
            WHERE booking_filter.sitter_id = u.id
          ),
          0
        ) >= ${parameter}
      `);
    }

    const result = await query(
      `
      SELECT
        u.id,
        u.name,
        u.bio,
        u.city,
        u.state,
        u.zip_code AS "zipCode",
        COALESCE(u.trust_score, 0) AS "trustScore",
        u.background_check_status
          AS "backgroundCheckStatus",
        COALESCE(
          u.on_time_percentage,
          0
        ) AS "onTimePercentage",
        COALESCE(
          (
            SELECT ROUND(
              AVG(reviews.rating)::numeric,
              1
            )::float
            FROM bookings
            JOIN reviews
              ON reviews.booking_id = bookings.id
            WHERE bookings.sitter_id = u.id
          ),
          0
        ) AS "averageRating",
        (
          SELECT COUNT(*)::int
          FROM bookings
          JOIN reviews
            ON reviews.booking_id = bookings.id
          WHERE bookings.sitter_id = u.id
        ) AS "reviewCount",
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'sitterServiceId',
                sitter_services.id,
                'serviceId',
                services.id,
                'name',
                services.name,
                'description',
                services.description,
                'price',
                COALESCE(
                  sitter_services.price_override,
                  services.base_price
                )::float
              )
              ORDER BY services.name
            )
            FROM sitter_services
            JOIN services
              ON services.id =
                sitter_services.service_id
            WHERE sitter_services.sitter_id = u.id
          ),
          '[]'::jsonb
        ) AS services
      FROM users u
      WHERE ${conditions.join(" AND ")}
      ORDER BY "averageRating" DESC, u.name ASC;
      `,
      params,
    );

    res.json({
      sitters: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const getSitterById = async (
  req,
  res,
  next,
) => {
  try {
    const sitterId = parsePositiveInteger(req.params.id);

    if (!sitterId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

    const sitterResult = await query(
      `
      SELECT
        u.id,
        u.name,
        u.bio,
        u.phone,
        u.city,
        u.state,
        u.zip_code AS "zipCode",
        COALESCE(u.trust_score, 0) AS "trustScore",
        u.background_check_status
          AS "backgroundCheckStatus",
        COALESCE(
          u.on_time_percentage,
          0
        ) AS "onTimePercentage",
        COALESCE(
          (
            SELECT ROUND(
              AVG(reviews.rating)::numeric,
              1
            )::float
            FROM bookings
            JOIN reviews
              ON reviews.booking_id = bookings.id
            WHERE bookings.sitter_id = u.id
          ),
          0
        ) AS "averageRating",
        (
          SELECT COUNT(*)::int
          FROM bookings
          JOIN reviews
            ON reviews.booking_id = bookings.id
          WHERE bookings.sitter_id = u.id
        ) AS "reviewCount"
      FROM users u
      WHERE u.id = $1
        AND u.role = 'sitter';
      `,
      [sitterId],
    );

    if (sitterResult.rows.length === 0) {
      return res.status(404).json({
        error: "Sitter not found",
      });
    }

    const servicesResult = await query(
      `
      SELECT
        sitter_services.id AS "sitterServiceId",
        services.id AS "serviceId",
        services.name,
        services.description,
        COALESCE(
          sitter_services.price_override,
          services.base_price
        )::float AS price
      FROM sitter_services
      JOIN services
        ON services.id = sitter_services.service_id
      WHERE sitter_services.sitter_id = $1
      ORDER BY services.name;
      `,
      [sitterId],
    );

    const availabilityResult = await query(
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
      [sitterId],
    );

    const reviewsResult = await query(
      `
      SELECT
        reviews.id,
        reviews.booking_id AS "bookingId",
        reviews.reviewer_id AS "reviewerId",
        users.name AS "reviewerName",
        reviews.rating,
        reviews.comment,
        reviews.created_at AS "createdAt"
      FROM reviews
      JOIN bookings
        ON bookings.id = reviews.booking_id
      JOIN users
        ON users.id = reviews.reviewer_id
      WHERE bookings.sitter_id = $1
      ORDER BY reviews.created_at DESC;
      `,
      [sitterId],
    );

    res.json({
      sitter: {
        ...sitterResult.rows[0],
        services: servicesResult.rows,
        availability: availabilityResult.rows,
        reviews: reviewsResult.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const addSitterService = async (
  req,
  res,
  next,
) => {
  try {
    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error: "Request body must be a JSON object",
      });
    }

    if (!hasOwn(req.body, "serviceId")) {
      return res.status(400).json({
        error: "serviceId is required",
      });
    }

    const sitterId =
      req.user.id || req.user.userId;

    const serviceId = parsePositiveInteger(
      req.body.serviceId,
    );

    if (!serviceId) {
      return res.status(400).json({
        error:
          "serviceId must be a positive integer",
      });
    }

    let normalizedPriceOverride = null;

    if (hasOwn(req.body, "priceOverride")) {
      const parsedPrice = parsePriceOverride(
        req.body.priceOverride,
      );

      if (parsedPrice.error) {
        return res.status(400).json({
          error: parsedPrice.error,
        });
      }

      normalizedPriceOverride =
        parsedPrice.value;
    }

    const result = await query(
      `
      WITH inserted AS (
        INSERT INTO sitter_services (
          sitter_id,
          service_id,
          price_override
        )
        VALUES ($1, $2, $3)
        RETURNING
          id,
          sitter_id,
          service_id,
          price_override
      )
      SELECT
        inserted.id AS "sitterServiceId",
        inserted.sitter_id AS "sitterId",
        inserted.service_id AS "serviceId",
        services.name,
        services.description,
        COALESCE(
          inserted.price_override,
          services.base_price
        )::float AS price
      FROM inserted
      JOIN services
        ON services.id = inserted.service_id;
      `,
      [
        sitterId,
        serviceId,
        normalizedPriceOverride,
      ],
    );

    res.status(201).json({
      sitterService: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error:
          "This service is already listed by the sitter",
      });
    }

    if (error.code === "23503") {
      return res.status(400).json({
        error:
          "The selected service does not exist",
      });
    }

    next(error);
  }
};

export const updateSitterService = async (
  req,
  res,
  next,
) => {
  try {
    const sitterId =
      req.user.id || req.user.userId;

    const sitterServiceId =
      parsePositiveInteger(req.params.id);

    if (!sitterServiceId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error: "Request body must be a JSON object",
      });
    }

    if (!hasOwn(req.body, "priceOverride")) {
      return res.status(400).json({
        error: "priceOverride is required",
      });
    }

    const parsedPrice = parsePriceOverride(
      req.body.priceOverride,
    );

    if (parsedPrice.error) {
      return res.status(400).json({
        error: parsedPrice.error,
      });
    }

    const result = await query(
      `
      WITH updated AS (
        UPDATE sitter_services
        SET price_override = $1
        WHERE id = $2
          AND sitter_id = $3
        RETURNING
          id,
          sitter_id,
          service_id,
          price_override
      )
      SELECT
        updated.id AS "sitterServiceId",
        updated.sitter_id AS "sitterId",
        updated.service_id AS "serviceId",
        services.name,
        services.description,
        COALESCE(
          updated.price_override,
          services.base_price
        )::float AS price
      FROM updated
      JOIN services
        ON services.id = updated.service_id;
      `,
      [
        parsedPrice.value,
        sitterServiceId,
        sitterId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Sitter service not found",
      });
    }

    res.status(200).json({
      sitterService: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSitterService = async (
  req,
  res,
  next,
) => {
  try {
    const sitterId =
      req.user.id || req.user.userId;

    const sitterServiceId =
      parsePositiveInteger(req.params.id);

    if (!sitterServiceId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

    const result = await query(
      `
      DELETE FROM sitter_services
      WHERE id = $1
        AND sitter_id = $2
      RETURNING id;
      `,
      [sitterServiceId, sitterId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Sitter service not found",
      });
    }

    res.status(200).json({
      message:
        "Sitter service deleted successfully",
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({
        error:
          "Sitter service is attached to a booking and cannot be deleted",
      });
    }

    next(error);
  }
};