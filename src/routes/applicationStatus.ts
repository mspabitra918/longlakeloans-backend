import { Router, Request, Response } from "express";
import { rateLimit } from "../auth";
import { getApplicationByIdAndEmail } from "../services/applicationService";

const router = Router();

// GET /api/application-status?id=...&email=...
router.get("/", async (req: Request, res: Response) => {
  try {
    // const ip =
    //   (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    //   req.ip ||
    //   "unknown";

    // // Rate limit: 10 lookups per minute per IP
    // const rl = rateLimit(`status-lookup:${ip}`, 10, 60000);
    // if (!rl.allowed) {
    //   res
    //     .status(429)
    //     .set("Retry-After", String(Math.ceil(rl.resetIn / 1000)))
    //     .json({ error: "Too many requests. Please try again later." });
    //   return;
    // }

    const id = req.query.id as string;
    const email = req.query.email as string;

    if (!id || !email) {
      res.status(400).json({ error: "Application ID and email are required" });
      return;
    }

    // Basic 5-digit code format check
    const codeRegex = /^\d{5}$/;
    if (!codeRegex.test(id)) {
      res.status(400).json({ error: "Invalid application ID format" });
      return;
    }

    const application = await getApplicationByIdAndEmail(id, email);

    if (!application) {
      res.status(404).json({
        error:
          "No application found. Please check your Application ID and email address.",
      });
      return;
    }

    res.json({
      success: true,
      application,
    });
  } catch (error) {
    console.error("Application status lookup error:", error);
    res.status(500).json({ error: "Failed to retrieve application status" });
  }
});

export default router;
