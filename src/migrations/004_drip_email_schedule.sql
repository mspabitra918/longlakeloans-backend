-- =============================================================================
-- 004 — drip_email_schedule
-- Run with `npm run db:drip-schedule`. Idempotent: safe to re-run.
-- =============================================================================
--
-- Why a table instead of BullMQ delayed jobs
-- ------------------------------------------
-- The bank-verification drip used to live only in Redis as delayed BullMQ jobs.
-- That left nothing in Postgres saying which reminders an application *will*
-- get, so support could not see the schedule, a Redis flush silently lost every
-- pending reminder, and the Vercel API needed Redis just to enqueue them.
--
-- Now every email of every drip track is written as a row when the application
-- is submitted, carrying the instant it is due (`scheduled_at`). The worker on
-- the VPS polls for due rows; Postgres is the only moving part.
--
-- Row lifecycle (`status`)
--   scheduled  waiting for `scheduled_at`
--   sending    claimed by a worker (`locked_at` set). A row stuck here longer
--              than the worker's lock timeout is reclaimed, so a crashed worker
--              cannot strand an email.
--   sent       delivered; `sent_at` and `status_at_send` record when and from
--              which loan status
--   cancelled  the application left `bank_verification_pending` before this
--              email was due (bank verification flips the rest to cancelled)
--   skipped    the worker picked it up but refused to send (status moved on,
--              application gone, unknown step). `resolution` says why.
--   failed     sending threw on every attempt. `resolution` holds the error.
--
-- UNIQUE (application_id, email_number) makes scheduling idempotent: each
-- numbered email exists once per application, and only the worker that claimed
-- it may send it. The one repeat is a worker dying between sending and marking
-- the row sent; the reclaimed row is then sent again.
--
-- `drip_email_log` is kept as legacy history only; nothing writes to it any
-- more. The backfill below reads it so emails BullMQ already delivered are not
-- sent again.

CREATE TABLE IF NOT EXISTS drip_email_schedule (
    id             SERIAL PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    email_number   INTEGER NOT NULL CHECK (email_number BETWEEN 1 AND 99),
    track          VARCHAR(20) NOT NULL,
    scheduled_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'sending', 'sent', 'cancelled', 'skipped', 'failed')),
    attempts       INTEGER NOT NULL DEFAULT 0,
    locked_at      TIMESTAMP WITH TIME ZONE,
    sent_at        TIMESTAMP WITH TIME ZONE,
    status_at_send VARCHAR(30),
    resolution     TEXT,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (application_id, email_number)
);

-- The worker's poll: only open rows, oldest due first.
CREATE INDEX IF NOT EXISTS idx_drip_schedule_due
    ON drip_email_schedule(scheduled_at)
    WHERE status IN ('scheduled', 'sending');

DROP TRIGGER IF EXISTS update_drip_email_schedule_updated_at ON drip_email_schedule;
CREATE TRIGGER update_drip_email_schedule_updated_at
    BEFORE UPDATE ON drip_email_schedule
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- Backfill applications still being chased by BullMQ.
--
-- Steps mirror VERIFY_TRACK_STEPS in src/queue/dripConfig.ts (E21 6h, E22 24h,
-- E23 48h, E24 72h after submission). Only applications still waiting on bank
-- verification are backfilled. A step BullMQ already sent is recorded as sent;
-- a step whose time has already passed without a send is skipped rather than
-- fired late, so the migration never triggers a burst of stale reminders.
-- -----------------------------------------------------------------------------
INSERT INTO drip_email_schedule
    (application_id, email_number, track, scheduled_at, status, sent_at, status_at_send, resolution)
SELECT
    la.id,
    step.email_number,
    'verify',
    la.created_at + step.after_interval,
    CASE
        WHEN log.id IS NOT NULL THEN 'sent'
        WHEN la.created_at + step.after_interval <= NOW() THEN 'skipped'
        ELSE 'scheduled'
    END,
    log.sent_at,
    log.status_at_send,
    CASE
        WHEN log.id IS NOT NULL THEN 'backfilled from drip_email_log'
        WHEN la.created_at + step.after_interval <= NOW() THEN 'backfill: already past due'
    END
FROM loan_applications la
CROSS JOIN (VALUES
    (21, INTERVAL '6 hours'),
    (22, INTERVAL '24 hours'),
    (23, INTERVAL '48 hours'),
    (24, INTERVAL '72 hours')
) AS step(email_number, after_interval)
LEFT JOIN drip_email_log log
    ON log.application_id::text = la.id::text
   AND log.email_number = step.email_number
WHERE la.status = 'bank_verification_pending'
ON CONFLICT (application_id, email_number) DO NOTHING;
