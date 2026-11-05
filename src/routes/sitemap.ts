import { Router, Request, Response } from "express";

const router = Router();

const getBaseUrl = () => {
  const configuredUrl = process.env.FRONTEND_URL || process.env.SITE_URL;
  if (!configuredUrl) {
    return "https://www.longlakeloans.com";
  }

  return configuredUrl.replace(/\/$/, "");
};

router.get("/sitemap.xml", (_req: Request, res: Response) => {
  const baseUrl = getBaseUrl();
  const urls = ["/", "/apply", "/contact"];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${baseUrl}${path}</loc></url>`).join("\n")}
</urlset>`;

  res.header("Content-Type", "application/xml; charset=utf-8");
  res.send(xml);
});

export default router;
