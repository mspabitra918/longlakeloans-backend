import "dotenv/config";

import { pool } from "./db";
import fs from "fs";
import path from "path";

async function initDatabase() {
  console.log("Initializing LongLake Loans database...");
  console.log(
    `Database URL: ${process.env.DATABASE_URL?.replace(/:[^@]+@/, ":****@")}`,
  );

  try {
    // Read schema file
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");

    const client = await pool.connect();
    try {
      await client.query(schema);
      console.log("Database schema created successfully!");

      // Verify tables exist
      const tables = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);

      console.log("\nCreated tables:");
      for (const row of tables.rows) {
        console.log(`  - ${row.table_name}`);
      }
    } finally {
      client.release();
    }

    await pool.end();
    console.log("\nDatabase initialization complete!");
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
  }
}

initDatabase();
