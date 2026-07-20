import { Router } from "express";
import {
  addVaccination,
  deleteVaccination,
  getPetHealth,
  updatePetHealth,
  updateVaccination,
} from "../controllers/petHealthController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

const ownerOnly = [requireAuth, requireRole("owner")];

router.get("/:id/health", ...ownerOnly, getPetHealth);
router.put("/:id/health", ...ownerOnly, updatePetHealth);
router.post("/:id/vaccinations", ...ownerOnly, addVaccination);
router.put(
  "/:id/vaccinations/:vaccinationId",
  ...ownerOnly,
  updateVaccination,
);
router.delete(
  "/:id/vaccinations/:vaccinationId",
  ...ownerOnly,
  deleteVaccination,
);

export default router;
