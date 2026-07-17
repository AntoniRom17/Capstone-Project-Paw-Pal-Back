import { Router } from "express";
import {
  changePassword,
  deactivateCurrentUser,
  deleteCurrentUserProfilePhoto,
  getCurrentUser,
  getUserProfilePhotoFile,
  updateCurrentUser,
  uploadCurrentUserProfilePhoto,
} from "../controllers/usersController.js";
import { requireAuth } from "../middleware/auth.js";
import {
  uploadProfilePhoto,
} from "../middleware/profilePhotoUpload.js";

const router = Router();

router.get(
  "/:id/photo",
  getUserProfilePhotoFile,
);

router.use(requireAuth);

router.get(
  "/me",
  getCurrentUser,
);

router.patch(
  "/me",
  updateCurrentUser,
);

router.patch(
  "/me/password",
  changePassword,
);

router.post(
  "/me/photo",
  uploadProfilePhoto,
  uploadCurrentUserProfilePhoto,
);

router.delete(
  "/me/photo",
  deleteCurrentUserProfilePhoto,
);

router.delete(
  "/me",
  deactivateCurrentUser,
);

export default router;