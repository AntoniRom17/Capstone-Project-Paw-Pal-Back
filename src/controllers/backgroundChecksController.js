import { timingSafeEqual } from "node:crypto";
import { pool } from "../db/client.js";
import {
  isPlainObject,
  parsePositiveInteger,
} from "../utils/validation.js";
import {
  recalculateSitterTrustMetrics,
} from "../utils/trustMetrics.js";

const PROVIDER_STATUSES = new Set([
  "verified",
  "rejected",
]);

function webhookSecretsMatch(
  providedSecret,
  configuredSecret,
) {
  if (
    typeof providedSecret !== "string" ||
    typeof configuredSecret !== "string" ||
    configuredSecret.trim().length === 0
  ) {
    return false;
  }

  const providedBuffer = Buffer.from(
    providedSecret,
    "utf8",
  );

  const configuredBuffer = Buffer.from(
    configuredSecret,
    "utf8",
  );

  if (
    providedBuffer.length !==
    configuredBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    providedBuffer,
    configuredBuffer,
  );
}

export async function submitBackgroundCheck(
  req,
  res,
  next,
) {
  let client;
  let transactionStarted = false;

  try {
    const sitterId =
      req.user.id || req.user.userId;

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const { rows } = await client.query(
      `
      SELECT
        id,
        background_check_status
          AS "backgroundCheckStatus"
      FROM users
      WHERE id = $1
        AND role = 'sitter'
        AND is_active = true
      FOR UPDATE;
      `,
      [sitterId],
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Sitter not found",
      });
    }

    const currentStatus =
      rows[0].backgroundCheckStatus;

    if (currentStatus === "pending") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        error:
          "Background check is already pending",
      });
    }

    if (currentStatus === "verified") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        error:
          "Background check is already verified",
      });
    }

    const updateResult = await client.query(
      `
      UPDATE users
      SET background_check_status = 'pending'
      WHERE id = $1
      RETURNING
        id AS "sitterId",
        background_check_status
          AS "backgroundCheckStatus";
      `,
      [sitterId],
    );

    const trustMetrics =
      await recalculateSitterTrustMetrics(
        client,
        sitterId,
      );

    await client.query("COMMIT");
    transactionStarted = false;

    res.status(200).json({
      backgroundCheck: updateResult.rows[0],
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

    next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function updateBackgroundCheckStatus(
  req,
  res,
  next,
) {
  let client;
  let transactionStarted = false;

  try {
    const configuredSecret =
      process.env
        .BACKGROUND_CHECK_WEBHOOK_SECRET;

    if (
      typeof configuredSecret !== "string" ||
      configuredSecret.trim().length === 0
    ) {
      return res.status(503).json({
        error:
          "Background check webhook is not configured",
      });
    }

    const providedSecret = req.get(
      "x-background-check-secret",
    );

    if (
      !webhookSecretsMatch(
        providedSecret,
        configuredSecret,
      )
    ) {
      return res.status(401).json({
        error:
          "Invalid background check webhook secret",
      });
    }

    const sitterId = parsePositiveInteger(
      req.params.sitterId,
    );

    if (!sitterId) {
      return res.status(400).json({
        error:
          "sitterId must be a positive integer",
      });
    }

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error:
          "Request body must be a JSON object",
      });
    }

    const { status } = req.body;

    if (typeof status !== "string") {
      return res.status(400).json({
        error:
          "status must be 'verified' or 'rejected'",
      });
    }

    const normalizedStatus = status
      .trim()
      .toLowerCase();

    if (
      !PROVIDER_STATUSES.has(
        normalizedStatus,
      )
    ) {
      return res.status(400).json({
        error:
          "status must be 'verified' or 'rejected'",
      });
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const { rows } = await client.query(
      `
      SELECT
        id,
        background_check_status
          AS "backgroundCheckStatus"
      FROM users
      WHERE id = $1
        AND role = 'sitter'
      FOR UPDATE;
      `,
      [sitterId],
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Sitter not found",
      });
    }

    const currentStatus =
      rows[0].backgroundCheckStatus;

    if (currentStatus === normalizedStatus) {
      const trustMetrics =
        await recalculateSitterTrustMetrics(
          client,
          sitterId,
        );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(200).json({
        backgroundCheck: {
          sitterId,
          backgroundCheckStatus:
            currentStatus,
        },
        trustMetrics,
      });
    }

    if (currentStatus !== "pending") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        error:
          "Only pending background checks can be updated",
      });
    }

    const updateResult = await client.query(
      `
      UPDATE users
      SET background_check_status = $1
      WHERE id = $2
      RETURNING
        id AS "sitterId",
        background_check_status
          AS "backgroundCheckStatus";
      `,
      [
        normalizedStatus,
        sitterId,
      ],
    );

    const trustMetrics =
      await recalculateSitterTrustMetrics(
        client,
        sitterId,
      );

    await client.query("COMMIT");
    transactionStarted = false;

    res.status(200).json({
      backgroundCheck: updateResult.rows[0],
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

    next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
}