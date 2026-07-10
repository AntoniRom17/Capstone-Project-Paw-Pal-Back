import { query } from "../db/client.js";

function addParameter(params, value) {
  params.push(value);
  return `$${params.length}`;
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

    if (service) {
      const parameter = addParameter(params, `%${service}%`);

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

    if (city) {
      const parameter = addParameter(params, `%${city}%`);
      conditions.push(`u.city ILIKE ${parameter}`);
    }

    if (state) {
      const parameter = addParameter(params, state);
      conditions.push(`u.state ILIKE ${parameter}`);
    }

    if (zipCode) {
      const parameter = addParameter(params, zipCode);
      conditions.push(`u.zip_code = ${parameter}`);
    }

    if (maxPrice !== undefined) {
      const numericMaxPrice = Number(maxPrice);

      if (!Number.isFinite(numericMaxPrice) || numericMaxPrice < 0) {
        return res.status(400).json({
          error: "maxPrice must be a non-negative number",
        });
      }

      const parameter = addParameter(params, numericMaxPrice);

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
      const numericMinRating = Number(minRating);

      if (
        !Number.isFinite(numericMinRating) ||
        numericMinRating < 0 ||
        numericMinRating > 5
      ) {
        return res.status(400).json({
          error: "minRating must be between 0 and 5",
        });
      }

      const parameter = addParameter(params, numericMinRating);

      conditions.push(`
        COALESCE(
          (
            SELECT AVG(review_filter.rating)
            FROM bookings booking_filter
            JOIN reviews review_filter
              ON review_filter.booking_id = booking_filter.id
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
        u.background_check_status AS "backgroundCheckStatus",
        COALESCE(
          u.on_time_percentage,
          0
        ) AS "onTimePercentage",
        COALESCE(
          (
            SELECT ROUND(AVG(reviews.rating)::numeric, 1)::float
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
              ON services.id = sitter_services.service_id
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

export const getSitterById = async (req, res, next) => {
  try {
    const { id } = req.params;

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
        u.background_check_status AS "backgroundCheckStatus",
        COALESCE(
          u.on_time_percentage,
          0
        ) AS "onTimePercentage",
        COALESCE(
          (
            SELECT ROUND(AVG(reviews.rating)::numeric, 1)::float
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
      [id],
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
      [id],
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
        AND date >= CURRENT_DATE
        AND is_booked = false
      ORDER BY date ASC, start_time ASC;
      `,
      [id],
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
      [id],
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

export const addSitterService = async (req, res, next) => {
  try {
    const sitterId = req.user.id;
    const { serviceId, priceOverride } = req.body;

    if (!serviceId) {
      return res.status(400).json({
        error: "serviceId is required",
      });
    }

    if (
      priceOverride !== undefined &&
      priceOverride !== null &&
      (!Number.isFinite(Number(priceOverride)) ||
        Number(priceOverride) < 0)
    ) {
      return res.status(400).json({
        error: "priceOverride must be a non-negative number",
      });
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
        priceOverride === undefined
          ? null
          : Number(priceOverride),
      ],
    );

    res.status(201).json({
      sitterService: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "This service is already listed by the sitter",
      });
    }

    if (error.code === "23503") {
      return res.status(400).json({
        error: "The selected service does not exist",
      });
    }

    next(error);
  }
};