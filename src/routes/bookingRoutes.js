import { Router } from "express";
import {
  createBooking,
  getBackupSitters,
  getBookings,
  updateBookingStatus,
} from "../controllers/bookingController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.post("/", requireAuth, requireRole("owner"), createBooking);
router.get("/", requireAuth, getBookings);
router.patch("/:id/status", requireAuth, updateBookingStatus);
router.get(
  "/:id/backup-sitters",
  requireAuth,
  requireRole("owner"),
  getBackupSitters,
);

export default router;
