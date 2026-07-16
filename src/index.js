import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import authRouter from "./routes/auth.js";
import usersRoutes from "./routes/usersRoutes.js";
import servicesRoutes from "./routes/servicesRoutes.js";
import sittersRoutes from "./routes/sittersRoutes.js";
import petsRoutes from "./routes/petsRoutes.js";
import availabilityRoutes from "./routes/availabilityRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import reviewsRoutes from "./routes/reviewsRoutes.js";
import messagesRoutes from "./routes/messagesRoutes.js";
import backgroundChecksRoutes from "./routes/backgroundChecksRoutes.js";

const app = express();
const PORT = process.env.PORT || 3000;

const DATABASE_ERROR_RESPONSES = {
  "22001": {
    status: 400,
    message: "A value exceeds the allowed length",
  },
  "22P02": {
    status: 400,
    message: "Invalid request data",
  },
  "23502": {
    status: 400,
    message: "A required value is missing",
  },
  "23503": {
    status: 409,
    message:
      "The request conflicts with related data",
  },
  "23505": {
    status: 409,
    message:
      "A record with those values already exists",
  },
  "23514": {
    status: 400,
    message:
      "The request violates a data rule",
  },
  "23P01": {
    status: 409,
    message:
      "The request conflicts with existing data",
  },
};

const PRODUCTION_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  405: "Method not allowed",
  409: "Conflict",
  413: "Request body is too large",
  415: "Unsupported media type",
  429: "Too many requests",
};

function isPostgresError(error) {
  return (
    typeof error?.code === "string" &&
    /^[0-9A-Z]{5}$/.test(error.code) &&
    typeof error?.severity === "string"
  );
}

function getErrorResponse(error) {
  if (error?.type === "entity.parse.failed") {
    return {
      status: 400,
      message:
        "Request body contains invalid JSON",
    };
  }

  if (error?.type === "entity.too.large") {
    return {
      status: 413,
      message: "Request body is too large",
    };
  }

  const databaseResponse =
    DATABASE_ERROR_RESPONSES[error?.code];

  if (databaseResponse) {
    return databaseResponse;
  }

  if (isPostgresError(error)) {
    return {
      status: 500,
      message: "Internal server error",
    };
  }

  const requestedStatus = Number(error?.status);

  const status =
    Number.isInteger(requestedStatus) &&
    requestedStatus >= 400 &&
    requestedStatus <= 599
      ? requestedStatus
      : 500;

  if (status >= 500) {
    return {
      status,
      message: "Internal server error",
    };
  }

  if (
    process.env.NODE_ENV !== "production" &&
    typeof error?.message === "string" &&
    error.message.trim()
  ) {
    return {
      status,
      message: error.message,
    };
  }

  return {
    status,
    message:
      PRODUCTION_ERROR_MESSAGES[status] ||
      "Request failed",
  };
}

app.use(
  cors({
    origin:
      process.env.CLIENT_URL ||
      "http://localhost:5173",
  }),
);

app.use(
  express.json({
    limit: "1mb",
  }),
);

app.use(morgan("dev"));

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "PawPal backend is running",
    environment:
      process.env.NODE_ENV || "development",
  });
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/sitters", sittersRoutes);
app.use("/api/pets", petsRoutes);
app.use("/api", availabilityRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/messages", messagesRoutes);
app.use(
  "/api/background-checks",
  backgroundChecksRoutes,
);

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

app.use((error, req, res, next) => {
  const response = getErrorResponse(error);

  console.error("Unhandled request error", {
    method: req.method,
    path: req.originalUrl,
    status: response.status,
    code: error?.code,
    message: error?.message,
    stack: error?.stack,
  });

  res.status(response.status).json({
    error: response.message,
  });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(
      `PawPal backend running on port ${PORT}`,
    );
  });
}

export default app;