import { Queue } from "bullmq";
import { getRedisConnection, isQueueEnabled } from "./connection";
import {
  DRIP_QUEUE_NAME,
  DRIP_TRACKS,
  delayForStep,
  stepsForTrack,
  type DripStep,
  type DripTrack,
} from "./dripConfig";

export interface DripJobData {
  applicationId: string;
  emailNumber: number;
}

let queue: Queue<DripJobData> | null = null;

export function getDripQueue(): Queue<DripJobData> {
  if (queue) return queue;
  queue = new Queue<DripJobData>(DRIP_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      // Keep history bounded so Redis doesn't grow unbounded on Upstash.
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5000 },
      removeOnFail: { age: 14 * 24 * 60 * 60 },
    },
  });
  return queue;
}

/** Deterministic job id so a step is enqueued at most once and can be removed. */
function jobId(applicationId: string, emailNumber: number): string {
  return `drip:${applicationId}:${emailNumber}`;
}

/**
 * Schedules every email in one track, anchored to `anchoredAt`. Idempotent:
 * deterministic job ids mean re-enqueueing the same track is a no-op while the
 * jobs still exist. Never throws — a queue outage must not break the caller.
 */
export async function enqueueDripTrack(
  applicationId: string,
  track: DripTrack,
  anchoredAt: Date,
): Promise<void> {
  if (!isQueueEnabled()) {
    console.warn(
      `[drip] REDIS_URL not set — skipping ${track} enqueue for application ${applicationId}`,
    );
    return;
  }

  const steps = stepsForTrack(track);

  try {
    const q = getDripQueue();
    const now = new Date();

    await Promise.all(
      steps.map((step: DripStep) =>
        q.add(
          `drip-email-${step.emailNumber}`,
          { applicationId, emailNumber: step.emailNumber },
          {
            jobId: jobId(applicationId, step.emailNumber),
            delay: delayForStep(step, anchoredAt, now),
          },
        ),
      ),
    );

    console.log(
      `[drip] Enqueued ${steps.length} ${track} emails for application ${applicationId}`,
    );
  } catch (err) {
    console.error(
      `[drip] Failed to enqueue ${track} track for ${applicationId}:`,
      err,
    );
  }
}

/**
 * Starts every drip track for a freshly-submitted application. Both tracks share
 * the submission anchor and the same gate: both are dropped as soon as the
 * application leaves `bank_verification_pending` (e.g. once it becomes
 * `bank_verification_completed`).
 */
export async function enqueueDripSequence(
  applicationId: string,
  submittedAt: Date,
): Promise<void> {
  await Promise.all(
    DRIP_TRACKS.map((track) =>
      enqueueDripTrack(applicationId, track, submittedAt),
    ),
  );
}

/**
 * Instant kill-switch: removes pending drip jobs for an application. Called the
 * moment the application leaves a track's active status so no further reminders
 * are sent. Defaults to every track. Never throws.
 */
export async function cancelDripSequence(
  applicationId: string,
  tracks: DripTrack[] = DRIP_TRACKS,
): Promise<void> {
  if (!isQueueEnabled()) return;
  if (tracks.length === 0) return;

  try {
    const q = getDripQueue();
    await Promise.all(
      tracks.flatMap((track) =>
        stepsForTrack(track).map(async (step) => {
          try {
            // remove() clears delayed/waiting/completed/failed jobs. A job that
            // is actively running is locked and can't be removed — the worker's
            // own status re-check is the backstop that prevents it sending.
            await q.remove(jobId(applicationId, step.emailNumber));
          } catch {
            /* job locked/active or already gone — ignore */
          }
        }),
      ),
    );
    console.log("Cancelling tracks:", tracks);
    console.log(
      `[drip] Cancelled ${tracks.join("+")} track(s) for application ${applicationId}`,
    );
  } catch (err) {
    console.error(
      `[drip] Failed to cancel sequence for ${applicationId}:`,
      err,
    );
  }
}
