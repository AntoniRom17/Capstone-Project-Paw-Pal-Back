import { Router } from "express";
import {
  getSitterAvailability,
  createAvailability,
  updateAvailability,
  deleteAvailability
} from "../controllers/availabilityController.js";

import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/sitters/:id/availability", getSitterAvailability);
router.post("/availability", requireAuth, requireRole("sitter"), createAvailability);
router.put("/availability/:id", requireAuth, requireRole("sitter"), updateAvailability);
router.delete("/availability/:id", requireAuth, requireRole("sitter"), deleteAvailability);

export default router;