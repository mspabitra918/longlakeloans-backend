interface ApplicationDetails {
  applicationId: string;
  firstName: string;
  lastName: string;
  email: string;
  loanAmount: number;
  loanPurpose: string;
  loanTerm: number;
  status?: string;
}

import { sendEmail as sendMailerCloudEmail } from "./mailercloudService";
import {
  COLOR,
  CONTACT,
  FONT,
  P,
  STRONG,
  escapeHtml,
  formatCurrency,
  localPhoneLink,
  renderButton,
  renderDetails,
  renderEmailLayout,
  renderPanel,
  renderSignOff,
  supportEmailLink,
  tollFreePhoneLink,
} from "./emailLayout";

type EmailSender = typeof sendMailerCloudEmail;

let emailSender: EmailSender = sendMailerCloudEmail;

/** Test seam: swap the underlying transport. Pass no argument to restore it. */
export function setEmailSender(sender?: EmailSender): void {
  emailSender = sender ?? sendMailerCloudEmail;
}

export async function sendMailgunEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const missing = [
    ["SMTP_HOST", process.env.SMTP_HOST],
    ["SMTP_USER", process.env.SMTP_USER],
    ["SMTP_PASS", process.env.SMTP_PASS],
    [
      "MAILERCLOUD_FROM_EMAIL or FROM_EMAIL",
      process.env.MAILERCLOUD_FROM_EMAIL || process.env.FROM_EMAIL,
    ],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Status email is not configured; missing: ${missing.join(", ")}. Configure MailerCloud SMTP credentials in the backend .env.`,
    );
  }

  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  await emailSender({ to, subject, html, text });
}

/* -------------------------------------------------------------------------- */
/*  Templates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Statuses an application holds before it has reached bank verification. The
 * verification link is withheld for these — the applicant has not finished the
 * wizard, so there is nothing to verify against yet.
 */
const PRE_BANK_VERIFICATION_STATUSES = new Set([
  "draft",
  "prequalified",
  "identity_verified",
]);

export async function sendApplicationConfirmationEmail(
  details: ApplicationDetails,
): Promise<void> {
  const { applicationId, email, loanAmount } = details;
  const firstName = escapeHtml(details.firstName);

  const html = renderEmailLayout({
    previewText:
      "Your application is pre-approved. Complete bank verification to continue.",
    eyebrow: "Application received",
    tone: COLOR.accent,
    title: "Your application is pre-approved",
    bodyHtml: `
      <p ${P}>Hi ${firstName},</p>
      <p ${P}>Your loan application has been received and pre-approved.</p>

      ${renderDetails([
        ["Application ID", applicationId],
        ["Loan Amount", formatCurrency(loanAmount)],
      ])}

      <p ${P}>Your next step is to verify your bank account.</p>

      ${renderButton(
        `${process.env.FRONTEND_URL}/verify-bank?applicationId=${applicationId}`,
        "Verify my bank",
      )}

      <p ${P}>Complete your verification to continue your application.</p>
      ${renderSignOff("LongLake Loans Support")}
    `,
  });

  await sendMailgunEmail(
    email,
    `Your application is pre-approved. Complete bank verification to continue - ID: ${applicationId} | LongLake Loans`,
    html,
  );
}

interface StatusUpdateDetails {
  applicationId: string;
  firstName: string;
  email: string;
  loanAmount: number;
  status: string;
  fundedAt?: string | Date; // Pass stored funding timestamp
}

const statusConfig: Record<
  string,
  {
    title: string;
    /** Eyebrow label shown above the title. */
    label: string;
    /** Closing lines, rendered after the CTA button. */
    signOff?: string;
    message?: string;
    color: string;
    subject?: string;
    customBody?: (
      details: StatusUpdateDetails,
      formattedAmount: string,
    ) => string;
  }
> = {
  bank_verification_pending: {
    title: "Bank Verification Required",
    label: "Action required",
    signOff: "Best regards,<br/>The Underwriting Team at LongLake Loans",
    subject: "Action Required: Securely verify your bank account",
    message:
      "Your loan application has been received. Please complete the bank verification process to proceed with your application.",
    customBody: (details) => `
      <p ${P}>Hi ${details.firstName},</p>
      <p ${P}>We are currently reviewing your LongLake Loans application! To proceed further and generate your final loan agreement, we need to verify your active bank account details.</p>
      ${renderPanel(
        "Your security is our priority",
        `<ul style="margin: 0; padding-left: 18px; color: ${COLOR.body}; font-family: ${FONT}; font-size: 14px; line-height: 1.65;">
          <li style="margin-bottom: 8px;"><strong ${STRONG}>Bank-Level Security:</strong> Your data is protected by 256-bit SSL encryption, the same standard used by major financial institutions.</li>
          <li style="margin-bottom: 8px;"><strong ${STRONG}>Strictly Confidential:</strong> We adhere strictly to GLBA and financial privacy laws. Your information is used exclusively for verifying your identity and funding your approved loan.</li>
          <li><strong ${STRONG}>Read-Only Access:</strong> We only verify your account status and balance. We cannot make changes to your bank account.</li>
        </ul>`,
      )}
      <p ${P}>If you need assistance, please call our underwriting team at ${localPhoneLink}.</p>
    `,
    color: COLOR.warning,
  },
  bank_verification_in_progress: {
    title: "Bank Verification In Progress",
    label: "In progress",
    message:
      "Your bank verification is currently being processed. Please allow some time for us to verify your bank account details. We will notify you once the verification is complete.",
    color: COLOR.muted,
  },
  bank_verification_completed: {
    title: "Bank Verification Completed",
    label: "Verified",
    message:
      "Your bank verification has been successfully completed. Your application is now being prepared for review by our team.",
    color: COLOR.accent,
  },
  bank_reverification: {
    title: "Bank Connection Unsuccessful",
    label: "Action required",
    signOff: "Best,<br/>LongLake Loans Customer Support",
    subject: "Bank Connection Unsuccessful",
    customBody: (details) => `
      <p ${P}>Hi ${details.firstName},</p>
      <p ${P}>We were unable to securely connect your bank account.</p>
      <p ${P}>Please try again using the secure link below. Make sure your online banking username and password are correct and up to date.</p>
      <p ${P}>If you continue to have trouble or need to connect a different account, call us at ${localPhoneLink}.</p>
    `,
    color: COLOR.danger,
  },
  request_a_call: {
    title: "Urgent Action Needed",
    label: "Urgent",
    signOff: "Best,<br/>The Underwriting Team at LongLake Loans",
    subject: "URGENT: Please call LongLake Loans immediately",
    message: "",
    customBody: (details) => `
      <p ${P}>Hi ${details.firstName},</p>
      <p ${P}>Something urgent has come up regarding your loan application. We need to speak with you directly before we can move any further in the approval process.</p>
      <p ${P}><strong ${STRONG}>Please call us ASAP at ${localPhoneLink}.</strong></p>
      ${renderButton(CONTACT.local.href, `Call ${CONTACT.local.display}`)}
      <p ${P}>Our underwriting team is standing by to resolve this with you quickly so we can get your file back on track.</p>
      <p style="margin: 0 0 16px; color: ${COLOR.muted}; font-family: ${FONT}; font-size: 13px; line-height: 1.6;">Hours: Monday – Friday, 06:00 AM – 04:00 PM PST</p>
    `,
    color: COLOR.danger,
  },
  funded: {
    title: "Loan Funded",
    label: "Funded",
    signOff: "Thank you,<br/>LongLake Loans Support",
    subject: "Your loan has been funded",
    color: COLOR.accent,
    customBody: (details, formattedAmount) => {
      // Convert funding timestamp to Pacific Time (America/Los_Angeles)
      const dateObj = details.fundedAt
        ? new Date(details.fundedAt)
        : new Date();

      const fundedDate = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      }).format(dateObj);

      const fundedTime = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(dateObj);

      return `
        <p ${P}>Hi ${details.firstName},</p>
        <p ${P}>Good news — your loan has been funded.</p>
        ${renderDetails([
          ["Loan Amount", formattedAmount],
          ["Application ID", details.applicationId],
          ["Funded On", `${fundedDate} at ${fundedTime} PT`],
        ])}
        <p ${P}>Your funds have been released. Please allow up to 24 business hours for the funds to appear in your bank account.</p>
        <p ${P}>If you have any questions, please contact us at ${localPhoneLink} or ${supportEmailLink}.</p>
      `;
    },
  },
  declined_pb: {
    title: "Update Required: Unsupported bank account type",
    label: "Update required",
    signOff: "Thank you,<br/>LongLake Loans Support",
    subject: "Update Required: Unsupported bank account type",
    message: "",
    customBody: (details, formattedAmount) => `
      <p ${P}>Hi ${details.firstName},</p>
      <p ${P}>Thank you for submitting your loan application.</p>
      <p ${P}>After reviewing the banking information provided, we’re unable to proceed with your application at this time because the account provided is with a prepaid banking service and does not meet the current bank-account eligibility requirements for this application.</p>
      <p ${P}>To be eligible to proceed, you must have an active local bank account that has been open for at least 90 days.</p>
      ${renderDetails([
        ["Application ID", details.applicationId],
        ["Loan Amount", formattedAmount],
      ])}
      <p ${P}>If you have an eligible local bank account that meets this requirement, please contact us to discuss the next steps at ${localPhoneLink} or ${supportEmailLink}.</p>
    `,
    color: COLOR.warning,
  },
  declined_hd: {
    title: "Notice of Action: Your loan application status",
    label: "Application decision",
    signOff: "Thank you,<br/>LongLake Loans Support",
    subject: "Notice of Action: Your loan application status",
    message: "",
    customBody: (details, formattedAmount) => `
      <p ${P}>Hi ${details.firstName},</p>
      <p ${P}>Thank you for submitting your loan application.</p>
      <p ${P}>After completing the underwriting review, the lender has determined that your application does not meet its current credit and risk assessment criteria. As a result, we are unable to approve the application at this time.</p>
      ${renderDetails([
        ["Application ID", details.applicationId],
        ["Requested Loan Amount", formattedAmount],
      ])}
      <p ${P}>This decision is based on the lender’s assessment of the application and its applicable underwriting requirements.</p>
      <p ${P}>If you have questions regarding your application or the decision, please contact our support team at ${localPhoneLink} or ${supportEmailLink}.</p>
    `,
    color: COLOR.danger,
  },
};

export async function sendStatusUpdateEmail(
  details: StatusUpdateDetails,
): Promise<void> {
  const { applicationId, email, loanAmount, status } = details;

  const config = statusConfig[status];
  if (!config) return;

  const safeDetails = { ...details, firstName: escapeHtml(details.firstName) };
  const formattedAmount = formatCurrency(loanAmount);

  // Set Preview Text based on status
  const previewText =
    status === "funded"
      ? "Your loan has been funded. Please allow up to 24 business hours for the funds to appear in your bank account."
      : status === "declined"
        ? "We have an update regarding your loan application."
        : "";

  const subject =
    config.subject || `${config.title} - ID: ${applicationId} | LongLake Loans`;

  const messageHtml = config.customBody
    ? config.customBody(safeDetails, formattedAmount)
    : `
        <p ${P}>Hi ${safeDetails.firstName},</p>
        <p ${P}>${config.message}</p>
      `;

  // Render Status-Specific Call to Action (CTA) Buttons
  let ctaButtonHtml = "";
  if (status === "funded") {
    ctaButtonHtml = renderButton(
      `${process.env.FRONTEND_URL}/track-loan?${new URLSearchParams({ applicationId, email })}`,
      "View application status",
    );
  } else if (status === "declined") {
    ctaButtonHtml = renderButton(`mailto:${CONTACT.email}`, "Contact support");
  } else if (
    [
      "bank_verification_failed",
      "bank_verification_pending",
      "bank_reverification",
    ].includes(status)
  ) {
    ctaButtonHtml = renderButton(
      status === "bank_reverification"
        ? `${process.env.FRONTEND_URL}/reconnect-bank-verification?applicationId=${applicationId}`
        : `${process.env.FRONTEND_URL}/verify-bank?applicationId=${applicationId}`,
      status === "bank_verification_pending"
        ? "Click Here to Securely Verify Your Bank"
        : status === "bank_reverification"
          ? "Reconnect my bank"
          : "Verify bank account",
    );
  }

  const html = renderEmailLayout({
    previewText,
    eyebrow: `${config.label} &middot; #${applicationId}`,
    tone: config.color,
    title: config.title,
    bodyHtml: `${messageHtml}${ctaButtonHtml}${
      config.signOff ? renderSignOff(config.signOff) : ""
    }`,
  });

  await sendMailgunEmail(email, subject, html);
}

export interface PostBankVerificationEmailDetails {
  applicationId: string;
  firstName: string;
  email: string;
  loanAmount: number;
}

/**
 * Confirmation sent after the applicant submits the verify-bank or
 * reconnect-bank-verification form. Mirrors the success state of the
 * frontend BankVerificationForm, which is identical for both modes.
 */
async function sendBankDetailsReceivedEmail(
  details: PostBankVerificationEmailDetails,
): Promise<void> {
  const { applicationId, email, loanAmount } = details;
  const firstName = escapeHtml(details.firstName);

  const trackUrl = `${process.env.FRONTEND_URL}/track-loan?${new URLSearchParams({ applicationId, email })}`;

  const html = renderEmailLayout({
    previewText:
      "Your banking verification has been submitted. Next, you'll complete a brief call with one of our live underwriter specialists.",
    eyebrow: "Bank details received",
    tone: COLOR.accent,
    title: "Thank you &mdash; your bank details were received",
    bodyHtml: `
      <p ${P}>Hi ${firstName},</p>
      <p ${P}>Your banking verification has been submitted.</p>
      <p ${P}>Next, you&apos;ll schedule or complete your brief call with one of our live underwriter specialists.</p>

      ${renderButton(CONTACT.tollFree.href, `Call ${CONTACT.tollFree.display}`)}

      ${renderDetails([
        ["Application ID", `#${applicationId}`],
        ["Loan Amount", formatCurrency(loanAmount)],
      ])}

      <p ${P}><a href="${trackUrl}" style="color: ${COLOR.ink}; font-weight: 500; text-decoration: underline; text-underline-offset: 3px;">Track your application &rarr;</a></p>

      <p ${P}>Need help? Email ${supportEmailLink} or call ${tollFreePhoneLink}.</p>
      ${renderSignOff("LongLake Loans Support")}
    `,
  });

  await sendMailgunEmail(
    email,
    `Thank you — your bank details were received - ID: ${applicationId} | LongLake Loans`,
    html,
  );
}

export async function sendPostBankVerificationEmail(
  details: PostBankVerificationEmailDetails,
): Promise<void> {
  await sendBankDetailsReceivedEmail(details);
}

export type BankVerificationSubmittedDetails = PostBankVerificationEmailDetails;

export async function sendReconnectBankVerificationSubmittedEmail(
  details: BankVerificationSubmittedDetails,
): Promise<void> {
  await sendBankDetailsReceivedEmail(details);
}
