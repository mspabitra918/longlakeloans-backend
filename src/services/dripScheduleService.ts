import { execute, query } from "../db";
import {
  DRIP_TRACKS,
  stepsForTrack,
  type DripTrack,
} from "../queue/dripConfig";

/**
 * Postgres-backed drip schedule (`drip_email_schedule`, migrations/004).
 *
 * The API writes one row per email when an application is submitted and flips
 * the open rows to `cancelled` when the application leaves
 * `bank_verification_pending`. The worker claims due rows, sends, and records
 * the outcome. Nothing here needs Redis, so the Vercel API can call it directly.
 */

export type DripScheduleStatus =
  | "scheduled"
  | "sending"
  | "sent"
  | "cancelled"
  | "skipped"
  | "failed";

export interface DripScheduleRow {
  id: number;
  application_id: string;
  email_number: number;
  track: DripTrack;
  scheduled_at: Date;
  status: DripScheduleStatus;
  attempts: number;
  sent_at: Date | null;
  status_at_send: string | null;
  resolution: string | null;
}

/**
 * Writes every email of every drip track for an application, anchored to
 * `anchoredAt`. Idempotent: an email already scheduled, sent or skipped is left
 * alone, but a previously `cancelled` one is re-armed at its new time — the same
 * behaviour as re-adding a removed BullMQ job. Never throws: drip bookkeeping
 * must not fail a submission that is already committed.
 */
export async function scheduleDripSequence(
  applicationId: string,
  anchoredAt: Date,
  tracks: DripTrack[] = DRIP_TRACKS,
): Promise<void> {
  const steps = tracks.flatMap(stepsForTrack);
  if (steps.length === 0) return;

  try {
    await query(
      `INSERT INTO drip_email_schedule (application_id, email_number, track, scheduled_at)
       SELECT $1::uuid, step.email_number, step.track, step.scheduled_at
       FROM UNNEST($2::int[], $3::text[], $4::timestamptz[])
            AS step(email_number, track, scheduled_at)
       ON CONFLICT (application_id, email_number) DO UPDATE
         SET status       = 'scheduled',
             scheduled_at = EXCLUDED.scheduled_at,
             attempts     = 0,
             locked_at    = NULL,
             resolution   = NULL
         WHERE drip_email_schedule.status = 'cancelled'`,
      [
        applicationId,
        steps.map((step) => step.emailNumber),
        steps.map((step) => step.track),
        steps.map((step) => new Date(anchoredAt.getTime() + step.afterMs)),
      ],
    );
    console.log(
      `[drip] Scheduled ${steps.length} email(s) for application ${applicationId}`,
    );
  } catch (err) {
    console.error(
      `[drip] Failed to schedule drip for application ${applicationId}:`,
      err,
    );
  }
}

/**
 * Instant kill-switch: flips every not-yet-claimed email in `tracks` to
 * `cancelled`. A row the worker has already claimed is left to the worker's own
 * status re-check. Defaults to every track. Never throws.
 */
export async function cancelDripSequence(
  applicationId: string,
  tracks: DripTrack[] = DRIP_TRACKS,
  reason = "cancelled",
): Promise<void> {
  if (tracks.length === 0) return;

  try {
    const count = await execute(
      `UPDATE drip_email_schedule
       SET status = 'cancelled', resolution = $3
       WHERE application_id = $1::uuid
         AND track = ANY($2::text[])
         AND status = 'scheduled'`,
      [applicationId, tracks, reason],
    );
    console.log(
      `[drip] Cancelled ${count} ${tracks.join("+")} email(s) for application ${applicationId}`,
    );
  } catch (err) {
    console.error(
      `[drip] Failed to cancel drip for application ${applicationId}:`,
      err,
    );
  }
}

/**
 * Claims up to `limit` due emails for this worker, oldest first. A row left in
 * `sending` longer than `lockTimeoutMs` belonged to a worker that died mid-send
 * and is reclaimed. SKIP LOCKED lets several workers poll without colliding.
 */
export async function claimDueDripEmails(
  limit: number,
  lockTimeoutMs: number,
): Promise<DripScheduleRow[]> {
  return query<DripScheduleRow>(
    `UPDATE drip_email_schedule s
     SET status = 'sending', locked_at = NOW(), attempts = s.attempts + 1
     WHERE s.id IN (
       SELECT id FROM drip_email_schedule
       WHERE scheduled_at <= NOW()
         AND (status = 'scheduled'
              OR (status = 'sending' AND locked_at < NOW() - $2 * INTERVAL '1 millisecond'))
       ORDER BY scheduled_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING s.id, s.application_id::text AS application_id, s.email_number,
               s.track, s.scheduled_at, s.status, s.attempts, s.sent_at,
               s.status_at_send, s.resolution`,
    [limit, lockTimeoutMs],
  );
}

export async function markDripSent(
  id: number,
  statusAtSend: string,
): Promise<void> {
  await execute(
    `UPDATE drip_email_schedule
     SET status = 'sent', sent_at = NOW(), status_at_send = $2,
         locked_at = NULL, resolution = NULL
     WHERE id = $1`,
    [id, statusAtSend],
  );
}

/** The worker picked the email up but deliberately did not send it. */
export async function markDripSkipped(
  id: number,
  resolution: string,
): Promise<void> {
  await execute(
    `UPDATE drip_email_schedule
     SET status = 'skipped', locked_at = NULL, resolution = $2
     WHERE id = $1`,
    [id, resolution],
  );
}

/**
 * Records a failed send. Retries with exponential backoff from `retryBaseMs`
 * until `maxAttempts`, then gives up and leaves the row `failed`.
 */
export async function markDripAttemptFailed(
  id: number,
  error: string,
  maxAttempts: number,
  retryBaseMs: number,
): Promise<void> {
  await execute(
    `UPDATE drip_email_schedule
     SET status       = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'scheduled' END,
         scheduled_at = CASE WHEN attempts >= $3 THEN scheduled_at
                             ELSE NOW() + $4 * POWER(2, attempts - 1) * INTERVAL '1 millisecond' END,
         locked_at    = NULL,
         resolution   = $2
     WHERE id = $1`,
    [id, error, maxAttempts, retryBaseMs],
  );
}

/** The full schedule for one application, in send order. */
export async function getDripSchedule(
  applicationId: string,
): Promise<DripScheduleRow[]> {
  return query<DripScheduleRow>(
    `SELECT id, application_id::text AS application_id, email_number, track,
            scheduled_at, status, attempts, sent_at, status_at_send, resolution
     FROM drip_email_schedule
     WHERE application_id = $1::uuid
     ORDER BY scheduled_at, email_number`,
    [applicationId],
  );
}
