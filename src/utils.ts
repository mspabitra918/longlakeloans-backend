import { queryOne } from "./db";
import { PoolClient } from "pg";

/**
 * Generates a random 5-digit numeric string
 */
export function generate5DigitCode(): string {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

/**
 * Generates a unique 5-digit ID for a given table
 */
export async function generateUniqueId(
  table: string,
  column: string = "id",
  client?: any,
): Promise<string> {
  let id = generate5DigitCode();
  let exists = true;

  while (exists) {
    const queryStr = `SELECT ${column} FROM ${table} WHERE ${column} = $1`;
    let row;

    if (client) {
      const res = await client.query(queryStr, [id]);
      // Handle both raw PoolClient and wrapped client from db.transaction
      row = Array.isArray(res) ? res[0] : res.rows?.[0];
    } else {
      row = await queryOne(queryStr, [id]);
    }

    if (!row) {
      exists = false;
    } else {
      id = generate5DigitCode();
    }
  }

  return id;
}
