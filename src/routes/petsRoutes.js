import { Router } from "express";
import { getPets, createPet } from "../controllers/petsController.js";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", requireAuth, requireRole("owner"), getPets);
router.post("/", requireAuth, requireRole("owner"), createPet);

export default router;