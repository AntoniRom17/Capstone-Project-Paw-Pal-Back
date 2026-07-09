import jwt from "jsonwebtoken";

// Checks the wristband. Protected routes use this before their handler runs.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Login required" });
  }

  const token = header.slice(7); // everything after "Bearer "

  try {
    // Verifies the signature AND checks expiry. Payload = { id, role }
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Optional stricter bouncer: requireRole("sitter") for sitter-only routes
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    if (req.user.role !== role) {
      return res.status(403).json({ error: `Only ${role}s can do this` });
    }
    next();
  };
}
