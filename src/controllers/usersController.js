import { query } from "../db/client.js";
import {
  hasOwn,
  isPlainObject,
  isStringWithinLength,
  isValidEmail,
  isValidState,
  isValidZipCode,
} from "../utils/validation.js";

const PROFILE_FIELDS = [
  "name",
  "email",
  "bio",
  "phone",
  "city",
  "state",
  "zipCode",
];

function getUserId(req) {
  return req.user.id || req.user.userId;
}

function hasProfileUpdate(body) {
  return PROFILE_FIELDS.some((field) =>
    hasOwn(body, field),
  );
}

function parseRequiredString(
  value,
  field,
  maxLength,
) {
  if (
    !isStringWithinLength(value, {
      min: 1,
      max: maxLength,
    })
  ) {
    return {
      value: null,
      error:
        `${field} must be a non-empty string no longer ` +
        `than ${maxLength} characters`,
    };
  }

  return {
    value: value.trim(),
    error: null,
  };
}

function parseNullableString(
  value,
  field,
  maxLength,
) {
  if (value === null) {
    return {
      value: null,
      error: null,
    };
  }

  if (typeof value !== "string") {
    return {
      value: null,
      error: `${field} must be a string or null`,
    };
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > maxLength) {
    return {
      value: null,
      error:
        `${field} cannot exceed ` +
        `${maxLength} characters`,
    };
  }

  return {
    value: normalizedValue || null,
    error: null,
  };
}

export async function getCurrentUser(
  req,
  res,
  next,
) {
  try {
    const userId = getUserId(req);

    const result = await query(
      `
      SELECT
        id,
        name,
        email,
        role,
        bio,
        phone,
        city,
        state,
        zip_code AS "zipCode",
        trust_score AS "trustScore",
        background_check_status
          AS "backgroundCheckStatus",
        on_time_percentage AS "onTimePercentage",
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt",
        created_at AS "createdAt"
      FROM users
      WHERE id = $1
        AND is_active = true;
      `,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.status(200).json({
      user: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function updateCurrentUser(
  req,
  res,
  next,
) {
  try {
    const userId = getUserId(req);

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error: "Request body must be a JSON object",
      });
    }

    if (!hasProfileUpdate(req.body)) {
      return res.status(400).json({
        error:
          "At least one profile field is required",
      });
    }

    const hasName = hasOwn(req.body, "name");
    const hasEmail = hasOwn(req.body, "email");
    const hasBio = hasOwn(req.body, "bio");
    const hasPhone = hasOwn(req.body, "phone");
    const hasCity = hasOwn(req.body, "city");
    const hasState = hasOwn(req.body, "state");
    const hasZipCode = hasOwn(
      req.body,
      "zipCode",
    );

    let normalizedName = null;

    if (hasName) {
      const parsedName = parseRequiredString(
        req.body.name,
        "name",
        100,
      );

      if (parsedName.error) {
        return res.status(400).json({
          error: parsedName.error,
        });
      }

      normalizedName = parsedName.value;
    }

    let normalizedEmail = null;

    if (hasEmail) {
      if (!isValidEmail(req.body.email)) {
        return res.status(400).json({
          error:
            "email must be a valid email address",
        });
      }

      normalizedEmail = req.body.email
        .trim()
        .toLowerCase();
    }

    let normalizedBio = null;

    if (hasBio) {
      const parsedBio = parseNullableString(
        req.body.bio,
        "bio",
        2000,
      );

      if (parsedBio.error) {
        return res.status(400).json({
          error: parsedBio.error,
        });
      }

      normalizedBio = parsedBio.value;
    }

    let normalizedPhone = null;

    if (hasPhone) {
      const parsedPhone = parseNullableString(
        req.body.phone,
        "phone",
        20,
      );

      if (parsedPhone.error) {
        return res.status(400).json({
          error: parsedPhone.error,
        });
      }

      normalizedPhone = parsedPhone.value;
    }

    let normalizedCity = null;

    if (hasCity) {
      const parsedCity = parseRequiredString(
        req.body.city,
        "city",
        100,
      );

      if (parsedCity.error) {
        return res.status(400).json({
          error: parsedCity.error,
        });
      }

      normalizedCity = parsedCity.value;
    }

    let normalizedState = null;

    if (hasState) {
      if (!isValidState(req.body.state)) {
        return res.status(400).json({
          error:
            "state must be a two-letter abbreviation",
        });
      }

      normalizedState = req.body.state
        .trim()
        .toUpperCase();
    }

    let normalizedZipCode = null;

    if (hasZipCode) {
      if (
        typeof req.body.zipCode !== "string" ||
        !isValidZipCode(req.body.zipCode)
      ) {
        return res.status(400).json({
          error:
            "zipCode must use 12345 or 12345-6789 format",
        });
      }

      normalizedZipCode =
        req.body.zipCode.trim();
    }

    const result = await query(
      `
      UPDATE users
      SET
        name = CASE
          WHEN $1::boolean THEN $2::varchar
          ELSE name
        END,
        email = CASE
          WHEN $3::boolean THEN $4::varchar
          ELSE email
        END,
        bio = CASE
          WHEN $5::boolean THEN $6::text
          ELSE bio
        END,
        phone = CASE
          WHEN $7::boolean THEN $8::varchar
          ELSE phone
        END,
        city = CASE
          WHEN $9::boolean THEN $10::varchar
          ELSE city
        END,
        state = CASE
          WHEN $11::boolean THEN $12::varchar
          ELSE state
        END,
        zip_code = CASE
          WHEN $13::boolean THEN $14::varchar
          ELSE zip_code
        END
      WHERE id = $15
        AND is_active = true
      RETURNING
        id,
        name,
        email,
        role,
        bio,
        phone,
        city,
        state,
        zip_code AS "zipCode",
        trust_score AS "trustScore",
        background_check_status
          AS "backgroundCheckStatus",
        on_time_percentage AS "onTimePercentage",
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt",
        created_at AS "createdAt";
      `,
      [
        hasName,
        normalizedName,
        hasEmail,
        normalizedEmail,
        hasBio,
        normalizedBio,
        hasPhone,
        normalizedPhone,
        hasCity,
        normalizedCity,
        hasState,
        normalizedState,
        hasZipCode,
        normalizedZipCode,
        userId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.status(200).json({
      user: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error:
          "An account with that email already exists",
      });
    }

    next(error);
  }
}