import assert from "node:assert/strict";
import { sendStatusUpdateEmail, setEmailSender } from "./emailService";

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
        status: "bank_verification_pending",
        expectedSubject: "Action Required: Securely verify your bank account",
        expectedText: "Click Here to Securely Verify Your Bank",
      },
      {
        status: "bank_reverification",
        expectedSubject: "Action Required: Bank connection unsuccessful",
        expectedText: "Securely Re-Link My Bank Account",
      },
      {
        status: "request_a_call",
        expectedSubject: "URGENT: Please call LongLake Loans immediately",
        expectedText: "Please call us ASAP",
      },
      {
        status: "declined_pb",
        expectedSubject: "Update Required: Unsupported bank account type",
        expectedText: "online-only or prepaid bank",
      },
      {
        status: "declined_hd",
        expectedSubject: "Notice of Action: Your loan application status",
        expectedText: "unstable repayment history",
      },
      {
        status: "funded",
        expectedSubject:
          "Great News! Your LongLake Loans application is FUNDED",
        expectedText: "Welcome to the LongLake Loans family!",
      },
    ] as const;

    for (const testCase of cases) {
      await sendStatusUpdateEmail({
        applicationId: "12345",
        firstName: "Jane",
        email: "jane@example.com",
        loanAmount: 2500,
        status: testCase.status,
      });

      const lastMessage = sent[sent.length - 1];
      assert.equal(lastMessage?.subject, testCase.expectedSubject);
      assert.match(
        lastMessage?.html ?? "",
        new RegExp(
          testCase.expectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        ),
      );
    }
  } finally {
    setEmailSender();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
