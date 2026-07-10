import { Router } from "express";
import {
  getPets,
  createPet,
  getPetById,
  updatePet,
  deletePet,
} from "../controllers/petsController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, requireRole("owner"), getPets);
router.post("/", requireAuth, requireRole("owner"), createPet);
router.get("/:id", requireAuth, requireRole("owner"), getPetById);
router.put("/:id", requireAuth, requireRole("owner"), updatePet);
router.delete("/:id", requireAuth, requireRole("owner"), deletePet);

export default router;