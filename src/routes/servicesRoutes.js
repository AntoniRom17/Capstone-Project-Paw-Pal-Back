import { Router } from "express";
import { getServices } from "../controllers/servicesController.js";

const router = Router();

router.get("/", getServices);

export default router;