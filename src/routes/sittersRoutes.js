import { Router } from "express";
import {
  getSitters,
  getSitterById,
  addSitterService,
} from "../controllers/sittersController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", getSitters);
router.post(
  "/me/services",
  requireAuth,
  requireRole("sitter"),
  addSitterService,
);
router.get("/:id", getSitterById);

export default router;