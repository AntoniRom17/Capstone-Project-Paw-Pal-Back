import { Router } from "express";
import {
  getSitterAvailability,
  createAvailability
} from "../controllers/availabilityController.js";

import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/sitters/:id/availability", getSitterAvailability);
router.post("/availability", requireAuth, requireRole("sitter"), createAvailability);

export default router;