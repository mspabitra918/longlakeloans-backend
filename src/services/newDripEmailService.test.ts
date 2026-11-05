import assert from "node:assert/strict";
import { sendNewDripEmail } from "./newDripEmailService";
import { setEmailSender } from "./emailService";
import {
  DRIP_EXPIRY_STATUS,
  DRIP_STEPS,
  VERIFY_TRACK_STEPS,
  delayForStep,
  isTrackAllowedInStatus,
  stepForEmailNumber,
  tracksBlockedByStatus,
} from "../queue/dripConfig";

const HOUR = 60 * 60 * 1000;

async function main() {
  process.env.FRONTEND_URL = "https://example.com";
  process.env.SMTP_HOST = "smtp.test";
  process.env.SMTP_USER = "test-user";
  process.env.SMTP_PASS = "test-pass";
  process.env.FROM_EMAIL = "hello@longlakeloans.com";
  process.env.FROM_NAME = "LongLake Loans";

  const sent: Array<{ subject: string; html: string }> = [];

  setEmailSender(async ({ subject, html }) => {
    sent.push({ subject, html });
    return { messageId: "1" } as any;
  });

  try {
    const cases = [
      {
        templateNumber: 1,
        expectedSubject: "Reminder: Complete Your Bank Verification",
        expectedText: "haven't completed your bank verification yet",
        expectedHref: "https://example.com/verify-bank?applicationId=12345",
      },
      {
        templateNumber: 2,
        expectedSubject: "Your Bank Verification is Still Incomplete",
        expectedText: "bank verification is still incomplete",
        expectedHref: "https://example.com/verify-bank?applicationId=12345",
      },
      {
        templateNumber: 3,
        expectedSubject: "Final Reminder: Verify Your Bank Account",
        expectedText: "final reminder to complete your bank verification",
        expectedHref: "https://example.com/verify-bank?applicationId=12345",
      },
      {
        templateNumber: 4,
        expectedSubject: "Notice: Your Loan Application Has Been Cancelled",
        expectedText: "has been cancelled for now",
        expectedHref: "tel:+17472025223",
      },
    ] as const;

    for (const testCase of cases) {
      await sendNewDripEmail(testCase.templateNumber, {
        applicationId: "12345",
        firstName: "Jane",
        email: "jane@example.com",
        loanAmount: 2500,
      });

      const lastMessage = sent[sent.length - 1];
      assert.equal(
        lastMessage?.subject,
        testCase.expectedSubject,
        `subject for template ${testCase.templateNumber}`,
      );
      assert.ok(
        lastMessage?.html.includes(testCase.expectedText),
        `body copy for template ${testCase.templateNumber}`,
      );
      assert.ok(
        lastMessage?.html.includes(`href="${testCase.expectedHref}"`),
        `CTA href for template ${testCase.templateNumber}`,
      );
      assert.ok(
        lastMessage?.html.includes("Hi Jane,"),
        `greeting for template ${testCase.templateNumber}`,
      );
    }

    // Every scheduled step must have a template behind it.
    for (const step of DRIP_STEPS) {
      await sendNewDripEmail(step.templateNumber, {
        applicationId: "12345",
        firstName: "Jane",
        email: "jane@example.com",
        loanAmount: 2500,
      });
    }

    await assert.rejects(
      sendNewDripEmail(99, {
        applicationId: "12345",
        firstName: "Jane",
        email: "jane@example.com",
        loanAmount: 2500,
      }),
      /No drip template for email #99/,
    );
  } finally {
    setEmailSender();
  }

  // Production schedule: three reminders then cancellation at T+72h.
  // dripConfig.ts can be switched to a compressed schedule for end-to-end
  // testing, in which case skip the exact offsets and only assert the shape
  // both schedules must share.
  const isProductionSchedule = VERIFY_TRACK_STEPS[0].afterMs === 6 * HOUR;
  if (isProductionSchedule) {
    assert.deepEqual(
      VERIFY_TRACK_STEPS.map((s) => s.afterMs / HOUR),
      [6, 24, 48, 72],
    );
  } else {
    console.log(
      "! compressed drip schedule active — exact offsets not checked",
    );
    assert.equal(VERIFY_TRACK_STEPS.length, 4);
  }

  // Either way, the track runs forward from its anchor.
  for (let i = 1; i < VERIFY_TRACK_STEPS.length; i++) {
    assert.ok(
      VERIFY_TRACK_STEPS[i].afterMs > VERIFY_TRACK_STEPS[i - 1].afterMs,
      `step ${VERIFY_TRACK_STEPS[i].emailNumber} must fire after ${VERIFY_TRACK_STEPS[i - 1].emailNumber}`,
    );
  }

  // Email numbers are the idempotency key — they must not collide.
  assert.equal(
    new Set(DRIP_STEPS.map((s) => s.emailNumber)).size,
    DRIP_STEPS.length,
  );

  // Exactly one step closes the file out, and it is the last one.
  const decliningSteps = DRIP_STEPS.filter((s) => s.declinesApplication);
  assert.equal(decliningSteps.length, 1);
  assert.equal(
    decliningSteps[0].emailNumber,
    VERIFY_TRACK_STEPS[VERIFY_TRACK_STEPS.length - 1].emailNumber,
  );
  assert.equal(DRIP_EXPIRY_STATUS, "declined_pb");

  // The track is gated on `bank_verification_pending`: once the file moves on —
  // above all to `bank_verification_completed` — it may not send again.
  assert.equal(
    isTrackAllowedInStatus("verify", "bank_verification_pending"),
    true,
  );
  assert.equal(
    isTrackAllowedInStatus("verify", "bank_verification_completed"),
    false,
  );
  assert.equal(isTrackAllowedInStatus("verify", "funded"), false);
  assert.equal(isTrackAllowedInStatus("verify", "declined"), false);
  assert.deepEqual(tracksBlockedByStatus("bank_verification_pending"), []);
  assert.deepEqual(tracksBlockedByStatus("bank_verification_completed"), [
    "verify",
  ]);
  assert.deepEqual(tracksBlockedByStatus("funded"), ["verify"]);
  assert.equal(stepForEmailNumber(24)?.track, "verify");
  // Numbers from the retired 1-14 sequence must no longer resolve.
  assert.equal(stepForEmailNumber(1), undefined);
  assert.equal(stepForEmailNumber(11), undefined);
  assert.equal(stepForEmailNumber(99), undefined);

  // Delays are relative to the anchor and never negative.
  const anchor = new Date("2026-01-01T00:00:00Z");
  assert.equal(
    delayForStep(VERIFY_TRACK_STEPS[0], anchor, anchor),
    VERIFY_TRACK_STEPS[0].afterMs,
    "E21 fires its configured offset after submission",
  );
  assert.equal(
    delayForStep(
      VERIFY_TRACK_STEPS[0],
      anchor,
      new Date(anchor.getTime() + 12 * HOUR),
    ),
    0,
    "a step whose time has passed fires immediately",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
