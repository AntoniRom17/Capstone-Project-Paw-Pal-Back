import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";

import servicesRoutes from "./routes/servicesRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "PawPal backend is running",
    environment: process.env.NODE_ENV || "development"
  });
});

// 404 handler
app.use("/api/services", servicesRoutes);
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.status || 500).json({
    error: err.message || "Internal server error"
  });
});

app.listen(PORT, () => {
  console.log(`PawPal backend running on port ${PORT}`);
});
