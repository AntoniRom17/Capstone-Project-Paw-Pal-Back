import { Router } from "express";
import {
  updateBackgroundCheckStatus,
} from "../controllers/backgroundChecksController.js";

const router = Router();

router.patch(
  "/:sitterId",
  updateBackgroundCheckStatus,
);

export default router;