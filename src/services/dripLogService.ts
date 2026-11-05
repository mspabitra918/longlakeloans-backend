import { query } from "../db";

/**
 * Records a drip email as sent. Returns true if this call actually inserted the
 * row (i.e. the email had not been sent before). The UNIQUE(application_id,
 * email_number) constraint makes this an atomic idempotency guard, so even if a
 * BullMQ job runs twice the borrower only receives each email once.
 */
export async function recordDripSent(
  applicationId: string,
  emailNumber: number,
  statusAtSend: string,
): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `INSERT INTO drip_email_log (application_id, email_number, status_at_send)
     VALUES ($1, $2, $3)
     ON CONFLICT (application_id, email_number) DO NOTHING
     RETURNING id`,
    [applicationId, emailNumber, statusAtSend],
  );
  return rows.length > 0;
}

export async function hasDripBeenSent(
  applicationId: string,
  emailNumber: number,
): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM drip_email_log WHERE application_id = $1 AND email_number = $2`,
    [applicationId, emailNumber],
  );
  return rows.length > 0;
}
