import axios from "axios";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

export async function sendDiscordNotification(message: string) {
  try {
    if (!DISCORD_WEBHOOK_URL) {
      console.warn("Discord webhook URL not configured, skipping notification");
      return;
    }

    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
    console.log("Discord notification sent successfully");
  } catch (error) {
    console.error("Failed to send Discord notification:", error);
  }
}
