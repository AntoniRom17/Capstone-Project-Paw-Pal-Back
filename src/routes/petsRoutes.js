import { Router } from "express";
import {
  createPet,
  deletePet,
  deletePetPhotoFile,
  getPetById,
  getPetPhotoFile,
  getPets,
  updatePet,
  uploadPetPhotoFile,
} from "../controllers/petsController.js";
import {
  requireAuth,
  requireRole,
} from "../middleware/auth.js";
import {
  uploadPetPhoto,
} from "../middleware/petPhotoUpload.js";

const router = Router();

const ownerOnly = [
  requireAuth,
  requireRole("owner"),
];

router.get(
  "/",
  ...ownerOnly,
  getPets,
);

router.post(
  "/",
  ...ownerOnly,
  createPet,
);

router.post(
  "/:id/photo",
  ...ownerOnly,
  uploadPetPhoto,
  uploadPetPhotoFile,
);

router.get(
  "/:id/photo",
  ...ownerOnly,
  getPetPhotoFile,
);

router.delete(
  "/:id/photo",
  ...ownerOnly,
  deletePetPhotoFile,
);

router.get(
  "/:id",
  ...ownerOnly,
  getPetById,
);

router.put(
  "/:id",
  ...ownerOnly,
  updatePet,
);

router.delete(
  "/:id",
  ...ownerOnly,
  deletePet,
);

export default router;