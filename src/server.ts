import "dotenv/config";

import express from "express";
import cors from "cors";

// import { validateEncryptionKey } from "./encryption";
import applyRoutes from "./routes/apply";
import contactRoutes from "./routes/contact";
import geoCheckRoutes from "./routes/geoCheck";
import routingLookupRoutes from "./routes/routingLookup";
import adminRoutes from "./routes/admin";
import applicationStatusRoutes from "./routes/applicationStatus";
import bankVerificationRoutes from "./routes/bankVerification";
import plaidRoutes from "./routes/plaid";
import sitemapRoutes from "./routes/sitemap";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./swagger";

const app = express();
const PORT = process.env.PORT || 5000;
app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }
  next();
});

// CORS — allow frontend
app.use(
  cors({
    origin: [
      "https://longlakeloans-admin-fe.vercel.app",
      "https://longlakeloans.com",
      "www.longlakeloans.com",
      "longlakeloans.com",
      process.env.FRONTEND_URL || "http://localhost:3000",
    ],
    credentials: true,
  }),
);

// Parse JSON bodies
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API docs — Swagger UI at /api/docs, raw spec at /api/docs.json
app.get("/api/docs.json", (_req, res) => {
  res.json(openApiSpec);
});
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "LongLake Loans API",
    swaggerOptions: { persistAuthorization: true },
  }),
);

// Routes
app.use("/api/applications", applyRoutes);
app.use("/api/apply", applyRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/geo-check", geoCheckRoutes);
app.use("/api/routing-lookup", routingLookupRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/application-status", applicationStatusRoutes);
app.use("/api/bank-verification", bankVerificationRoutes);
app.use("/api/plaid", plaidRoutes);
app.use(sitemapRoutes);

// 404 handler
app.get("/", (_req, res) => {
  res.json({
    status: "OK",
    message: "LongLake Loans API is running",
  });
});

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

// // Verify required runtime config before starting the server.
// validateEncryptionKey();

// Only listen when running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`LongLake Loans Backend running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

export default app;
