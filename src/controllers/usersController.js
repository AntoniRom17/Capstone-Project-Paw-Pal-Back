import bcrypt from "bcrypt";
import { pool, query } from "../db/client.js";
import {
  deleteProfilePhoto,
  ProfilePhotoStorageError,
  readProfilePhoto,
  saveProfilePhoto,
} from "../utils/profilePhotoStorage.js";
import {
  hasOwn,
  isPlainObject,
  isStringWithinLength,
  isValidEmail,
  isValidState,
  isValidZipCode,
  parsePositiveInteger,
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

const USER_RESPONSE_FIELDS = `
  id,
  name,
  email,
  role,
  bio,
  phone,
  city,
  state,
  zip_code AS "zipCode",
  (
    profile_photo_filename IS NOT NULL
  ) AS "hasProfilePhoto",
  trust_score AS "trustScore",
  background_check_status
    AS "backgroundCheckStatus",
  on_time_percentage AS "onTimePercentage",
  is_active AS "isActive",
  deactivated_at AS "deactivatedAt",
  created_at AS "createdAt"
`;

function getUserId(req) {
  return req.user.id || req.user.userId;
}

function hasProfileUpdate(body) {
  return PROFILE_FIELDS.some((field) =>
    hasOwn(body, field),
  );
}

function isValidCurrentPassword(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 128
  );
}

function isValidNewPassword(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length >= 8 &&
    value.length <= 128
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

async function deleteStoredProfilePhotoSafely(
  filename,
  reason,
) {
  if (!filename) {
    return;
  }

  try {
    await deleteProfilePhoto(filename);
  } catch (error) {
    console.error(
      "Profile photo cleanup failed",
      {
        reason,
        message: error.message,
      },
    );
  }
}

async function rollbackSafely(client) {
  try {
    await client.query("ROLLBACK");
    return null;
  } catch (error) {
    return error;
  }
}

function sendStorageError(
  error,
  res,
) {
  return res.status(error.status).json({
    error: error.message,
  });
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
        ${USER_RESPONSE_FIELDS}
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
        ${USER_RESPONSE_FIELDS};
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

export async function changePassword(
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

    const {
      currentPassword,
      newPassword,
    } = req.body;

    if (
      currentPassword === undefined ||
      newPassword === undefined
    ) {
      return res.status(400).json({
        error:
          "currentPassword and newPassword are required",
      });
    }

    if (!isValidCurrentPassword(currentPassword)) {
      return res.status(400).json({
        error:
          "currentPassword must be a non-empty string no longer than 128 characters",
      });
    }

    if (!isValidNewPassword(newPassword)) {
      return res.status(400).json({
        error:
          "newPassword must be a string between 8 and 128 characters",
      });
    }

    const result = await query(
      `
      SELECT password_hash
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

    const currentPasswordMatches =
      await bcrypt.compare(
        currentPassword,
        result.rows[0].password_hash,
      );

    if (!currentPasswordMatches) {
      return res.status(401).json({
        error: "Current password is incorrect",
      });
    }

    const passwordIsUnchanged =
      await bcrypt.compare(
        newPassword,
        result.rows[0].password_hash,
      );

    if (passwordIsUnchanged) {
      return res.status(400).json({
        error:
          "New password must be different from current password",
      });
    }

    const passwordHash = await bcrypt.hash(
      newPassword,
      10,
    );

    await query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
        AND is_active = true;
      `,
      [passwordHash, userId],
    );

    res.status(200).json({
      message: "Password changed successfully",
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadCurrentUserProfilePhoto(
  req,
  res,
  next,
) {
  if (!req.file) {
    return res.status(400).json({
      error:
        "A profile photo file is required",
    });
  }

  const userId = getUserId(req);
  const client = await pool.connect();

  let transactionStarted = false;
  let storedPhoto = null;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const existingResult =
      await client.query(
        `
        SELECT
          id,
          profile_photo_filename
            AS "profilePhotoFilename"
        FROM users
        WHERE id = $1
          AND is_active = true
        FOR UPDATE;
        `,
        [userId],
      );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "User not found",
      });
    }

    storedPhoto = await saveProfilePhoto(
      req.file.buffer,
    );

    const result = await client.query(
      `
      UPDATE users
      SET
        profile_photo_filename = $1,
        profile_photo_content_type = $2
      WHERE id = $3
        AND is_active = true
      RETURNING
        ${USER_RESPONSE_FIELDS};
      `,
      [
        storedPhoto.filename,
        storedPhoto.contentType,
        userId,
      ],
    );

    await client.query("COMMIT");
    transactionStarted = false;

    await deleteStoredProfilePhotoSafely(
      existingResult.rows[0]
        .profilePhotoFilename,
      "profile photo replacement",
    );

    res.status(200).json({
      user: result.rows[0],
    });
  } catch (error) {
    const rollbackError =
      transactionStarted
        ? await rollbackSafely(client)
        : null;

    if (storedPhoto) {
      await deleteStoredProfilePhotoSafely(
        storedPhoto.filename,
        "failed profile photo upload",
      );
    }

    if (rollbackError) {
      next(rollbackError);
      return;
    }

    if (
      error instanceof
      ProfilePhotoStorageError
    ) {
      sendStorageError(error, res);
      return;
    }

    next(error);
  } finally {
    client.release();
  }
}

export async function getUserProfilePhotoFile(
  req,
  res,
  next,
) {
  try {
    const userId =
      parsePositiveInteger(req.params.id);

    if (!userId) {
      return res.status(400).json({
        error:
          "id must be a positive integer",
      });
    }

    const result = await query(
      `
      SELECT
        profile_photo_filename
          AS "profilePhotoFilename",
        profile_photo_content_type
          AS "profilePhotoContentType"
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

    const user = result.rows[0];

    if (!user.profilePhotoFilename) {
      return res.status(404).json({
        error:
          "Profile photo not found",
      });
    }

    const photoBuffer =
      await readProfilePhoto(
        user.profilePhotoFilename,
      );

    if (!photoBuffer) {
      return res.status(404).json({
        error:
          "Profile photo not found",
      });
    }

    res.set({
      "Cache-Control": "no-store",
      "Content-Length":
        String(photoBuffer.length),
      "Content-Type":
        user.profilePhotoContentType,
      "X-Content-Type-Options":
        "nosniff",
    });

    res.status(200).send(photoBuffer);
  } catch (error) {
    next(error);
  }
}

export async function deleteCurrentUserProfilePhoto(
  req,
  res,
  next,
) {
  const userId = getUserId(req);
  const client = await pool.connect();

  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const existingResult =
      await client.query(
        `
        SELECT
          id,
          profile_photo_filename
            AS "profilePhotoFilename"
        FROM users
        WHERE id = $1
          AND is_active = true
        FOR UPDATE;
        `,
        [userId],
      );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "User not found",
      });
    }

    const existing =
      existingResult.rows[0];

    if (!existing.profilePhotoFilename) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error:
          "Profile photo not found",
      });
    }

    const result = await client.query(
      `
      UPDATE users
      SET
        profile_photo_filename = NULL,
        profile_photo_content_type = NULL
      WHERE id = $1
        AND is_active = true
      RETURNING
        ${USER_RESPONSE_FIELDS};
      `,
      [userId],
    );

    await client.query("COMMIT");
    transactionStarted = false;

    await deleteStoredProfilePhotoSafely(
      existing.profilePhotoFilename,
      "profile photo deletion",
    );

    res.status(200).json({
      user: result.rows[0],
    });
  } catch (error) {
    const rollbackError =
      transactionStarted
        ? await rollbackSafely(client)
        : null;

    if (rollbackError) {
      next(rollbackError);
      return;
    }

    next(error);
  } finally {
    client.release();
  }
}

export async function deactivateCurrentUser(
  req,
  res,
  next,
) {
  const client = await pool.connect();

  let transactionStarted = false;
  let profilePhotoFilename = null;

  try {
    const userId = getUserId(req);

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error: "Request body must be a JSON object",
      });
    }

    const { password } = req.body;

    if (password === undefined) {
      return res.status(400).json({
        error: "password is required",
      });
    }

    if (!isValidCurrentPassword(password)) {
      return res.status(400).json({
        error:
          "password must be a non-empty string no longer than 128 characters",
      });
    }

    await client.query("BEGIN");
    transactionStarted = true;

    const userResult = await client.query(
      `
      SELECT
        id,
        password_hash,
        profile_photo_filename
          AS "profilePhotoFilename"
      FROM users
      WHERE id = $1
        AND is_active = true
      FOR UPDATE;
      `,
      [userId],
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "User not found",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      userResult.rows[0].password_hash,
    );

    if (!passwordMatches) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(401).json({
        error: "Password is incorrect",
      });
    }

    const activeBookingResult =
      await client.query(
        `
        SELECT id
        FROM bookings
        WHERE (
          owner_id = $1
          OR sitter_id = $1
        )
          AND status IN (
            'pending',
            'accepted'
          )
        LIMIT 1;
        `,
        [userId],
      );

    if (activeBookingResult.rows.length > 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        error:
          "Account cannot be deactivated while active bookings exist",
      });
    }

    profilePhotoFilename =
      userResult.rows[0]
        .profilePhotoFilename;

    await client.query(
      `
      UPDATE users
      SET
        is_active = false,
        deactivated_at = NOW(),
        profile_photo_filename = NULL,
        profile_photo_content_type = NULL
      WHERE id = $1;
      `,
      [userId],
    );

    await client.query("COMMIT");
    transactionStarted = false;

    await deleteStoredProfilePhotoSafely(
      profilePhotoFilename,
      "account deactivation",
    );

    res.status(200).json({
      message: "Account deactivated successfully",
    });
  } catch (error) {
    const rollbackError =
      transactionStarted
        ? await rollbackSafely(client)
        : null;

    if (rollbackError) {
      next(rollbackError);
      return;
    }

    next(error);
  } finally {
    client.release();
  }
}