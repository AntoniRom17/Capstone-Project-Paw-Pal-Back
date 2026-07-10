import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import authRouter from "./routes/auth.js";
import servicesRoutes from "./routes/servicesRoutes.js";
import sittersRoutes from "./routes/sittersRoutes.js";
import petsRoutes from "./routes/petsRoutes.js";
import availabilityRoutes from "./routes/availabilityRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import reviewsRoutes from "./routes/reviewsRoutes.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  }),
);
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "PawPal backend is running",
    environment: process.env.NODE_ENV || "development",
  });
});

app.use("/api/auth", authRouter);
app.use("/api/services", servicesRoutes);
app.use("/api/sitters", sittersRoutes);
app.use("/api/pets", petsRoutes);
app.use("/api", availabilityRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/reviews", reviewsRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`PawPal backend running on port ${PORT}`);
});
