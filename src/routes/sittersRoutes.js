import { Router } from "express";
import {
  getSitters,
  getSitterById,
  addSitterService,
  updateSitterService,
  deleteSitterService,
} from "../controllers/sittersController.js";
import {
  submitBackgroundCheck,
} from "../controllers/backgroundChecksController.js";
import {
  requireAuth,
  requireRole,
} from "../middleware/auth.js";

const router = Router();

router.get("/", getSitters);

router.post(
  "/me/background-check",
  requireAuth,
  requireRole("sitter"),
  submitBackgroundCheck,
);

router.post(
  "/me/services",
  requireAuth,
  requireRole("sitter"),
  addSitterService,
);

router.patch(
  "/me/services/:id",
  requireAuth,
  requireRole("sitter"),
  updateSitterService,
);

router.delete(
  "/me/services/:id",
  requireAuth,
  requireRole("sitter"),
  deleteSitterService,
);

router.get("/:id", getSitterById);

export default router;