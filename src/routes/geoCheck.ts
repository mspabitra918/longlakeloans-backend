import { Router, Request, Response } from "express";

const ALLOWED_COUNTRIES = ["US", "PK", "IN"];

const router = Router();

// GET /api/geo-check — Check geolocation & eligibility
router.get("/", async (req: Request, res: Response) => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "127.0.0.1";

    // In development, allow all
    if (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "unknown" ||
      ip === "::ffff:127.0.0.1"
    ) {
      res.json({
        allowed: true,
        country: "US",
        region: "Development",
      });
      return;
    }

    const geoResponse = await fetch(`https://ipapi.co/${ip}/json/`);

    if (!geoResponse.ok) {
      res.json({
        allowed: true,
        country: "unknown",
        region: "unknown",
      });
      return;
    }

    const geoData = (await geoResponse.json()) as Record<string, string>;
    const countryCode = geoData.country_code || "";

    res.json({
      allowed: ALLOWED_COUNTRIES.includes(countryCode),
      country: countryCode,
      region: geoData.region || "",
    });
  } catch {
    res.json({
      allowed: true,
      country: "unknown",
      region: "unknown",
    });
  }
});

export default router;
