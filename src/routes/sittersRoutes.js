import { Router } from "express";
import {
  getSitters,
  getSitterById
} from "../controllers/sittersController.js";

const router = Router();

router.get("/", getSitters);
router.get("/:id", getSitterById);

export default router;