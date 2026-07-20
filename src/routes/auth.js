import "dotenv/config";
import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "../db/client.js";
import {
  isPlainObject,
  isStringWithinLength,
  isValidEmail,
  isValidState,
  isValidZipCode,
} from "../utils/validation.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function hashResetToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function makeToken(user) {
  if (!process.env.JWT_SECRET) {
    const error = new Error("JWT_SECRET is not configured");
    error.status = 500;
    throw error;
  }

  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function parseOptionalString(value, field, maxLength) {
  if (value === undefined || value === null)
    return { value: null, error: null };
  if (typeof value !== "string")
    return { value: null, error: `${field} must be a string` };
  const normalizedValue = value.trim();
  if (normalizedValue.length > maxLength)
    return {
      value: null,
      error: `${field} cannot exceed ${maxLength} characters`,
    };
  return { value: normalizedValue || null, error: null };
}

router.post("/register", async (req, res, next) => {
  try {
    if (!isPlainObject(req.body))
      return res
        .status(400)
        .json({ error: "Request body must be a JSON object" });

    const { name, email, password, role, city, state, zipCode, phone, bio } =
      req.body;

    if (!name || !email || !password || !role || !city || !state || !zipCode)
      return res.status(400).json({
        error:
          "name, email, password, role, city, state, and zipCode are required",
      });

    if (!isStringWithinLength(name, { min: 1, max: 100 }))
      return res.status(400).json({
        error: "name must be a non-empty string no longer than 100 characters",
      });

    if (!isValidEmail(email))
      return res
        .status(400)
        .json({ error: "email must be a valid email address" });

    if (
      typeof password !== "string" ||
      password.trim().length < 8 ||
      password.length > 128
    )
      return res.status(400).json({
        error: "password must be a string between 8 and 128 characters",
      });

    const normalizedRole = role.trim().toLowerCase();
    if (!["owner", "sitter"].includes(normalizedRole))
      return res
        .status(400)
        .json({ error: "role must be 'owner' or 'sitter'" });

    if (!isStringWithinLength(city, { min: 1, max: 100 }))
      return res.status(400).json({
        error: "city must be a non-empty string no longer than 100 characters",
      });

    if (!isValidState(state))
      return res
        .status(400)
        .json({ error: "state must be a two-letter abbreviation" });

    if (typeof zipCode !== "string" || !isValidZipCode(zipCode))
      return res
        .status(400)
        .json({ error: "zipCode must use 12345 or 12345-6789 format" });

    const parsedPhone = parseOptionalString(phone, "phone", 20);
    if (parsedPhone.error)
      return res.status(400).json({ error: parsedPhone.error });

    const parsedBio = parseOptionalString(bio, "bio", 2000);
    if (parsedBio.error)
      return res.status(400).json({ error: parsedBio.error });

    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await query(
      `
      INSERT INTO users (
        name, email, password_hash, role, bio, phone, city, state, zip_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, email, role, bio, phone, city, state, zip_code AS "zipCode",
        (profile_photo_filename IS NOT NULL) AS "hasProfilePhoto",
        is_active AS "isActive";
      `,
      [
        name.trim(),
        email.trim().toLowerCase(),
        passwordHash,
        normalizedRole,
        parsedBio.value,
        parsedPhone.value,
        city.trim(),
        state.trim().toUpperCase(),
        zipCode.trim(),
      ],
    );

    const user = rows[0];
    res.status(201).json({ token: makeToken(user), user });
  } catch (error) {
    if (error.code === "23505")
      return res
        .status(409)
        .json({ error: "An account with that email already exists" });
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    if (!isPlainObject(req.body))
      return res
        .status(400)
        .json({ error: "Request body must be a JSON object" });

    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });
    if (!isValidEmail(email))
      return res
        .status(400)
        .json({ error: "email must be a valid email address" });

    const normalizedEmail = email.trim().toLowerCase();

    const { rows } = await query(
      `
      SELECT id, name, email, role, bio, phone, city, state, zip_code AS "zipCode",
        (profile_photo_filename IS NOT NULL) AS "hasProfilePhoto",
        is_active AS "isActive", password_hash
      FROM users
      WHERE email = $1 AND is_active = true;
      `,
      [normalizedEmail],
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: "Invalid email or password" });

    delete user.password_hash;
    res.status(200).json({ token: makeToken(user), user });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `
      SELECT id, name, email, role, bio, phone, city, state, zip_code AS "zipCode",
        (profile_photo_filename IS NOT NULL) AS "hasProfilePhoto",
        is_active AS "isActive"
      FROM users
      WHERE id = $1;
      `,
      [req.user.id],
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put("/me", requireAuth, async (req, res, next) => {
  try {
    const { bio, phone, city, state } = req.body;

    const { rows } = await query(
      `
      UPDATE users
      SET bio = $1, phone = $2, city = $3, state = $4
      WHERE id = $5
      RETURNING id, name, email, role, bio, phone, city, state, zip_code AS "zipCode",
        (profile_photo_filename IS NOT NULL) AS "hasProfilePhoto",
        is_active AS "isActive";
      `,
      [bio, phone, city, state, req.user.id],
    );

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/forgot-password",
  async (req, res, next) => {
    try {
      if (!isPlainObject(req.body)) {
        return res.status(400).json({
          error:
            "Request body must be a JSON object",
        });
      }

      const { email } = req.body;

      if (
        email === undefined ||
        !isValidEmail(email)
      ) {
        return res.status(400).json({
          error:
            "email must be a valid email address",
        });
      }

      const normalizedEmail = email
        .trim()
        .toLowerCase();

      const { rows } = await query(
        `
        SELECT id
        FROM users
        WHERE email = $1
          AND is_active = true;
        `,
        [normalizedEmail],
      );

      const user = rows[0];
      const responseBody = {
        message:
          "If an account exists for that email, a password reset link has been sent.",
      };

      if (user) {
        const rawToken = crypto
          .randomBytes(32)
          .toString("hex");

        const tokenHash =
          hashResetToken(rawToken);

        const expiresAt = new Date(
          Date.now() +
            PASSWORD_RESET_TTL_MS,
        );

        await query(
          `
          UPDATE users
          SET
            password_reset_token_hash = $1,
            password_reset_expires_at = $2
          WHERE id = $3;
          `,
          [
            tokenHash,
            expiresAt,
            user.id,
          ],
        );

        const clientUrl = (
          process.env.CLIENT_URL ||
          "http://localhost:5173"
        ).replace(/\/+$/, "");

        const resetLink = `${clientUrl}/reset-password?token=${rawToken}`;

        // No email provider is configured for this project yet, so the
        // reset link is logged (and, outside production, returned in the
        // response) as a stand-in for actually emailing it.
        console.log(
          `Password reset link for ${normalizedEmail}: ${resetLink}`,
        );

        if (
          process.env.NODE_ENV !==
          "production"
        ) {
          responseBody.resetLink =
            resetLink;
        }
      }

      res.status(200).json(responseBody);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/reset-password",
  async (req, res, next) => {
    try {
      if (!isPlainObject(req.body)) {
        return res.status(400).json({
          error:
            "Request body must be a JSON object",
        });
      }

      const { token, password } = req.body;

      if (
        typeof token !== "string" ||
        token.trim().length === 0
      ) {
        return res.status(400).json({
          error: "token is required",
        });
      }

      if (
        typeof password !== "string" ||
        password.trim().length === 0 ||
        password.length < 8 ||
        password.length > 128
      ) {
        return res.status(400).json({
          error:
            "password must be a string between 8 and 128 characters",
        });
      }

      const tokenHash = hashResetToken(
        token.trim(),
      );

      const { rows } = await query(
        `
        SELECT id
        FROM users
        WHERE password_reset_token_hash = $1
          AND password_reset_expires_at > NOW()
          AND is_active = true;
        `,
        [tokenHash],
      );

      const user = rows[0];

      if (!user) {
        return res.status(400).json({
          error:
            "This password reset link is invalid or has expired",
        });
      }

      const passwordHash = await bcrypt.hash(
        password,
        10,
      );

      await query(
        `
        UPDATE users
        SET
          password_hash = $1,
          password_reset_token_hash = NULL,
          password_reset_expires_at = NULL
        WHERE id = $2;
        `,
        [passwordHash, user.id],
      );

      res.status(200).json({
        message:
          "Password has been reset. You can now log in.",
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
