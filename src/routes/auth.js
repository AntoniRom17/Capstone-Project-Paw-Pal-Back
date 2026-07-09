import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "../db/client.js";

const router = Router();

// Helper: create a token containing the user's id and role
function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

// POST /api/auth/register
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ error: "name, email, password, and role are required" });
    }
    if (!["owner", "sitter"].includes(role)) {
      return res
        .status(400)
        .json({ error: "role must be 'owner' or 'sitter'" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [name, email, passwordHash, role],
    );
    const user = rows[0];

    res.status(201).json({ token: makeToken(user), user });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(400)
        .json({ error: "An account with that email already exists" });
    }
    next(err);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const { rows } = await query(
      `SELECT id, name, email, role, password_hash FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];

    // Same error for "no such user" and "wrong password" — don't help attackers guess emails
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    delete user.password_hash;
    res.status(200).json({ token: makeToken(user), user });
  } catch (err) {
    next(err);
  }
});

export default router;
