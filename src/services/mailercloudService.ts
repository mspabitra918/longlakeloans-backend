import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465",
  requireTLS:
    process.env.SMTP_SECURE !== "true" && process.env.SMTP_PORT !== "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail({
  to,
  subject,
  html,
  text,
  campaignId = process.env.MAILERCLOUD_CAMPAIGN_ID,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  campaignId?: string;
}) {
  const missing = [
    ["SMTP_HOST", process.env.SMTP_HOST],
    ["SMTP_USER", process.env.SMTP_USER],
    ["SMTP_PASS", process.env.SMTP_PASS],
    [
      "MAILERCLOUD_FROM_EMAIL or FROM_EMAIL",
      process.env.MAILERCLOUD_FROM_EMAIL || process.env.FROM_EMAIL,
    ],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Email is not configured; missing: ${missing.join(", ")}`);
  }

  // MailerCloud rejects the mld-track-* headers unless a campaign id comes with
  // them, so tracking is only requested when one is configured.
  const headers = campaignId
    ? {
        "mld-track-campaign-id": campaignId,
        "mld-track-opens": "true",
        "mld-track-clicks": "true",
        "mld-track-inbox": "true",
      }
    : undefined;

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME || process.env.MAILERCLOUD_FROM_NAME || "LongLake Loans"}" <${process.env.FROM_EMAIL || process.env.MAILERCLOUD_FROM_EMAIL}>`,
      to,
      subject,
      html,
      text,
      headers,
    });

    console.log(`Email sent to ${to}: ${info.messageId}`);

    return info;
  } catch (err) {
    console.error("MailerCloud SMTP Error:", err);
    throw err;
  }
}
