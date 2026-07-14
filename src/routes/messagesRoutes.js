import { Router } from "express";
import {
  createMessage,
  getBookingMessages,
  getConversations,
} from "../controllers/messagesController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/", getConversations);
router.get("/:bookingId", getBookingMessages);
router.post("/", createMessage);

export default router;