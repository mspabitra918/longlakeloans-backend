import "dotenv/config";

import fs from "fs";
import path from "path";
import { pool } from "./db";

/**
 * One-off: applies migrations/004 — creates `drip_email_schedule` in the live
 * database and backfills applications BullMQ was still chasing. Safe to re-run.
 * Run with:
 *   npm run db:drip-schedule
 */
async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, "migrations", "004_drip_email_schedule.sql"),
    "utf-8",
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    const counts = await client.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count
       FROM drip_email_schedule GROUP BY status ORDER BY status`,
    );
    console.log("drip_email_schedule ready. Rows by status:");
    for (const row of counts.rows) {
      console.log(`  ${row.status}: ${row.count}`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed to apply drip_email_schedule migration:", err);
  process.exit(1);
});
