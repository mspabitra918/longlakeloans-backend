import { sendMailgunEmail } from "./emailService";
import {
  COLOR,
  CONTACT,
  P,
  escapeHtml,
  formatCurrency,
  renderButton,
  renderDetails,
  renderEmailLayout,
  renderSignOff,
} from "./emailLayout";

export interface DripEmailDetails {
  applicationId: string;
  firstName: string;
  email: string;
  loanAmount: number;
}

type CtaTarget = "verify" | "phone" | "home";

interface DripTemplate {
  subject: string;
  previewText: string;
  /** Eyebrow label above the title. */
  label: string;
  /**
   * Colour of the eyebrow marker. Escalates with urgency: brand green for the
   * first friendly reminder → warning → danger → muted once cancelled.
   */
  tone: string;
  title: string;
  body: string[];
  cta: { label: string; target: CtaTarget };
  signOff: string[];
}

const VERIFY_PATH = "/verify-bank";
const HOME_URL = CONTACT.website;

// 3. Follow-Up #1 — 6 Hours
const FOLLOWUP_6H: DripTemplate = {
  subject: "Reminder: Complete Your Bank Verification",
  previewText: "Please complete bank verification to finish your application.",
  label: "Reminder",
  tone: COLOR.brand,
  title: "Complete your bank verification",
  body: [
    "Your loan application is still waiting for bank verification.",
    "Please complete your verification to continue.",
    "If verification is not completed within 2 days, your application may be cancelled.",
  ],
  cta: { label: "Verify my bank", target: "verify" },
  signOff: [],
};

// 4. Follow-Up #2 — 24 Hours
const FOLLOWUP_24H: DripTemplate = {
  subject: "Your Bank Verification is Still Incomplete",
  previewText: "Complete your bank verification to continue your application.",
  label: "Action required",
  tone: COLOR.warning,
  title: "Your bank verification is still incomplete",
  body: [
    "Your bank verification is still incomplete.",
    "Please complete verification to continue your loan application.",
  ],
  cta: { label: "Verify my bank", target: "verify" },
  signOff: [],
};

// 5. Follow-Up #3 — 48 Hours
const FOLLOWUP_48H: DripTemplate = {
  subject: "Final Reminder: Verify Your Bank Account",
  previewText: "Final reminder: your bank verification is still pending.",
  label: "Final reminder",
  tone: COLOR.danger,
  title: "Final reminder: verify your bank account",
  body: [
    "This is your final reminder to complete your bank verification.",
    "Your application is still pending verification.",
    "If verification is not completed, your application will be cancelled for now.",
  ],
  cta: { label: "Verify my bank", target: "verify" },
  signOff: [],
};

// 6. Application Cancelled — 72 Hours
const APPLICATION_CANCELLED: DripTemplate = {
  subject: "Notice: Your Loan Application Has Been Cancelled",
  previewText:
    "Your application was cancelled because bank verification was not completed.",
  label: "Application cancelled",
  tone: COLOR.muted,
  title: "Your application has been cancelled",
  body: [
    "Your loan application has been cancelled for now because bank verification was not completed.",
    "You can contact us within 30 days if you would like to request that your application be reopened.",
  ],
  cta: { label: `Call ${CONTACT.local.display}`, target: "phone" },
  signOff: [],
};

const TEMPLATES: Record<number, DripTemplate> = {
  1: FOLLOWUP_6H,
  2: FOLLOWUP_24H,
  3: FOLLOWUP_48H,
  4: APPLICATION_CANCELLED,
};

function ctaHref(target: CtaTarget, applicationId: string): string {
  switch (target) {
    case "verify":
      return `${process.env.FRONTEND_URL || HOME_URL}${VERIFY_PATH}?applicationId=${applicationId}`;
    case "phone":
      return CONTACT.local.href;
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
    previewText: template.previewText,
    eyebrow: `${template.label} &middot; #${applicationId}`,
    tone: template.tone,
    title: template.title,
    bodyHtml: `
      <p ${P}>Hi ${firstName},</p>
      ${template.body.map((p) => `<p ${P}>${p}</p>`).join("\n")}
      ${renderButton(ctaHref(template.cta.target, applicationId), template.cta.label)}
      ${renderDetails([
        ["Application ID", applicationId],
        ["Loan Amount", formatCurrency(loanAmount)],
      ])}
      ${renderSignOff(
        template.signOff.length
          ? template.signOff.join("<br />")
          : "LongLake Loans Support",
      )}
    `,
  });
}

/**
 * Sends drip email #`emailNumber`. The caller (worker) is responsible for the
 * kill-switch check and idempotency before invoking this.
 */
export async function sendNewDripEmail(
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
