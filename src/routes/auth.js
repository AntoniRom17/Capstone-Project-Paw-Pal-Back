import "dotenv/config";
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "../db/client.js";

const router = Router();

function makeToken(user) {
  if (!process.env.JWT_SECRET) {
    const error = new Error("JWT_SECRET is not configured");
    error.status = 500;
    throw error;
  }

  return jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  );
}

router.post("/register", async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      role,
      city,
      state,
      zipCode,
      phone,
      bio,
    } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      !role ||
      !city ||
      !state ||
      !zipCode
    ) {
      return res.status(400).json({
        error:
          "name, email, password, role, city, state, and zipCode are required",
      });
    }

    if (!["owner", "sitter"].includes(role)) {
      return res.status(400).json({
        error: "role must be 'owner' or 'sitter'",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "password must be at least 8 characters",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedState = state.trim().toUpperCase();
    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await query(
      `
      INSERT INTO users (
        name,
        email,
        password_hash,
        role,
        bio,
        phone,
        city,
        state,
        zip_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING
        id,
        name,
        email,
        role,
        bio,
        phone,
        city,
        state,
        zip_code AS "zipCode";
      `,
      [
        name.trim(),
        normalizedEmail,
        passwordHash,
        role,
        bio || null,
        phone || null,
        city.trim(),
        normalizedState,
        String(zipCode).trim(),
      ],
    );

    const user = rows[0];

    res.status(201).json({
      token: makeToken(user),
      user,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "An account with that email already exists",
      });
    }

    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "email and password are required",
      });
    }

    const { rows } = await query(
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
        password_hash
      FROM users
      WHERE email = $1;
      `,
      [email.trim().toLowerCase()],
    );

    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: "Invalid email or password",
      });
    }

    delete user.password_hash;

    res.status(200).json({
      token: makeToken(user),
      user,
    });
  } catch (error) {
    next(error);
  }
});

export default router;