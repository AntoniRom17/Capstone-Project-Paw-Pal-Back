import { query } from "../db/client.js";

export const getSitters = async (req, res, next) => {
  try {
    const { service, city, state, zipCode, maxPrice, minRating } = req.query;

    const params = [];
    const where = ["u.role = 'sitter'"];
    const having = [];

    if (service) {
      params.push(`%${service}%`);
      where.push(`s.name ILIKE $${params.length}`);
    }

    if (city) {
      params.push(`%${city}%`);
      where.push(`u.city ILIKE $${params.length}`);
    }

    if (state) {
      params.push(state);
      where.push(`u.state ILIKE $${params.length}`);
    }

    if (zipCode) {
      params.push(zipCode);
      where.push(`u.zip_code = $${params.length}`);
    }

    if (maxPrice) {
      params.push(Number(maxPrice));
      where.push(`COALESCE(ss.price_override, s.base_price) <= $${params.length}`);
    }

    if (minRating) {
      params.push(Number(minRating));
      having.push(`COALESCE(AVG(r.rating), 0) >= $${params.length}`);
    }

    const whereClause = `WHERE ${where.join(" AND ")}`;
    const havingClause = having.length ? `HAVING ${having.join(" AND ")}` : "";

    const result = await query(
      `
      SELECT
        u.id,
        u.name,
        u.bio,
        u.city,
        u.state,
        u.zip_code AS "zipCode",
        94 AS "trustScore",
        'verified' AS "backgroundCheckStatus",
        98 AS "onTimePercentage",
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::float AS "averageRating",
        COUNT(DISTINCT r.id)::int AS "reviewCount",
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'sitterServiceId', ss.id,
              'serviceId', s.id,
              'name', s.name,
              'description', s.description,
              'price', COALESCE(ss.price_override, s.base_price)
            )
          ) FILTER (WHERE ss.id IS NOT NULL),
          '[]'::jsonb
        ) AS services
      FROM users u
      LEFT JOIN sitter_services ss ON ss.sitter_id = u.id
      LEFT JOIN services s ON s.id = ss.service_id
      LEFT JOIN bookings b ON b.sitter_id = u.id
      LEFT JOIN reviews r ON r.booking_id = b.id
      ${whereClause}
      GROUP BY u.id
      ${havingClause}
      ORDER BY "averageRating" DESC, u.name ASC;
      `,
      params
    );

    res.json({
      sitters: result.rows
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
        94 AS "trustScore",
        'verified' AS "backgroundCheckStatus",
        98 AS "onTimePercentage",
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::float AS "averageRating",
        COUNT(DISTINCT r.id)::int AS "reviewCount"
      FROM users u
      LEFT JOIN bookings b ON b.sitter_id = u.id
      LEFT JOIN reviews r ON r.booking_id = b.id
      WHERE u.id = $1 AND u.role = 'sitter'
      GROUP BY u.id;
      `,
      [id]
    );

    if (sitterResult.rows.length === 0) {
      return res.status(404).json({
        error: "Sitter not found"
      });
    }

    const servicesResult = await query(
      `
      SELECT
        ss.id AS "sitterServiceId",
        s.id AS "serviceId",
        s.name,
        s.description,
        COALESCE(ss.price_override, s.base_price) AS price
      FROM sitter_services ss
      JOIN services s ON s.id = ss.service_id
      WHERE ss.sitter_id = $1
      ORDER BY s.name;
      `,
      [id]
    );

    const sitter = {
      ...sitterResult.rows[0],
      services: servicesResult.rows,
      availability: [],
      reviews: []
    };

    res.json({
      sitter
    });
  } catch (error) {
    next(error);
  }
};