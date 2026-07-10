import { Router } from "express";
import { createReview } from "../controllers/reviewsController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.post(
  "/",
  requireAuth,
  requireRole("owner"),
  createReview,
);

export default router;