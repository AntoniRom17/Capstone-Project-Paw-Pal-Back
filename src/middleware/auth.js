import jwt from "jsonwebtoken";
import { query } from "../db/client.js";

export async function requireAuth(
  req,
  res,
  next,
) {
  const header = req.headers.authorization;

  if (
    !header ||
    !header.startsWith("Bearer ")
  ) {
    return res.status(401).json({
      error: "Login required",
    });
  }

  const token = header.slice(7);

  let payload;

  try {
    payload = jwt.verify(
      token,
      process.env.JWT_SECRET,
    );
  } catch {
    return res.status(401).json({
      error: "Invalid or expired token",
    });
  }

  try {
    const result = await query(
      `
      SELECT
        id,
        role
      FROM users
      WHERE id = $1
        AND is_active = true;
      `,
      [payload.id || payload.userId],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error:
          "Account is inactive or no longer exists",
      });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Login required",
      });
    }

    if (req.user.role !== role) {
      return res.status(403).json({
        error: `Only ${role}s can do this`,
      });
    }

    next();
  };
}