const RATING_WEIGHT = 70;
const ON_TIME_WEIGHT = 20;
const BACKGROUND_CHECK_WEIGHT = 10;

export async function recalculateSitterTrustMetrics(
  client,
  sitterId,
) {
  const { rows } = await client.query(
    `
    WITH review_metrics AS (
      SELECT
        AVG(reviews.rating::numeric)
          AS average_rating,
        CASE
          WHEN COUNT(reviews.was_on_time) = 0
            THEN NULL
          ELSE
            ROUND(
              100.0
              * COUNT(*) FILTER (
                WHERE reviews.was_on_time = true
              )
              / COUNT(reviews.was_on_time)
            )::integer
        END AS on_time_percentage
      FROM reviews
      JOIN bookings
        ON bookings.id = reviews.booking_id
      WHERE bookings.sitter_id = $1
    )
    UPDATE users AS sitter
    SET
      on_time_percentage =
        review_metrics.on_time_percentage,
      trust_score = LEAST(
        100,
        GREATEST(
          0,
          ROUND(
            COALESCE(
              (
                review_metrics.average_rating
                / 5.0
              ) * $2::numeric,
              0
            )
            +
            COALESCE(
              (
                review_metrics.on_time_percentage::numeric
                / 100.0
              ) * $3::numeric,
              0
            )
            +
            CASE
              WHEN sitter.background_check_status =
                'verified'
                THEN $4::numeric
              ELSE 0
            END
          )
        )
      )::integer
    FROM review_metrics
    WHERE sitter.id = $1
      AND sitter.role = 'sitter'
    RETURNING
      sitter.id AS "sitterId",
      sitter.trust_score AS "trustScore",
      sitter.on_time_percentage
        AS "onTimePercentage",
      sitter.background_check_status
        AS "backgroundCheckStatus";
    `,
    [
      sitterId,
      RATING_WEIGHT,
      ON_TIME_WEIGHT,
      BACKGROUND_CHECK_WEIGHT,
    ],
  );

  return rows[0] || null;
}