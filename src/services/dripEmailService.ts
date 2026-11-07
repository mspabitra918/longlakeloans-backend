import { sendMailgunEmail } from "./emailService";
import {
  COLOR,
  CONTACT,
  P,
  escapeHtml,
  formatCurrency,
  localPhoneLink,
  renderButton,
  renderDetails,
  renderEmailLayout,
  renderSignOff,
} from "./emailLayout";

/**
 * Copy for the drip sequences. The timing lives in `queue/dripConfig.ts`; this
 * module only knows how to render email #N.
 *
 * Verification track (status `bank_verification_pending`):
 *   1      application submitted — call us to finalize
 *   2      secure bank verification link
 *   3-7    verification reminder (same copy, repeats every 12h)
 *   8      final cancellation notice
 *
 * Call track (status `bank_verification_pending`):
 *   11-14  reminder to call underwriting (same copy, repeats every 12h)
 *
 * The verification CTA is a one-click deep link to the bank verification screen
 * using the existing `?applicationId=` pattern (no separate borrower auth/token
 * system exists yet).
 */

export interface DripEmailDetails {
  applicationId: string;
  firstName: string;
  email: string;
  loanAmount: number;
}

/** Where a template's CTA button points. */
type CtaTarget = "verify" | "phone" | "home";

interface DripTemplate {
  subject: string;
  /** Eyebrow label above the title. */
  label: string;
  /** Colour of the eyebrow marker. */
  tone: string;
  title: string;
  /** Lead paragraph(s); plain strings rendered as <p>. May contain inline HTML. */
  body: string[];
  cta: { label: string; target: CtaTarget };
  /** Lines of the sign-off, rendered as one <p> separated by <br />. */
  signOff: string[];
}

const VERIFY_PATH = "/verify-bank";
const PHONE_DISPLAY = CONTACT.local.display;
const PHONE_HREF = CONTACT.local.href;
const HOME_URL = CONTACT.website;

/** The local support number as a tel: link, for use inside body copy. */
const PHONE_LINK = localPhoneLink;

const APPLICATION_SUBMITTED: DripTemplate = {
  subject: "Action Required: Verify Your Bank Account to Finalize Application",
  label: "Action required",
  tone: COLOR.warning,
  title: "Verify your bank account",
  body: [
    "Your secure application has been successfully submitted to LongLake Loans!",
    "To finalize your fixed 10% APR terms and move forward with funding, we need you to securely verify your active bank account.",
    "LongLake Loans uses bank-grade encryption to verify your account status safely. We will never see or store your online banking login credentials.",
    `Once completed, please call our underwriting team at ${PHONE_LINK} (Mon–Fri, 06:00 AM – 04:00 PM PST) to finalize your agreement.`,
  ],
  cta: {
    label: "Verify Bank Account Now",
    target: `verify`,
  },
  signOff: ["Best regards,", "The Underwriting Team at LongLake Loans"],
};

const BANK_VERIFICATION_LINK: DripTemplate = {
  subject: "Next Step: Securely Verify Your Bank Account",
  label: "Next step",
  tone: COLOR.brand,
  title: "Securely verify your bank account",
  body: [
    "We received your application a couple of hours ago, but we still need to verify your active bank account before we can approve your funds for deposit.",
    "To protect your financial data, LongLake Loans uses bank-grade encryption to verify your account status. We will never see or store your online banking login credentials.",
    "Please click the secure link below to connect your institution.",
    `Once this quick step is completed, please call our underwriting team at ${PHONE_LINK} so we can finalize your loan agreement.`,
  ],
  cta: { label: "Securely Verify My Bank Account", target: "verify" },
  signOff: ["Best,", "The Underwriting Team at LongLake Loans"],
};

const BANK_VERIFICATION_REMINDER: DripTemplate = {
  subject: "Reminder: Verify your bank account to receive your funds",
  label: "Reminder",
  tone: COLOR.warning,
  title: "Your application is almost complete",
  body: [
    "Your LongLake Loans application is almost complete, but your file is currently paused. We still need you to verify your bank account so we know exactly where to send your funds once approved.",
    "This process is fully encrypted and takes less than 60 seconds.",
    `If you are experiencing any issues linking your account, our Los Angeles-based team is ready to help. Give us a call at ${PHONE_LINK}.`,
  ],
  cta: { label: "Securely Verify My Bank Account", target: "verify" },
  signOff: ["Best,", "LongLake Loans Customer Support"],
};

const FINAL_CANCELLATION: DripTemplate = {
  subject: "Notice: Your LongLake Loans application has been closed",
  label: "Application closed",
  tone: COLOR.muted,
  title: "Your application has been closed",
  body: [
    "We have tried to reach out a few times to help you complete your bank verification, but we haven't received a response.",
    "At this time, we have officially closed your current loan application, and no further action will be taken. Because we only use a soft credit pull to check eligibility, this cancellation will not impact your credit score.",
    "If you decide you would still like to secure a fixed 10% APR personal loan in the future, you are always welcome to start a new application on our website.",
  ],
  cta: { label: "Start a New Application", target: "home" },
  signOff: [
    "We wish you the best!",
    "Sincerely,",
    "The Team at LongLake Loans",
  ],
};

const CALL_REMINDER: DripTemplate = {
  subject: "Don't lose your spot: Call LongLake Loans to finalize your loan",
  label: "Call required",
  tone: COLOR.warning,
  title: "Your loan application is waiting",
  body: [
    "Your loan application is sitting securely in our system, but it cannot move forward until you speak with our underwriting team.",
    "At LongLake Loans, we don't rely entirely on automated bots. We want to ensure you fully understand your fixed 10% APR terms, with absolutely zero hidden fees or prepayment penalties.",
    "It takes less than five minutes on the phone to review your details and get your funds prepared for release.",
    `Call us today at ${PHONE_LINK} to get your money moving.`,
  ],
  cta: { label: `Call ${PHONE_DISPLAY}`, target: "phone" },
  signOff: ["Best,", "The Underwriting Team at LongLake Loans"],
};

const TEMPLATES: Record<number, DripTemplate> = {
  1: APPLICATION_SUBMITTED,
  2: BANK_VERIFICATION_LINK,
  3: BANK_VERIFICATION_REMINDER,
  4: BANK_VERIFICATION_REMINDER,
  5: BANK_VERIFICATION_REMINDER,
  6: BANK_VERIFICATION_REMINDER,
  7: BANK_VERIFICATION_REMINDER,
  8: FINAL_CANCELLATION,
  11: CALL_REMINDER,
  12: CALL_REMINDER,
  13: CALL_REMINDER,
  14: CALL_REMINDER,
};

function ctaHref(target: CtaTarget, applicationId: string): string {
  switch (target) {
    case "verify":
      return `${process.env.FRONTEND_URL}${VERIFY_PATH}?applicationId=${applicationId}`;
    case "phone":
      return PHONE_HREF;
    case "home":
      return process.env.FRONTEND_URL || HOME_URL;
  }
}

function renderDripEmail(
  template: DripTemplate,
  details: DripEmailDetails,
): string {
  const { applicationId, loanAmount } = details;
  const firstName = escapeHtml(details.firstName);

  return renderEmailLayout({
    eyebrow: `${template.label} &middot; #${applicationId}`,
    tone: template.tone,
    title: template.title,
    bodyHtml: `
      <p ${P}>Hi ${firstName},</p>
      ${template.body.map((p) => `<p ${P}>${p}</p>`).join("\n")}
      ${renderDetails([
        ["Application ID", applicationId],
        ["Loan Amount", formatCurrency(loanAmount)],
      ])}
      ${renderButton(ctaHref(template.cta.target, applicationId), template.cta.label)}
      ${renderSignOff(template.signOff.join("<br />"))}
    `,
  });
}

/**
 * Sends drip email #`emailNumber`. The caller (worker) is responsible for the
 * kill-switch check and idempotency before invoking this.
 */
export async function sendDripEmail(
  emailNumber: number,
  details: DripEmailDetails,
): Promise<void> {
  const template = TEMPLATES[emailNumber];

  if (!template) {
    throw new Error(`No drip template for email #${emailNumber}`);
  }

  console.log("[drip-email] details:", {
    emailNumber,
    applicationId: details.applicationId,
    email: details.email,
  });

  const html = renderDripEmail(template, details);

  await sendMailgunEmail(details.email, template.subject, html);
}
