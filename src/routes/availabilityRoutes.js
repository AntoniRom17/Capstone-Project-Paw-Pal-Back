import { Router } from "express";
import { getSitterAvailability } from "../controllers/availabilityController.js";

const router = Router();

router.get("/sitters/:id/availability", getSitterAvailability);

export default router;