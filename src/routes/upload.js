import { Router } from "express";
import multer from "multer";
import path from "path";
import { query } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), "uploads/profiles"));
  },
  filename: (req, file, cb) => {
    cb(null, `${req.user.id}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });

router.post(
  "/profile-photo",
  requireAuth,
  upload.single("photo"),
  async (req, res, next) => {
    try {
      const filename = req.file.filename;
      await query(
        `UPDATE users SET profile_photo_filename = $1 WHERE id = $2`,
        [filename, req.user.id],
      );
      res.json({ success: true, filename });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
