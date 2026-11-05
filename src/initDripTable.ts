import "dotenv/config";

import { pool } from "./db";

/**
 * One-off: creates the bank-verification drip log table (and its index) in the
 * live database. Safe to re-run — uses IF NOT EXISTS. Run with:
 *   npx tsx src/initDripTable.ts
 */
async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS drip_email_log (
        id SERIAL PRIMARY KEY,
        application_id VARCHAR(5) NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
        email_number INTEGER NOT NULL CHECK (email_number BETWEEN 1 AND 99),
        status_at_send VARCHAR(30) NOT NULL,
        sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE (application_id, email_number)
      );
    `);
    // Widen the range on databases created before the call track (11-14) existed.
    await client.query(
      `ALTER TABLE drip_email_log DROP CONSTRAINT IF EXISTS drip_email_log_email_number_check;`,
    );
    await client.query(
      `ALTER TABLE drip_email_log ADD CONSTRAINT drip_email_log_email_number_check
         CHECK (email_number BETWEEN 1 AND 99);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_drip_email_log_application ON drip_email_log(application_id);`,
    );

    const check = await client.query(
      `SELECT to_regclass('public.drip_email_log') AS tbl`,
    );
    console.log(`drip_email_log ready: ${check.rows[0].tbl}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed to create drip_email_log:", err);
  process.exit(1);
});
