import "dotenv/config";

import {
  DRIP_EXPIRY_STATUS,
  DRIP_TRACK_STATUS,
  isTrackAllowedInStatus,
  stepForEmailNumber,
} from "./queue/dripConfig";
import {
  getApplicationById,
  purgeExpiredSensitiveData,
  updateApplicationStatus,
} from "./services/applicationService";
import { sendNewDripEmail } from "./services/newDripEmailService";
import { hasDripBeenSent } from "./services/dripLogService";
import {
  claimDueDripEmails,
  markDripAttemptFailed,
  markDripSent,
  markDripSkipped,
  type DripScheduleRow,
} from "./services/dripScheduleService";

/**
 * Always-on worker for the bank-verification drip sequence.
 *
 * Deploy this as a separate long-running process (e.g. on the Hostinger VPS):
 *   npm run build && npm run worker
 * It must NOT run inside the Vercel serverless app — serverless functions are
 * frozen between requests and cannot host a poll loop.
 *
 * Every POLL_INTERVAL_MS it claims the `drip_email_schedule` rows that are due
 * and sends them. The safeguards:
 *   - Instant kill-switch: status changes flip open rows to `cancelled`, and
 *     every claimed row re-reads the live loan status and refuses to send
 *     unless it still matches the status its track is gated on.
 *   - Idempotency: a row is claimed by exactly one worker (FOR UPDATE SKIP
 *     LOCKED) and moves to a terminal status once handled.
 *
 * The last step of the sequence (T+72h) is also the point of no return: after
 * its cancellation notice goes out the application is moved to `declined_pb`.
 */

const POLL_INTERVAL_MS = 30_000;
/** Emails sent in parallel per claim — matches the old BullMQ concurrency. */
const BATCH_SIZE = 5;
/** A row stuck in `sending` this long belonged to a dead worker. */
const LOCK_TIMEOUT_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 60_000;

async function processScheduledEmail(row: DripScheduleRow): Promise<void> {
  const { id, application_id: applicationId, email_number: emailNumber } = row;

  const application = await getApplicationById(applicationId);
  if (!application) {
    await markDripSkipped(id, "application no longer exists");
    return;
  }

  const step = stepForEmailNumber(emailNumber);
  if (!step) {
    await markDripSkipped(id, `no schedule entry for email ${emailNumber}`);
    return;
  }

  // KILL-SWITCH: only send while the application is still in the status its
  // track is gated on — `bank_verification_pending` — so a file that has moved
  // on (e.g. `bank_verification_completed`) sends nothing.
  if (!isTrackAllowedInStatus(step.track, application.status)) {
    await markDripSkipped(
      id,
      `application is "${application.status}" (${step.track} track needs "${DRIP_TRACK_STATUS[step.track]}")`,
    );
    return;
  }

  // Applications scheduled before migrations/004 may have had this email sent
  // by the retired BullMQ worker after the backfill ran.
  if (await hasDripBeenSent(applicationId, emailNumber)) {
    await markDripSkipped(id, "already sent by the legacy BullMQ worker");
    return;
  }

  try {
    await sendNewDripEmail(step.templateNumber, {
      applicationId: application.application_id,
      firstName: application.first_name,
      email: application.email,
      loanAmount: Number(application.loan_amount),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[drip] email ${emailNumber} for ${applicationId} failed (attempt ${row.attempts}/${MAX_ATTEMPTS}):`,
      message,
    );
    await markDripAttemptFailed(id, message, MAX_ATTEMPTS, RETRY_BASE_MS);
    return;
  }

  await markDripSent(id, application.status);
  console.log(
    `[drip] sent email ${emailNumber} to ${application.email} (application ${applicationId})`,
  );

  // End of the sequence: the borrower never verified inside the 72h window, so
  // the cancellation notice they just received is made true on the file.
  if (step.declinesApplication) {
    try {
      await updateApplicationStatus(
        applicationId,
        DRIP_EXPIRY_STATUS,
        "system:drip",
      );
      console.log(
        `[drip] application ${applicationId} moved to "${DRIP_EXPIRY_STATUS}" after the 72h verification window closed`,
      );
    } catch (error) {
      // The email is already out and the row is `sent`, so it will not be
      // re-sent. Surface it and let an admin fix the status.
      console.error(
        `[drip] failed to move application ${applicationId} to "${DRIP_EXPIRY_STATUS}":`,
        error,
      );
    }
  }
}

/** Drains every due row, one batch at a time. */
async function pollDueEmails(): Promise<void> {
  for (;;) {
    const batch = await claimDueDripEmails(BATCH_SIZE, LOCK_TIMEOUT_MS);
    if (batch.length === 0) return;

    await Promise.all(
      batch.map((row) =>
        processScheduledEmail(row).catch((error) => {
          // Left in `sending`; reclaimed after LOCK_TIMEOUT_MS.
          console.error(`[drip] schedule row ${row.id} errored:`, error);
        }),
      ),
    );

    if (batch.length < BATCH_SIZE) return;
  }
}

let inFlight: Promise<void> | null = null;

function tick(): void {
  if (inFlight) return;
  inFlight = pollDueEmails()
    .catch((error) => {
      console.error("[drip] poll failed:", error);
    })
    .finally(() => {
      inFlight = null;
    });
}

const pollTimer = setInterval(tick, POLL_INTERVAL_MS);
tick();
console.log(
  `[drip] worker ready — polling drip_email_schedule every ${POLL_INTERVAL_MS / 1000}s`,
);

const retentionSweep = setInterval(
  () => {
    purgeExpiredSensitiveData().catch((error) => {
      console.error("Sensitive-data retention sweep failed:", error);
    });
  },
  24 * 60 * 60 * 1000,
);

async function shutdown(signal: string): Promise<void> {
  console.log(`[drip] received ${signal}, closing worker...`);
  clearInterval(pollTimer);
  clearInterval(retentionSweep);
  await inFlight;
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
