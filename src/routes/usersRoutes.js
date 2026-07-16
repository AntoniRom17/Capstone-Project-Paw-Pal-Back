import { Router } from "express";
import {
  changePassword,
  deactivateCurrentUser,
  getCurrentUser,
  updateCurrentUser,
} from "../controllers/usersController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/me", getCurrentUser);
router.patch("/me", updateCurrentUser);
router.patch("/me/password", changePassword);
router.delete("/me", deactivateCurrentUser);

export default router;