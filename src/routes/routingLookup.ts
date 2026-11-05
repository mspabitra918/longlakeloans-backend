import { Router, Request, Response } from "express";
import { isValidRoutingNumber, lookupRouting } from "../routingDb";

const router = Router();

// GET /api/routing-lookup — Bank routing number / IFSC code lookup
router.get("/", async (req: Request, res: Response) => {
  try {
    const routing = req.query.routing as string;
    const type = (req.query.type as string) || "routing";

    if (!routing) {
      res.status(400).json({ error: "Missing routing/IFSC parameter" });
      return;
    }

    // IFSC Code lookup (India)
    if (type === "ifsc") {
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(routing)) {
        res.status(400).json({
          error:
            "Invalid IFSC code. Format: 4 letters + 0 + 6 alphanumeric characters",
        });
        return;
      }

      const response = await fetch(
        `https://ifsc.razorpay.com/${routing.toUpperCase()}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          res.json({
            bankName: "",
            branch: "",
            city: "",
            state: "",
            valid: false,
            error: "IFSC code not found",
          });
          return;
        }
        res.status(502).json({ error: "Unable to look up IFSC code" });
        return;
      }

      const data = (await response.json()) as Record<string, string>;

      res.json({
        bankName: data.BANK || "",
        branch: data.BRANCH || "",
        city: data.CITY || "",
        state: data.STATE || "",
        valid: true,
      });
      return;
    }

    // US Routing Number lookup
    if (!/^\d{9}$/.test(routing)) {
      res.status(400).json({
        error: "Invalid routing number. Must be 9 digits.",
      });
      return;
    }

    // Validate checksum first (ABA Mod 10)
    if (!isValidRoutingNumber(routing)) {
      res.json({
        bankName: "",
        city: "",
        state: "",
        valid: false,
        error: "Invalid routing number (checksum failed)",
      });
      return;
    }

    // 1. Try local database first (instant, no network)
    const localResult = lookupRouting(routing);
    if (localResult) {
      res.json({
        bankName: localResult.bankName,
        city: localResult.city || "",
        state: localResult.state || "",
        valid: true,
      });
      return;
    }

    // 2. Routing number passes checksum but not in our local DB
    //    Return valid=true with empty bankName so the user can enter manually
    res.json({
      bankName: "",
      city: "",
      state: "",
      valid: true,
      error:
        "Routing number is valid but bank name not found. Please enter manually.",
    });
  } catch {
    res.status(500).json({ error: "Lookup failed" });
  }
});

export default router;
