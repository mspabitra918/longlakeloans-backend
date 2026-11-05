import { Router, Request, Response } from "express";
import { rateLimit } from "../auth";
import { contactSchema, sanitizeInput } from "../validation";
import { query } from "../db";
import { generateUniqueId } from "../utils";
import { sendDiscordNotification } from "../services/discordService";

const router = Router();

// POST /api/contact — Submit contact form
router.post("/", async (req: Request, res: Response) => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown";

    // Rate limit: 5 contact submissions per IP per hour
    const rl = rateLimit(`contact:${ip}`, 5, 3600000);
    if (!rl.allowed) {
      res
        .status(429)
        .set("Retry-After", String(Math.ceil(rl.resetIn / 1000)))
        .json({ error: "Too many submissions. Please try again later." });
      return;
    }

    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || "Invalid input",
      });
      return;
    }

    const { name, email, subject, message } = parsed.data;

    const sanitizedData = {
      name: sanitizeInput(name).slice(0, 100),
      email: sanitizeInput(email).slice(0, 255),
      subject: sanitizeInput(subject).slice(0, 100),
      message: sanitizeInput(message).slice(0, 2000),
      ipAddress: ip,
    };

    try {
      await query(
        `INSERT INTO contact_messages (name, email, subject, message, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
        [
          sanitizedData.name,
          sanitizedData.email,
          sanitizedData.subject,
          sanitizedData.message,
          sanitizedData.ipAddress,
        ],
      );
    } catch (dbError) {
      console.error("Contact message DB insert failed:", dbError);
    }

    // Send Discord notification
    try {
      await sendDiscordNotification(
        `✉️ **New Contact Message**\n` +
          `**Name:** ${sanitizedData.name}\n` +
          `**Email:** ${sanitizedData.email}\n` +
          `**Subject:** ${sanitizedData.subject}\n` +
          `**Message:** ${sanitizedData.message}`,
      );
    } catch (err) {
      console.error("Discord notification error:", err);
    }

    res.json({
      success: true,
      message: "Message sent successfully. We'll respond within 24 hours.",
    });
  } catch (error) {
    console.error("Contact form error:", error);
    res
      .status(500)
      .json({ error: "Failed to send message. Please try again." });
  }
});

export default router;
