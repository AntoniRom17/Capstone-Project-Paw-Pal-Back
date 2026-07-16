import { Router } from "express";
import {
  getCurrentUser,
  updateCurrentUser,
} from "../controllers/usersController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/me", getCurrentUser);
router.patch("/me", updateCurrentUser);

export default router;