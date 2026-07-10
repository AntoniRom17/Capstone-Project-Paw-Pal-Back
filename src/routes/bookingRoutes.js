import { Router } from "express";
import {
  createBooking,
  getBookings,
  updateBookingStatus,
} from "../controllers/bookingController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.post("/", requireAuth, requireRole("owner"), createBooking);
router.get("/", requireAuth, getBookings);
router.patch("/:id/status", requireAuth, updateBookingStatus);

export default router;
