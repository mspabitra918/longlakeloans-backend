import { query, queryOne, execute, transaction, type DbClient } from "../db";
import { encrypt, hashSSN, decrypt } from "../encryption";
import { sanitizeInput } from "../validation";
import { generateUniqueId } from "../utils";
import {
  cancelDripSequence,
  scheduleDripSequence,
} from "./dripScheduleService";
import { tracksBlockedByStatus } from "../queue/dripConfig";
import { pacificDayRange } from "../timezone";
import { randomUUID } from "node:crypto";
import { validate as isUuid } from "uuid";

/**
 * Cancels the drip tracks a new status locks out. The verify track is gated on
 * `bank_verification_pending`, so any other status — most commonly
 * `bank_verification_completed` — drops it. Never throws: drip bookkeeping must
 * not fail a status update.
 */
async function syncDripTracksForStatus(
  id: string,
  status: string,
): Promise<void> {
  console.log("Blocked tracks:", status, tracksBlockedByStatus(status));
  await cancelDripSequence(
    id,
    tracksBlockedByStatus(status),
    `application moved to "${status}"`,
  );
}

export interface CreateApplicationInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  ssn: string;
  driverLicenseNumber: string;
  driverLicenseState: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  employmentStatus: string;
  employerName: string;
  jobTitle: string;
  monthlyIncome: number;
  yearsEmployed: number;
  loanAmount: number;
  loanPurpose: string;
  loanTerm: number;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  bankAccountAge: string;
  bankBalanceStatus: string;
  accountType: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  assistedByLoanAgent?: string;
  tcpaConsent: boolean;
  privacyConsent: boolean;
  creditCheckConsent: boolean;
  ipAddress: string;
  userAgent: string;
  leadId?: string;
}

export interface SaveApplicationStepInput {
  sessionId: string;
  /**
   * The public 5-digit code the client already holds, when it has one. Used as a
   * fallback key so a client that lost its session id still updates its own row
   * rather than starting a second application.
   */
  applicationId?: string;
  step: number;
  data: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  pageUrl?: string;
  referrerUrl?: string;
}

export interface ApplicantIdentityMatch {
  email: string;
  phone: string;
  dateOfBirth: string;
  lastName: string;
}

/**
 * Raised when a step payload cannot be persisted as-is. The route turns this
 * into a 400 naming the offending field instead of an opaque 500 — a CHECK or
 * NOT NULL violation surfacing from Postgres tells the applicant nothing.
 */
export class ApplicationStepValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ApplicationStepValidationError";
    this.field = field;
  }
}

/**
 * The value domains enforced by the CHECK constraints on `loan_applications`.
 * Keep these in lockstep with schema.sql: a value that is not listed here is one
 * Postgres will reject, which aborts the whole step save.
 */
const ENUM_DOMAINS = {
  // `values` are the wizard's option values (components/apply/options.ts);
  // `labels` map the pre-refactor stored values so old drafts still save.
  housingStatus: {
    values: ["rent", "own", "family", "other"],
    labels: {
      own_with_mortgage: "own",
      own_outright: "own",
      living_with_family_friends: "family",
      living_with_family_or_friends: "family",
      live_with_family: "family",
      military_housing: "other",
    },
  },
  employmentStatus: {
    values: [
      "full_time",
      "part_time",
      "self_employed",
      "retired",
      "benefits",
      "unemployed",
    ],
    labels: {
      employed_full_time: "full_time",
      active_military: "full_time",
      employed_part_time: "part_time",
      disability: "benefits",
      social_security: "benefits",
      unemployment_benefits: "benefits",
      other_benefits: "benefits",
      student: "unemployed",
      not_currently_employed: "unemployed",
      not_employed: "unemployed",
    },
  },
  incomeSource: {
    values: [
      "employment",
      "self_employment",
      "social_security",
      "disability",
      "retirement",
      "other",
    ],
    labels: {
      retirement_pension: "retirement",
      retirement_or_pension: "retirement",
      pension_retirement: "retirement",
      unemployment: "other",
    },
  },
  payFrequency: {
    values: ["weekly", "biweekly", "semimonthly", "monthly"],
    labels: {
      every_two_weeks: "biweekly",
      every_2_weeks: "biweekly",
      bi_weekly: "biweekly",
      twice_a_month: "semimonthly",
      semi_monthly: "semimonthly",
    },
  },
  bankAccountAge: {
    values: ["lt_3m", "3_6m", "6_12m", "1_2y", "2y_plus"],
    labels: {
      under_6_months: "3_6m",
      "1_year": "1_2y",
      "2_years": "2y_plus",
      "3_years": "2y_plus",
      "4_years": "2y_plus",
      "5_plus_years": "2y_plus",
    },
  },
  currentBalanceBand: {
    values: ["lt_100", "100_500", "500_1000", "1000_5000", "5000_plus"],
    labels: {},
  },
  accountType: { values: ["checking", "savings"], labels: {} },
} as const satisfies Record<
  string,
  { values: readonly string[]; labels: Record<string, string> }
>;

const LOAN_TERMS = [12, 24, 36, 48];

/**
 * Every value `loan_applications.status` accepts (schema.sql CHECK). New
 * applications start at `bank_verification_pending`; a verified bank moves
 * them to `bank_verification_completed`.
 */
export const APPLICATION_STATUSES = [
  "bank_verification_pending",
  "bank_verification_completed",
  "bank_reverification",
  "request_a_call",
  "funded",
  "declined_pb",
  "declined_hd",
] as const;

/** The wizard's last step — banking details. */
const FINAL_APPLICATION_STEP = 3;

/**
 * Resolves a submitted value to one the database will accept. The wizard sends
 * the stored value (`own_with_mortgage`), but saved drafts and admin edits can
 * still carry the display label ("Own with mortgage"), so both are matched.
 * Anything unrecognised becomes `fallback` rather than a constraint violation.
 */
function normalizeEnum(
  raw: unknown,
  domain: { values: readonly string[]; labels: Record<string, string> },
  fallback: string | null = null,
): string | null {
  const candidate = String(raw ?? "").trim();
  if (!candidate) return fallback;

  const exact = domain.values.find((value) => value === candidate);
  if (exact) return exact;

  const caseInsensitive = domain.values.find(
    (value) => value.toLowerCase() === candidate.toLowerCase(),
  );
  if (caseInsensitive) return caseInsensitive;

  // "Employed — Full Time" and "3–5 years" both slug to the stored value.
  const slug = candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const bySlug = domain.values.find((value) => value === slug);
  if (bySlug) return bySlug;

  const mapped = domain.labels[candidate] ?? domain.labels[slug];
  return mapped && domain.values.includes(mapped) ? mapped : fallback;
}

/**
 * Parses a date into `YYYY-MM-DD`, returning null instead of throwing on junk.
 * Formats the local calendar date rather than going through toISOString(), which
 * shifts "04/12/1990" (parsed as local midnight) back a day east of UTC.
 */
function toDateOnly(raw: unknown): string | null {
  const candidate = String(raw ?? "").trim();
  if (!candidate) return null;

  // Already a date-only string — take it verbatim, no timezone in play.
  const isoDateOnly = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const parsed = new Date(`${candidate}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : candidate;
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;

  return [
    String(parsed.getFullYear()).padStart(4, "0"),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Parses a currency-ish input ("1,200", "$1200") into a finite number. */
function toAmount(raw: unknown): number {
  const parsed = Number(String(raw ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parses an optional whole-number answer (years at address, months in role).
 * Unanswered arrives as null — the wizard's NaN after JSON — and stays null.
 */
function toWholeNumber(raw: unknown): number | null {
  if (!hasValue(raw)) return null;
  const parsed = Math.floor(toAmount(raw));
  return parsed >= 0 ? parsed : null;
}

/** Trims free text to the column width so a long paste cannot abort the save. */
function clip(raw: unknown, maxLength: number): string {
  return String(raw ?? "")
    .trim()
    .slice(0, maxLength);
}

/** True when the applicant actually supplied something for this field. */
function hasValue(raw: unknown): boolean {
  return raw !== undefined && raw !== null && String(raw).trim() !== "";
}

/**
 * Checks the numeric/date columns whose CHECK and NOT NULL constraints cannot be
 * coalesced away. Out-of-range input has to be caught here: once Postgres raises
 * the violation the step save is lost and the applicant sees a generic failure.
 */
function assertPersistableRanges(
  merged: Record<string, unknown>,
  isNewApplication: boolean,
): void {
  const range = (
    key: string,
    field: string,
    label: string,
    min: number,
    max: number,
    required: boolean,
  ) => {
    if (!hasValue(merged[key])) {
      if (required && isNewApplication) {
        throw new ApplicationStepValidationError(field, `${label} is required.`);
      }
      return;
    }

    const amount = toAmount(merged[key]);
    if (amount < min || amount > max) {
      throw new ApplicationStepValidationError(
        field,
        `${label} must be between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")}.`,
      );
    }
  };

  // NOT NULL text columns: blank would otherwise surface as a 500 from Postgres.
  if (isNewApplication) {
    const required: Array<[string[], string]> = [
      [["loanPurpose"], "Loan purpose"],
      [["firstName"], "First name"],
      [["lastName"], "Last name"],
      [["email"], "Email"],
      [["phone", "mobilePhone"], "Phone"],
      [["streetAddress"], "Street address"],
      [["city"], "City"],
      [["state"], "State"],
      [["zipCode", "zip"], "ZIP code"],
    ];
    for (const [keys, label] of required) {
      if (!keys.some((key) => hasValue(merged[key]))) {
        throw new ApplicationStepValidationError(keys[0], `${label} is required.`);
      }
    }
  }

  range("loanAmount", "loanAmount", "Loan amount", 1000, 35000, true);
  range(
    "netMonthlyIncome",
    "netMonthlyIncome",
    "Net monthly income",
    500,
    50000,
    true,
  );
  range(
    "monthlyHousingCost",
    "monthlyHousingCost",
    "Monthly housing cost",
    0,
    15000,
    false,
  );
  range(
    "yearsAtAddress",
    "yearsAtAddress",
    "Years at address",
    0,
    100,
    false,
  );
  range(
    "employmentLengthMo",
    "employmentLengthMo",
    "Months in this role",
    0,
    1200,
    false,
  );

  if (hasValue(merged.dob)) {
    if (!toDateOnly(merged.dob)) {
      throw new ApplicationStepValidationError(
        "dob",
        "Date of birth is not a valid date.",
      );
    }
  } else if (isNewApplication) {
    throw new ApplicationStepValidationError(
      "dob",
      "Date of birth is required.",
    );
  }

  if (hasValue(merged.nextPayDate) && !toDateOnly(merged.nextPayDate)) {
    throw new ApplicationStepValidationError(
      "nextPayDate",
      "Next pay date is not a valid date.",
    );
  }
}

export interface DerivedApplicationFields {
  applicantAge: number | null;
  grossAnnualIncome: number;
  totalMonthlyIncome: number;
  debtToIncomeRatio: number;
  disposableIncome: number;
  paymentToIncomeRatio: number;
  jobTenureMonths: number;
  residenceTenureMonths: number;
  estimatedInstallment: number;
}

export function calculateDerivedApplicationFields(
  data: Record<string, unknown>,
): DerivedApplicationFields {
  const dob = data.dob ? new Date(String(data.dob)) : null;
  const applicantAge =
    dob && !Number.isNaN(dob.getTime())
      ? Math.floor((Date.now() - dob.getTime()) / 31557600000)
      : null;
  const totalMonthlyIncome = toAmount(data.netMonthlyIncome);
  const grossAnnualIncome = Math.round(totalMonthlyIncome * 12 * 1.28);
  const housingPayment = toAmount(data.monthlyHousingCost);
  const bureauObligations = Number(data.bureauReportedObligations || 0);
  const debtToIncomeRatio =
    totalMonthlyIncome > 0
      ? Number(
          (
            ((housingPayment + bureauObligations) / totalMonthlyIncome) *
            100
          ).toFixed(1),
        )
      : 0;
  const disposableIncome = Math.round(
    totalMonthlyIncome - housingPayment - bureauObligations,
  );
  const term = Number(data.loanTerm || 36);
  const principal = Number(data.loanAmount || 0);
  const monthlyRate = 0.1199 / 12;
  const estimatedInstallment =
    principal > 0
      ? Math.round(
          (principal * monthlyRate * (1 + monthlyRate) ** term) /
            ((1 + monthlyRate) ** term - 1),
        )
      : 0;
  const paymentToIncomeRatio =
    totalMonthlyIncome > 0
      ? Number(((estimatedInstallment / totalMonthlyIncome) * 100).toFixed(1))
      : 0;
  return {
    applicantAge,
    grossAnnualIncome,
    totalMonthlyIncome,
    debtToIncomeRatio,
    disposableIncome,
    paymentToIncomeRatio,
    estimatedInstallment,
    jobTenureMonths: toWholeNumber(data.employmentLengthMo) ?? 0,
    residenceTenureMonths: (toWholeNumber(data.yearsAtAddress) ?? 0) * 12,
  };
}

export async function findMatchingApplication(
  identity: ApplicantIdentityMatch,
  sessionId?: string,
): Promise<{ applicationId: string; status: string } | null> {
  return queryOne(
    `SELECT application_id AS "applicationId", status
     FROM loan_applications
     WHERE LOWER(email) = LOWER($1)
       AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')
       AND date_of_birth = $3::date
       AND LOWER(last_name) = LOWER($4)
       AND ($5::text IS NULL OR session_id IS DISTINCT FROM $5)
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      identity.email.trim(),
      identity.phone,
      // `''::date` raises 22007 — a blank or unparseable DOB has to become NULL,
      // which simply matches nothing.
      toDateOnly(identity.dateOfBirth),
      identity.lastName.trim(),
      sessionId || null,
    ],
  );
}

export async function findRecentDecline(
  identity: ApplicantIdentityMatch,
): Promise<{ applicationId: string; status: string } | null> {
  return queryOne(
    `SELECT application_id AS "applicationId", status
     FROM loan_applications
     WHERE LOWER(email) = LOWER($1)
       AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')
       AND date_of_birth = $3::date
       AND LOWER(last_name) = LOWER($4)
       AND status IN ('declined', 'declined_pb', 'declined_hd', 'rejected')
       AND created_at >= NOW() - INTERVAL '90 days'
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      identity.email.trim(),
      identity.phone,
      toDateOnly(identity.dateOfBirth),
      identity.lastName.trim(),
    ],
  );
}

/**
 * Rows that are still mid-wizard and may therefore be resumed. Anything past
 * bank verification is a decided application: a late step save must never
 * reopen one.
 */
const RESUMABLE_STATUSES = ["bank_verification_pending"];

interface ExistingApplicationRow {
  id: string;
  application_id: string;
  application_data: Record<string, unknown>;
  session_id: string;
  status: string;
}

const EXISTING_APPLICATION_COLUMNS = `
  id,
  application_id,
  application_data,
  session_id,
  status
`;

/**
 * Last-resort lookup for a step 2/3 save whose session id and application id
 * are both gone — a resume from another device, or after site data was cleared.
 * Matching on the same four identity fields as the step 1 duplicate guard keeps
 * the applicant on the row step 1 created instead of forking a new one.
 */
export async function findResumableApplicationByIdentity(
  identity: ApplicantIdentityMatch,
): Promise<ExistingApplicationRow | null> {
  const dateOfBirth = toDateOnly(identity.dateOfBirth);
  if (!identity.email.trim() || !identity.lastName.trim() || !dateOfBirth) {
    return null;
  }

  return queryOne<ExistingApplicationRow>(
    `SELECT ${EXISTING_APPLICATION_COLUMNS}
     FROM loan_applications
     WHERE LOWER(email) = LOWER($1)
       AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')
       AND date_of_birth = $3::date
       AND LOWER(last_name) = LOWER($4)
       AND status = ANY($5::text[])
       AND created_at >= NOW() - INTERVAL '30 days'
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      identity.email.trim(),
      identity.phone,
      dateOfBirth,
      identity.lastName.trim(),
      RESUMABLE_STATUSES,
    ],
  );
}

export interface SoftPullDecision {
  decision: "prequalified" | "declined";
  reason: string;
}

export function runSoftPullPrequalification(
  data: Record<string, unknown>,
): SoftPullDecision {
  const income = Number(data.netMonthlyIncome ?? 0);
  const loanAmount = Number(data.loanAmount ?? 0);

  if (income < 500 || loanAmount < 1000) {
    return { decision: "declined", reason: "income_or_loan_amount_ineligible" };
  }

  return { decision: "prequalified", reason: "soft_pull_eligibility_passed" };
}

export interface MlaCheckInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  ssn: string;
}

export async function runMlaCoveredBorrowerCheck(
  input: MlaCheckInput,
): Promise<{ required: boolean; coveredBorrower: boolean }> {
  const maxMapr = Number(process.env.PRODUCT_MAX_MAPR_PERCENT ?? 0);
  if (maxMapr <= 36) {
    return { required: false, coveredBorrower: false };
  }

  const endpoint = process.env.MLA_CHECK_URL;
  if (!endpoint) {
    throw new Error("MLA_CHECK_URL is required when product MAPR exceeds 36%");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.MLA_CHECK_API_KEY
        ? { Authorization: `Bearer ${process.env.MLA_CHECK_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      ssn: input.ssn.replace(/\D/g, ""),
    }),
  });

  if (!response.ok) {
    throw new Error(`MLA check failed with status ${response.status}`);
  }

  const result = (await response.json()) as { coveredBorrower?: boolean };
  if (typeof result.coveredBorrower !== "boolean") {
    throw new Error("MLA check returned an invalid response");
  }

  return { required: true, coveredBorrower: result.coveredBorrower };
}

/**
 * Every column value the writes below need, derived from one merged wizard
 * payload. Shared by the single-transaction submit and the deprecated per-step
 * save so the two can never normalize the same field differently.
 */
interface ApplicationColumnValues {
  // loan
  loan_amount: number;
  loan_term: number | null;
  loan_purpose: string;
  loan_purpose_other_detail: string;

  // personal
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string | null;
  ssn_encrypted: string | null;
  ssn_hash: string | null;
  dl_number_encrypted: string | null;
  dl_state: string;
  street_address: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  years_at_address: number | null;
  housing_status: string;
  monthly_housing_cost: number | null;

  // employment
  employment_status: string;
  employer_name: string;
  job_title: string;
  employment_length_mo: number | null;
  employer_phone: string;
  pay_frequency: string;
  next_pay_date: string | null;
  net_monthly_income: number | null;
  income_source: string;

  // banking
  bank_name: string;
  account_type: string | null;
  routing_number_encrypted: string | null;
  routing_number_hash: string | null;
  account_number_encrypted: string | null;
  bank_account_age: string | null;
  current_balance_band: string | null;
  direct_deposit: boolean;

  // consent
  esign_consent: boolean;
  privacy_consent: boolean;
  credit_pull_consent: boolean;
  tcpa_consent: boolean;

  ip_address: string;
  user_agent: string;
}

const OPTIONAL_TEXT_COLUMNS = [
  "loan_purpose_other_detail",
  "dl_state",
  "address_line2",
  "employer_name",
  "job_title",
  "employer_phone",
  "bank_name",
] as const satisfies ReadonlyArray<keyof ApplicationColumnValues>;

/**
 * Reads the wizard's canonical key (see flattenApplicationForm), falling back to
 * the names pre-refactor drafts were saved under.
 */
function pick(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (hasValue(data[key])) return data[key];
  }
  return undefined;
}

function buildApplicationColumnValues(
  mergedData: Record<string, unknown>,
  context: { ipAddress: string; userAgent: string },
): ApplicationColumnValues {
  const ssn = String(mergedData.ssn ?? "").replace(/\D/g, "");
  const dlNumber = String(mergedData.dlNumber ?? "").trim();
  const accountNumber = String(mergedData.accountNumber ?? "").trim();
  const routingNumber = String(mergedData.routingNumber ?? "").replace(/\D/g, "");
  const employmentStatus = normalizeEnum(
    mergedData.employmentStatus,
    ENUM_DOMAINS.employmentStatus,
    "unemployed",
  ) as string;

  return {
    loan_amount: toAmount(mergedData.loanAmount),
    // Null (unanswered / off-list) keeps any stored term on the step-save path
    // and satisfies the column's CHECK constraint on insert.
    loan_term: (() => {
      const term = toWholeNumber(mergedData.loanTerm);
      return term !== null && LOAN_TERMS.includes(term) ? term : null;
    })(),
    loan_purpose: clip(mergedData.loanPurpose, 50),
    loan_purpose_other_detail: clip(
      pick(mergedData, "loanPurposeOther", "purposeOtherDetail"),
      120,
    ),

    first_name: clip(mergedData.firstName, 40),
    last_name: clip(mergedData.lastName, 40),
    email: clip(mergedData.email, 255),
    phone: clip(pick(mergedData, "phone", "mobilePhone"), 20),
    date_of_birth: toDateOnly(pick(mergedData, "dob", "dateOfBirth")),
    ssn_encrypted: ssn ? encrypt(ssn) : null,
    ssn_hash: ssn ? hashSSN(ssn) : null,
    dl_number_encrypted: dlNumber ? encrypt(dlNumber) : null,
    dl_state: clip(mergedData.dlState, 5),
    street_address: clip(mergedData.streetAddress, 100),
    address_line2: clip(pick(mergedData, "addressLine2", "aptUnit"), 20),
    city: clip(mergedData.city, 50),
    state: clip(mergedData.state, 5),
    zip_code: clip(pick(mergedData, "zipCode", "zip"), 5),
    years_at_address: toWholeNumber(mergedData.yearsAtAddress),
    housing_status: normalizeEnum(
      mergedData.housingStatus,
      ENUM_DOMAINS.housingStatus,
      "other",
    ) as string,
    // Null means "leave whatever is already stored" on the step-save path.
    monthly_housing_cost: hasValue(
      pick(mergedData, "monthlyHousingCost", "monthlyHousingPayment"),
    )
      ? toAmount(pick(mergedData, "monthlyHousingCost", "monthlyHousingPayment"))
      : null,

    employment_status: employmentStatus,
    employer_name: clip(mergedData.employerName, 60),
    job_title: clip(mergedData.jobTitle, 50),
    employment_length_mo: toWholeNumber(mergedData.employmentLengthMo),
    employer_phone: clip(mergedData.employerPhone, 20),
    pay_frequency: normalizeEnum(
      mergedData.payFrequency,
      ENUM_DOMAINS.payFrequency,
      "monthly",
    ) as string,
    next_pay_date: toDateOnly(mergedData.nextPayDate),
    net_monthly_income: hasValue(mergedData.netMonthlyIncome)
      ? toAmount(mergedData.netMonthlyIncome)
      : null,
    income_source: normalizeEnum(
      pick(mergedData, "incomeSource", "primaryIncomeType"),
      ENUM_DOMAINS.incomeSource,
      "other",
    ) as string,

    bank_name: clip(mergedData.bankName, 100),
    account_type: normalizeEnum(mergedData.accountType, ENUM_DOMAINS.accountType),
    routing_number_encrypted: routingNumber ? encrypt(routingNumber) : null,
    routing_number_hash: routingNumber ? hashSSN(routingNumber) : null,
    account_number_encrypted: accountNumber ? encrypt(accountNumber) : null,
    bank_account_age: normalizeEnum(
      mergedData.accountAge,
      ENUM_DOMAINS.bankAccountAge,
    ),
    current_balance_band: normalizeEnum(
      mergedData.currentBalanceBand,
      ENUM_DOMAINS.currentBalanceBand,
    ),
    direct_deposit: [true, "Yes", "yes", "true"].includes(
      mergedData.directDeposit as never,
    ),

    esign_consent: Boolean(mergedData.esignConsent),
    privacy_consent: Boolean(mergedData.privacyConsent),
    credit_pull_consent: Boolean(
      pick(mergedData, "creditPullConsent", "softCreditConsent"),
    ),
    tcpa_consent: Boolean(mergedData.tcpaConsent),

    ip_address: clip(context.ipAddress, 45) || "unknown",
    user_agent: context.userAgent,
  };
}

export interface SubmitApplicationInput {
  /**
   * The wizard's client-side id. Carried for traceability only — nothing is
   * looked up by it, because the row is created once, here, at the end.
   */
  sessionId?: string;
  data: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  pageUrl?: string;
  referrerUrl?: string;
}

/**
 * Funnel timestamps the wizard collected client-side. Previously these columns
 * were filled by whichever step save happened to be running; with a single
 * write the client is the only thing that still knows when each step finished.
 * Anything unparseable, in the future, or older than a day is discarded in
 * favour of the submit time rather than being written as-is.
 */
function resolveStepTimestamp(raw: unknown, submittedAt: Date): string {
  const parsed = new Date(String(raw ?? ""));
  if (Number.isNaN(parsed.getTime())) return submittedAt.toISOString();

  const ageMs = submittedAt.getTime() - parsed.getTime();
  if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) return submittedAt.toISOString();

  return parsed.toISOString();
}

/**
 * Writes a completed application in a single transaction.
 *
 * The wizard collects all three steps client-side and posts them once, so there
 * is no existing row to find, no JSON merge, and no partial state to reconcile —
 * the application either exists in full or not at all. Callers must have run the
 * eligibility gates (decline, duplicate, prequal, MLA) beforehand and folded
 * their outcome into `data`.
 */
export async function submitApplication(input: SubmitApplicationInput): Promise<{
  id: string;
  applicationId: string;
  status: string;
  derivedData: DerivedApplicationFields;
}> {
  const data = input.data ?? {};

  // Range-check before touching the database: a CHECK violation surfacing from
  // Postgres would abort the whole submission with an opaque 500.
  assertPersistableRanges(data, true);

  const derivedData = calculateDerivedApplicationFields(data);
  const values = buildApplicationColumnValues(data, {
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  const status =
    data.prequalDecision === "declined" || data.mlaCoveredBorrower === true
      ? "declined_pb"
      : data.bankAuthMode === "instant"
        ? "bank_verification_completed"
        : "bank_verification_pending";

  const {
    ssn,
    confirmSsn,
    dlNumber,
    accountNumber,
    confirmAccountNumber,
    routingNumber,
    ...safeData
  } = data;

  const submittedAt = new Date();
  const step1StartedAt = resolveStepTimestamp(data.step1StartedAt, submittedAt);
  const step1SubmittedAt = resolveStepTimestamp(
    data.step1SubmittedAt,
    submittedAt,
  );
  const step2SubmittedAt = resolveStepTimestamp(
    data.step2SubmittedAt,
    submittedAt,
  );
  const step3SubmittedAt = submittedAt.toISOString();

  const totalTimeOnForm = Math.max(
    0,
    Math.round(
      (submittedAt.getTime() - new Date(step1StartedAt).getTime()) / 1000,
    ),
  );

  const applicationData = {
    ...safeData,
    derivedData,
    sessionId: input.sessionId || "",
    clientIp: input.ipAddress,
    userAgent: input.userAgent,
    pageUrl: input.pageUrl || data.pageUrl || "",
    referrerUrl: input.referrerUrl || data.referrerUrl || "",
    step1StartedAt,
    step1SubmittedAt,
    step2SubmittedAt,
    step3SubmittedAt,
    totalTimeOnForm,
  };

  const id = randomUUID();

  // generateUniqueId checks-then-inserts, so two concurrent submissions can pick
  // the same 5-digit code. The insert below retries on the unique violation.
  let applicationId = await generateUniqueId(
    "loan_applications",
    "application_id",
  );

  for (let attempt = 0; ; attempt += 1) {
    try {
      const row: Record<string, unknown> = {
        id,
        application_id: applicationId,
        session_id: input.sessionId || null,
        application_data: JSON.stringify(applicationData),

        page_url: input.pageUrl || "",
        referrer_url: input.referrerUrl || "",

        ...values,
        monthly_housing_cost: values.monthly_housing_cost ?? 0,
        bank_verification_completed: data.bankAuthMode === "instant",
        status,
      };

      // Optional free-text columns store NULL, not "", when left blank.
      for (const column of OPTIONAL_TEXT_COLUMNS) {
        if (row[column] === "") row[column] = null;
      }

      const columns = Object.keys(row);
      await transaction(async (tx) => {
        await tx.query(
          `INSERT INTO loan_applications (${columns.join(", ")})
           VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
          columns.map((column) => row[column]),
        );
      });
      break;
    } catch (error) {
      const isIdCollision =
        (error as { code?: string })?.code === "23505" &&
        (error as { constraint?: string })?.constraint ===
          "loan_applications_application_id_key";

      if (!isIdCollision || attempt >= 4) throw error;

      applicationId = await generateUniqueId(
        "loan_applications",
        "application_id",
      );
    }
  }

  // Only a manually-entered account still owes us a verification, so only that
  // status starts the chase sequence. Never throws — drip bookkeeping must not
  // fail a submission that is already committed.
  if (status === "bank_verification_pending") {
    await scheduleDripSequence(id, new Date());
  }

  return { id, applicationId, status, derivedData };
}

/**
 * @deprecated The wizard now collects all three steps client-side and posts
 * once to `submitApplication`, which writes the application in a single
 * transaction. This per-step upsert stays only so sessions that were already
 * in flight when that shipped can finish; remove it once they have drained.
 */
export async function saveApplicationStep(
  input: SaveApplicationStepInput,
): Promise<{
  applicationId: string;
  status: string;
  derivedData: DerivedApplicationFields;
}> {
  // ============================================================
  // 1. FIND EXISTING APPLICATION
  // ============================================================

  let existing = await queryOne<ExistingApplicationRow>(
    `SELECT ${EXISTING_APPLICATION_COLUMNS}
     FROM loan_applications
     WHERE session_id = $1
        OR id::text = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.sessionId],
  );

  // The session id is the primary key of the wizard, but it does not always
  // survive the round trip — a closed tab, a cleared browser, a different
  // device. Each fallback below re-attaches the save to the row step 1 created;
  // without them the row is missing and a second application gets minted with
  // its own number and status, which is what admins saw as duplicates.
  if (!existing && input.applicationId) {
    existing = await queryOne<ExistingApplicationRow>(
      `SELECT ${EXISTING_APPLICATION_COLUMNS}
       FROM loan_applications
       WHERE application_id = $1
         AND status = ANY($2::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.applicationId, RESUMABLE_STATUSES],
    );
  }

  if (!existing && input.step > 1) {
    existing = await findResumableApplicationByIdentity({
      email: String(input.data.email || ""),
      phone: String(input.data.mobilePhone || input.data.phone || ""),
      dateOfBirth: String(input.data.dob || input.data.dateOfBirth || ""),
      lastName: String(input.data.lastName || ""),
    });
  }

  // ============================================================
  // 2. MERGE APPLICATION DATA
  // ============================================================

  const mergedData = {
    ...(existing?.application_data ?? {}),
    ...(input.data ?? {}),
  } as Record<string, unknown>;

  const id = existing?.id ?? randomUUID();

  // generateUniqueId checks-then-inserts, so two concurrent step saves can pick
  // the same 5-digit code. The write below retries on the unique violation.
  let applicationId =
    existing?.application_id ??
    (await generateUniqueId("loan_applications", "application_id"));

  // ============================================================
  // 4. RESOLVE STATUS
  // ============================================================

  // Mid-wizard rows sit at the default status until step 3 settles the bank.
  const resolvedStatus =
    input.data.prequalDecision === "declined"
      ? "declined_pb"
      : input.step === FINAL_APPLICATION_STEP &&
          (input.data as Record<string, unknown>).bankAuthMode !== "manual"
        ? "bank_verification_completed"
        : "bank_verification_pending";

  // ============================================================
  // 5. REMOVE SENSITIVE VALUES FROM application_data
  // ============================================================

  const {
    ssn,
    confirmSsn,
    dlNumber,
    accountNumber,
    confirmAccountNumber,
    routingNumber,
    ...safeMergedData
  } = mergedData;

  // ============================================================
  // 6. DERIVED DATA
  // ============================================================

  const derivedData = calculateDerivedApplicationFields(mergedData);

  // ============================================================
  // 7. APPLICATION JSON DATA
  // ============================================================

  const applicationData = {
    ...safeMergedData,
    derivedData,
    sessionId: input.sessionId,
    clientIp: input.ipAddress,
    userAgent: input.userAgent,
    pageUrl: input.pageUrl || mergedData.pageUrl || "",
    referrerUrl: input.referrerUrl || mergedData.referrerUrl || "",
    step1StartedAt:
      (mergedData.step1StartedAt as string) || new Date().toISOString(),
    step1SubmittedAt:
      input.step === 1 ? new Date().toISOString() : mergedData.step1SubmittedAt,
    step2SubmittedAt:
      input.step === 2 ? new Date().toISOString() : mergedData.step2SubmittedAt,
    step3SubmittedAt:
      input.step === 3 ? new Date().toISOString() : mergedData.step3SubmittedAt,
  };

  // ============================================================
  // 8. COLUMN VALUES
  // ============================================================

  assertPersistableRanges(mergedData, !existing);

  // Shared with submitApplication so the two write paths can never normalize
  // the same field differently.
  const values = buildApplicationColumnValues(mergedData, {
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // ============================================================
  // 9. PERSIST
  // ============================================================

  // One statement either way, so a failure can never leave a half-written row
  // that the next attempt finds and updates instead of inserting.
  const persist = () =>
    transaction(async (tx) => {
      if (existing) {
        const params: unknown[] = [];
        const param = (value: unknown) => {
          params.push(value);
          return `$${params.length}`;
        };

        const sets = [
          `session_id = ${param(input.sessionId)}`,
          `application_id = ${param(applicationId)}`,
          `application_data = ${param(JSON.stringify(applicationData))}::jsonb`,
          `page_url = COALESCE(NULLIF(${param(input.pageUrl || "")}, ''), page_url)`,
          `referrer_url = COALESCE(NULLIF(${param(input.referrerUrl || "")}, ''), referrer_url)`,
          `status = ${param(resolvedStatus)}`,
          `updated_at = NOW()`,
        ];

        // A value this step did not carry ("" / null) keeps what is stored, so a
        // step-2 save cannot wipe step-1 columns or trip their NOT NULLs.
        for (const [column, value] of Object.entries(values)) {
          if (column === "loan_amount") {
            sets.push(
              `loan_amount = CASE WHEN ${param(value)}::numeric > 0 THEN $${params.length}::numeric ELSE loan_amount END`,
            );
          } else if (typeof value === "string") {
            sets.push(`${column} = COALESCE(NULLIF(${param(value)}, ''), ${column})`);
          } else {
            sets.push(`${column} = COALESCE(${param(value)}, ${column})`);
          }
        }

        if (mergedData.bankAuthMode === "instant") {
          sets.push(`bank_verification_completed = TRUE`);
        }

        await tx.query(
          `UPDATE loan_applications SET ${sets.join(", ")} WHERE id = ${param(id)}`,
          params,
        );
        return;
      }

      const row: Record<string, unknown> = {
        id,
        application_id: applicationId,
        session_id: input.sessionId,
        application_data: JSON.stringify(applicationData),
        page_url: input.pageUrl || "",
        referrer_url: input.referrerUrl || "",
        ...values,
        monthly_housing_cost: values.monthly_housing_cost ?? 0,
        bank_verification_completed: mergedData.bankAuthMode === "instant",
        status: resolvedStatus,
      };

      for (const column of OPTIONAL_TEXT_COLUMNS) {
        if (row[column] === "") row[column] = null;
      }

      const columns = Object.keys(row);
      await tx.query(
        `INSERT INTO loan_applications (${columns.join(", ")})
         VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
        columns.map((column) => row[column]),
      );
    });

  // Retry a colliding application_id rather than surfacing it as a save failure.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await persist();
      break;
    } catch (error) {
      const isIdCollision =
        (error as { code?: string; constraint?: string })?.code === "23505" &&
        (error as { constraint?: string })?.constraint ===
          "loan_applications_application_id_key";

      if (!isIdCollision || existing || attempt >= 4) throw error;

      applicationId = await generateUniqueId(
        "loan_applications",
        "application_id",
      );
    }
  }

  // ============================================================
  // 19. DRIP SEQUENCE
  // ============================================================

  // The drip only starts once the applicant has finished the final step and the
  // file is genuinely waiting on bank verification. Starting it earlier would
  // chase a prequalified applicant for a verification they cannot do yet.
  const isFinalStep = input.step === FINAL_APPLICATION_STEP;

  if (resolvedStatus === "bank_verification_completed") {
    await cancelDripSequence(id);
  } else if (isFinalStep && resolvedStatus === "bank_verification_pending") {
    await scheduleDripSequence(id, new Date());
  }

  // ============================================================
  // 20. RETURN
  // ============================================================

  return {
    applicationId,
    status: resolvedStatus,
    derivedData,
  };
}

export interface ApplicationRow {
  id: string;
  application_id: string;
  routing_number_encrypted: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  ssn_encrypted: string;
  ssn_hash: string;
  dl_number_encrypted: string;
  dl_state: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  address_line2: string | null;
  years_at_address: number | null;
  housing_status: string;
  monthly_housing_cost: number;
  employment_status: string;
  employer_name: string;
  job_title: string;
  employment_length_mo: number | null;
  employer_phone: string | null;
  pay_frequency: string;
  next_pay_date: string | null;
  net_monthly_income: number;
  income_source: string;
  loan_amount: number;
  loan_purpose: string;
  loan_purpose_other_detail: string | null;
  loan_term: number | null;
  bank_name: string;
  current_balance_band: string | null;
  direct_deposit: boolean;
  bank_account_age: string;
  account_number_encrypted: string;
  account_type: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  assisted_by_loan_agent: string;
  tcpa_consent: boolean;
  privacy_consent: boolean;
  esign_consent: boolean;
  credit_pull_consent: boolean;
  ip_address: string;
  user_agent: string;
  status: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  funded_at: string | null;
  bank_verification_completed: string;
}
export interface ApplicationRowExport {
  id: string;
  application_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  ssn_encrypted: string;
  ssn_hash: string;
  dl_number_encrypted: string;
  dl_state: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  address_line2: string | null;
  years_at_address: number | null;
  housing_status: string;
  monthly_housing_cost: number;
  employment_status: string;
  employer_name: string;
  job_title: string;
  employment_length_mo: number | null;
  employer_phone: string | null;
  pay_frequency: string;
  next_pay_date: string | null;
  net_monthly_income: number;
  income_source: string;
  loan_amount: number;
  loan_purpose: string;
  loan_purpose_other_detail: string | null;
  loan_term: number | null;
  bank_name: string;
  current_balance_band: string | null;
  direct_deposit: boolean;
  account_number_encrypted: string;
  bank_account_age: string;
  account_type: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  assisted_by_loan_agent: string;
  tcpa_consent: boolean;
  privacy_consent: boolean;
  ip_address: string;
  user_agent: string;
  status: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  funded_at: string | null;
  bank_verification_completed: string;
  ssn_decrypted: string | null;
  dl_decrypted: string | null;
  account_decrypted: string | null;
  verification_status: string;
  bank_verification: {
    banking_username_decrypted: string | null;
    banking_password_decrypted: string | null;
    verification_status: string;
  };
}

export interface ApplicationBank {
  application_id: string;
  banking_username_encrypted: string;
  banking_password_encrypted: string;
  verification_status: string;
}

/**
 * Legacy single-request flow (POST /api/apply). Translates its flat input into
 * the wizard's canonical keys so it shares submitApplication's column mapping.
 */
export async function createApplication(
  input: CreateApplicationInput,
): Promise<{ id: string }> {
  const data: Record<string, unknown> = {
    loanAmount: input.loanAmount,
    loanPurpose: input.loanPurpose,
    firstName: sanitizeInput(input.firstName || ""),
    lastName: sanitizeInput(input.lastName || ""),
    email: sanitizeInput(input.email || ""),
    phone: sanitizeInput(input.phone || ""),
    dob: input.dateOfBirth,
    ssn: input.ssn,
    dlNumber: input.driverLicenseNumber,
    dlState: input.driverLicenseState,
    streetAddress: sanitizeInput(input.streetAddress || ""),
    city: sanitizeInput(input.city || ""),
    state: input.state,
    zipCode: sanitizeInput(input.zipCode || ""),
    employmentStatus: input.employmentStatus,
    employerName: sanitizeInput(input.employerName || ""),
    jobTitle: sanitizeInput(input.jobTitle || ""),
    employmentLengthMo: Math.round((input.yearsEmployed ?? 0) * 12),
    netMonthlyIncome: input.monthlyIncome,
    bankName: sanitizeInput(input.bankName || ""),
    accountNumber: input.accountNumber,
    routingNumber: input.routingNumber,
    accountAge: input.bankAccountAge,
    accountType: input.accountType,
    tcpaConsent: input.tcpaConsent,
    privacyConsent: input.privacyConsent,
    creditPullConsent: input.creditCheckConsent,
  };

  assertPersistableRanges(data, true);

  const values = buildApplicationColumnValues(data, {
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  const {
    ssn,
    dlNumber,
    accountNumber,
    routingNumber,
    ...safeData
  } = data;

  const id = randomUUID();
  const applicationId = await generateUniqueId(
    "loan_applications",
    "application_id",
  );

  const row: Record<string, unknown> = {
    id,
    application_id: applicationId,
    application_data: JSON.stringify({ ...safeData, leadId: input.leadId || "" }),
    ...values,
    monthly_housing_cost: values.monthly_housing_cost ?? 0,
    loan_term: LOAN_TERMS.includes(input.loanTerm) ? input.loanTerm : null,
    utm_source: sanitizeInput(input.utmSource || ""),
    utm_medium: sanitizeInput(input.utmMedium || ""),
    utm_campaign: sanitizeInput(input.utmCampaign || ""),
    utm_content: sanitizeInput(input.utmContent || ""),
    assisted_by_loan_agent: sanitizeInput(input.assistedByLoanAgent || ""),
    status: "bank_verification_pending",
  };

  for (const column of OPTIONAL_TEXT_COLUMNS) {
    if (row[column] === "") row[column] = null;
  }

  const columns = Object.keys(row);
  await query(
    `INSERT INTO loan_applications (${columns.join(", ")})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    columns.map((column) => row[column]),
  );

  return { id };
}

export async function getApplicationById(
  id: string,
): Promise<ApplicationRow | null> {
  const isUuid = (str: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  // If input is a valid UUID, search both UUID 'id' and 'application_id'
  if (isUuid(id)) {
    return queryOne<ApplicationRow>(
      "SELECT * FROM loan_applications WHERE id::text = $1 OR application_id::text = $1",
      [id],
    );
  }

  // If input is numeric/text (like "95402"), search only columns that support text/integer values
  return queryOne<ApplicationRow>(
    "SELECT * FROM loan_applications WHERE application_id::text = $1",
    [id],
  );
}

// export async function getApplicationByIdLookUp(
//   id: string,
// ): Promise<ApplicationRow | null> {
//   return queryOne<ApplicationRow>(
//     "SELECT * FROM loan_applications WHERE id::text = $1",
//     [id],
//   );
// }

export async function getApplicationByIdLookUp(
  id: string,
): Promise<ApplicationRow | null> {
  return queryOne<ApplicationRow>(
    `SELECT * FROM loan_applications 
     WHERE id::text = $1 OR application_id::text = $1 
     LIMIT 1`,
    [id],
  );
}

export async function getApplication(
  id: string,
): Promise<ApplicationRow | null> {
  return queryOne<ApplicationRow>(
    "SELECT * FROM loan_applications WHERE application_id = $1",
    [id],
  );
}

function safeDecrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    return null;
  }
}

export async function getApplicationByIdDecrypted(id: string): Promise<
  | (ApplicationRow & {
      ssn_decrypted: string | null;
      dl_decrypted: string | null;
      account_decrypted: string | null;
    })
  | null
> {
  const app = await getApplicationById(id);
  if (!app) return null;

  return {
    ...app,
    ssn_decrypted: safeDecrypt(app.ssn_encrypted),
    dl_decrypted: safeDecrypt(app.dl_number_encrypted),
    account_decrypted: safeDecrypt(app.account_number_encrypted),
  };
}

export interface ListApplicationsOptions {
  status?: string;
  country?: string;
  search?: string;
  date?: string;
  /** Inclusive Pacific calendar days (YYYY-MM-DD); either end may be omitted. */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function listApplications(
  options: ListApplicationsOptions = {},
): Promise<{ applications: ApplicationRow[]; total: number }> {
  const {
    status,
    country,
    search,
    date,
    dateFrom: rangeFrom,
    dateTo: rangeTo,
    page = 1,
    limit = 20,
    sortBy = "created_at",
    sortOrder = "desc",
  } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
  //   conditions.push(
  //     `created_at >= $${paramIndex}::date AND created_at < ($${paramIndex}::date + INTERVAL '1 day')`,
  //   );
  //   params.push(date);
  //   paramIndex++;
  // }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const { dateFrom, dateTo } = pacificDayRange(date);

    if (dateFrom && dateTo) {
      conditions.push(
        `created_at >= $${paramIndex} AND created_at <= $${paramIndex + 1}`,
      );

      params.push(dateFrom);
      params.push(dateTo);
      paramIndex += 2;
    }
  }
  // Date range (Pacific days, inclusive on both ends)
  if (rangeFrom && ISO_DAY.test(rangeFrom)) {
    const { dateFrom } = pacificDayRange(rangeFrom);
    if (dateFrom) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(dateFrom);
    }
  }
  if (rangeTo && ISO_DAY.test(rangeTo)) {
    const { dateTo } = pacificDayRange(rangeTo);
    if (dateTo) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(dateTo);
    }
  }
  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }
  if (country) {
    conditions.push(`country = $${paramIndex++}`);
    params.push(country);
  }
  if (search) {
    const digitsOnly = search.replace(/\D/g, "");
    const isNumericSearch =
      digitsOnly.length > 0 && search.replace(/[\s\-().+]/g, "") === digitsOnly;

    // 9-digit input → could be SSN. Try all plausible stored formats.
    if (isNumericSearch && digitsOnly.length === 9) {
      const formatted = `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 5)}-${digitsOnly.slice(5)}`;
      const hashes = Array.from(
        new Set([hashSSN(digitsOnly), hashSSN(formatted), hashSSN(search)]),
      );
      conditions.push(
        `(ssn_hash = ANY($${paramIndex++}) OR REGEXP_REPLACE(phone, '[^0-9]', '', 'g') ILIKE $${paramIndex++})`,
      );
      params.push(hashes);
      params.push(`%${digitsOnly}%`);
    } else if (isNumericSearch) {
      // Phone / ID numeric lookup — strip formatting from stored phone
      conditions.push(
        `(
      REGEXP_REPLACE(phone, '[^0-9]', '', 'g') ILIKE $${paramIndex}
      OR id::text ILIKE $${paramIndex}
      OR application_id::text ILIKE $${paramIndex}
    )`,
      );
      params.push(`%${digitsOnly}%`);
      paramIndex++;
    } else {
      // Text search: split by spaces and require all words to match
      const searchWords = search.split(/\s+/).filter((word) => word.length > 0);
      if (searchWords.length > 0) {
        const wordConditions: string[] = [];
        for (const word of searchWords) {
          wordConditions.push(
            `(first_name ILIKE $${paramIndex}
            OR last_name ILIKE $${paramIndex}
            OR email ILIKE $${paramIndex}
            OR phone ILIKE $${paramIndex}
            OR id::text ILIKE $${paramIndex}
            OR application_id::text ILIKE $${paramIndex}
            OR (first_name || ' ' || last_name) ILIKE $${paramIndex})`,
          );
          params.push(`%${word}%`);
          paramIndex++;
        }
        conditions.push(`(${wordConditions.join(" AND ")})`);
      }
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const allowedSortColumns = [
    "created_at",
    "updated_at",
    "loan_amount",
    "status",
    "first_name",
    "last_name",
    "email",
  ];
  const safeSortBy = allowedSortColumns.includes(sortBy)
    ? sortBy
    : "created_at";
  const safeSortOrder = sortOrder === "asc" ? "ASC" : "DESC";

  const offset = (page - 1) * limit;

  const [applications, countResult] = await Promise.all([
    query<ApplicationRow>(
      `SELECT * FROM loan_applications ${whereClause}
       ORDER BY ${safeSortBy} ${safeSortOrder}
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM loan_applications ${whereClause}`,
      params,
    ),
  ]);

  return {
    applications,
    total: parseInt(countResult[0]?.count || "0", 10),
  };
}

export async function listAllApplications() {
  try {
    const apps = await query<ApplicationRow>(
      `SELECT * FROM loan_applications ORDER BY created_at DESC`,
    );
    const bankRecords = await query<ApplicationBank>(
      `SELECT application_id, banking_username_encrypted, banking_password_encrypted, verification_status FROM bank_verification`,
    );

    const bankMap = new Map<string, ApplicationBank>();
    bankRecords.forEach((record) => {
      bankMap.set(record.application_id, record);
    });

    return apps.map((app) => {
      const bankData = bankMap.get(app.id);

      return {
        ...app,

        ssn_decrypted: safeDecrypt(app.ssn_encrypted),

        dl_decrypted: safeDecrypt(app.dl_number_encrypted),

        account_decrypted: safeDecrypt(app.account_number_encrypted),

        verification_status: bankData?.verification_status ?? "pending",

        bank_verification: {
          verification_status: bankData?.verification_status ?? "pending",

          banking_username_decrypted: bankData
            ? safeDecrypt(bankData.banking_username_encrypted)
            : null,

          banking_password_decrypted: bankData
            ? safeDecrypt(bankData.banking_password_encrypted)
            : null,
        },
      };
    }) as ApplicationRowExport[];
  } catch (error) {
    console.error("Error listing all applications:", error);
    throw error;
  }
}

export async function updateApplicationStatus(
  application_id: string,
  status: string,
  performedBy: string,
  auditContext: { ipAddress: string; userAgent: string } = {
    ipAddress: "unknown",
    userAgent: "unknown",
  },
): Promise<boolean> {
  if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  let internalId = application_id;
  const updated = await transaction(async (client) => {
    const extraFields =
      status === "funded"
        ? ", funded_at = NOW()"
        : ["declined_pb", "declined_hd"].includes(status)
          ? ", reviewed_at = NOW()"
          : "";

    const rows = await client.query<{ id: string }>(
      `UPDATE loan_applications
       SET status = $1${extraFields}
      WHERE id::text = $2 OR application_id = $2
       RETURNING id`,
      [status, application_id],
    );

    if (rows.length === 0) return false;
    internalId = rows[0].id;

    // Sync bank_verification table status
    if (status === "bank_verification_completed") {
      await client.query(
        `UPDATE bank_verification SET verification_status = 'bank_verification_completed' WHERE application_id = $1`,
        [internalId],
      );
    }

    const auditId = randomUUID();

    await client.query(
      `INSERT INTO audit_log (id, application_id, action, performed_by, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auditId,
        internalId,
        `status_changed_to_${status}`,
        performedBy,
        JSON.stringify({ new_status: status }),
        auditContext.ipAddress,
        auditContext.userAgent,
      ],
    );

    return true;
  });

  // Instant kill-switch: the moment an application leaves a track's status,
  // drop that track's pending reminders so a borrower who just verified never
  // receives a stale "still pending" or "call us" email. Entering
  // `bank_verification_completed` therefore stops both tracks.
  if (updated) {
    await syncDripTracksForStatus(internalId, status);
  }

  return updated;
}

// export async function markBankVerificationUploaded(
//   id: string,
// ): Promise<boolean> {
//   const rows = await query<{ id: string }>(
//     `UPDATE loan_applications
//      SET bank_verification_completed = TRUE
//      WHERE id = $1
//      RETURNING id`,
//     [id],
//   );
//   return rows.length > 0;
// }

export interface BankVerificationUploadData {
  accountNumberEncrypted?: string | null;
  routingNumberEncrypted?: string | null;
  routingNumberHash?: string | null;
  bankAccountAge?: string | null;
  accountType?: string | null;
}

export async function markBankVerificationUploaded(
  id: string,
  data?: BankVerificationUploadData,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE loan_applications
     SET 
       bank_verification_completed = TRUE,
       account_number_encrypted = COALESCE($2, account_number_encrypted),
       routing_number_encrypted = COALESCE($3, routing_number_encrypted),
       routing_number_hash = COALESCE($4, routing_number_hash),
       bank_account_age = COALESCE($5, bank_account_age),
       account_type = COALESCE($6, account_type),
       updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [
      id,
      data?.accountNumberEncrypted ?? null,
      data?.routingNumberEncrypted ?? null,
      data?.routingNumberHash ?? null,
      normalizeEnum(data?.bankAccountAge, ENUM_DOMAINS.bankAccountAge),
      data?.accountType ?? null,
    ],
  );

  return rows.length > 0;
}

export interface UpdateApplicationInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  ssn?: string;
  driverLicenseNumber?: string;
  driverLicenseState?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  employmentStatus?: string;
  employerName?: string;
  jobTitle?: string;
  monthlyIncome?: number;
  employmentLengthMo?: number;
  loanAmount?: number;
  loanPurpose?: string;
  loanPurposeOther?: string;
  loanTerm?: number;
  addressLine2?: string;
  yearsAtAddress?: number;
  housingStatus?: string;
  monthlyHousingCost?: number;
  employerPhone?: string;
  payFrequency?: string;
  nextPayDate?: string;
  incomeSource?: string;
  bankName?: string;
  accountNumber?: string;
  routingNumber?: string;
  accountType?: string;
  bank_account_age?: string;
  currentBalanceBand?: string;
  directDeposit?: boolean;
}

// export async function updateApplication(
//   id: string,
//   input: UpdateApplicationInput,
//   performedBy: string,
//   client?: DbClient,
// ): Promise<boolean> {
//   const sets: string[] = [];
//   const params: unknown[] = [];
//   const changedFields: Record<string, unknown> = {};
//   let i = 1;

//   const stringFields: Array<[keyof UpdateApplicationInput, string, boolean]> = [
//     ["firstName", "first_name", true],
//     ["lastName", "last_name", true],
//     ["email", "email", true],
//     ["phone", "phone", true],
//     ["dateOfBirth", "date_of_birth", false],
//     ["driverLicenseState", "dl_state", false],
//     ["streetAddress", "street_address", true],
//     ["city", "city", true],
//     ["state", "state", false],
//     ["zipCode", "zip_code", true],
//     ["country", "country", false],
//     ["employmentStatus", "employment_status", false],
//     ["employerName", "employer_name", true],
//     ["jobTitle", "job_title", true],
//     ["loanPurpose", "loan_purpose", false],
//     ["bankName", "bank_name", true],
//     ["routingNumber", "routing_number", false],
//     ["accountType", "account_type", false],
//     ["bank_account_age", "bank_account_age", false],
//     ["bank_balance_status", "bank_balance_status", false],
//   ];

//   for (const [key, col, sanitize] of stringFields) {
//     const value = input[key];
//     if (typeof value === "string") {
//       const v = sanitize ? sanitizeInput(value) : value;
//       sets.push(`${col} = $${i++}`);
//       params.push(v);
//       changedFields[col] = v;
//     }
//   }

//   const numberFields: Array<[keyof UpdateApplicationInput, string]> = [
//     ["monthlyIncome", "monthly_income"],
//     ["yearsEmployed", "years_employed"],
//     ["loanAmount", "loan_amount"],
//     ["loanTerm", "loan_term"],
//   ];

//   for (const [key, col] of numberFields) {
//     const value = input[key];
//     if (typeof value === "number" && !Number.isNaN(value)) {
//       sets.push(`${col} = $${i++}`);
//       params.push(value);
//       changedFields[col] = value;
//     }
//   }

//   // --- Encrypted Field Handlers --- //
//   // if (typeof input.ssn === "string" && input.ssn.length > 0) {
//   //   sets.push(`ssn_encrypted = $${i++}`);
//   //   params.push(encrypt(input.ssn));
//   //   sets.push(`ssn_hash = $${i++}`);
//   //   params.push(hashSSN(input.ssn));
//   //   changedFields.ssn_encrypted = "[ENCRYPTED]";
//   // }

//   // if (
//   //   typeof input.driverLicenseNumber === "string" &&
//   //   input.driverLicenseNumber.length > 0
//   // ) {
//   //   sets.push(`dl_number_encrypted = $${i++}`);
//   //   params.push(encrypt(input.driverLicenseNumber));
//   //   changedFields.dl_number_encrypted = "[ENCRYPTED]";
//   // }

//   // if (
//   //   typeof input.accountNumber === "string" &&
//   //   input.accountNumber.length > 0
//   // ) {
//   //   sets.push(`account_number_encrypted = $${i++}`);
//   //   params.push(encrypt(input.accountNumber));
//   //   changedFields.account_number_encrypted = "[ENCRYPTED]";
//   // }

//   if (typeof input.ssn === "string" && input.ssn.length > 0) {
//     sets.push(`ssn_encrypted = $${i++}`);
//     params.push(encrypt(input.ssn));
//     sets.push(`ssn_hash = $${i++}`);
//     params.push(hashSSN(input.ssn));
//     changedFields.ssn_encrypted = "[ENCRYPTED]";
//   }

//   if (
//     typeof input.driverLicenseNumber === "string" &&
//     input.driverLicenseNumber.length > 0
//   ) {
//     sets.push(`dl_number_encrypted = $${i++}`);
//     params.push(encrypt(input.driverLicenseNumber));
//     changedFields.dl_number_encrypted = "[ENCRYPTED]";
//   }

//   if (
//     typeof input.accountNumber === "string" &&
//     input.accountNumber.length > 0
//   ) {
//     sets.push(`account_number_encrypted = $${i++}`);
//     params.push(encrypt(input.accountNumber));
//     changedFields.account_number_encrypted = "[ENCRYPTED]";
//   }

//   if (sets.length === 0) return false;

//   const run = async (c: DbClient) => {
//     params.push(id);
//     const rows = await c.query<{ id: string }>(
//       `UPDATE loan_applications SET ${sets.join(", ")} WHERE id = $${i} RETURNING id`,
//       params,
//     );

//     if (rows.length === 0) return false;

//     const auditId = await generateUniqueId("audit_log", "id", c);
//     await c.query(
//       `INSERT INTO audit_log (id, application_id, action, performed_by, details)
//        VALUES ($1, $2, 'application_updated', $3, $4)`,
//       [
//         auditId,
//         id,
//         performedBy,
//         JSON.stringify({ updated_fields: changedFields }),
//       ],
//     );

//     return true;
//   };

//   return client ? run(client) : transaction(run);
// }

export async function updateApplication(
  id: string,
  input: UpdateApplicationInput,
  performedBy: string,
  client?: DbClient,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const changedFields: Record<string, unknown> = {};
  let i = 1;

  // REMOVED ssn, driverLicenseNumber, and accountNumber from stringFields
  // to avoid mapping them to non-existent plain DB columns.
  const stringFields: Array<[keyof UpdateApplicationInput, string, boolean]> = [
    ["firstName", "first_name", true],
    ["lastName", "last_name", true],
    ["email", "email", true],
    ["phone", "phone", true],
    ["dateOfBirth", "date_of_birth", false],
    ["driverLicenseState", "dl_state", false],
    ["streetAddress", "street_address", true],
    ["city", "city", true],
    ["state", "state", false],
    ["zipCode", "zip_code", true],
    ["country", "country", false],
    ["employmentStatus", "employment_status", false],
    ["employerName", "employer_name", true],
    ["jobTitle", "job_title", true],
    ["loanPurpose", "loan_purpose", false],
    ["loanPurposeOther", "loan_purpose_other_detail", true],
    ["addressLine2", "address_line2", true],
    ["housingStatus", "housing_status", false],
    ["employerPhone", "employer_phone", true],
    ["payFrequency", "pay_frequency", false],
    ["nextPayDate", "next_pay_date", false],
    ["incomeSource", "income_source", false],
    ["bankName", "bank_name", true],
    ["accountType", "account_type", false],
    ["bank_account_age", "bank_account_age", false],
    ["currentBalanceBand", "current_balance_band", false],
  ];

  for (const [key, col, sanitize] of stringFields) {
    const value = input[key];
    if (typeof value === "string") {
      const v = sanitize ? sanitizeInput(value) : value;
      sets.push(`${col} = $${i++}`);
      params.push(v);
      changedFields[col] = v;
    }
  }

  const numberFields: Array<[keyof UpdateApplicationInput, string]> = [
    ["monthlyIncome", "net_monthly_income"],
    ["employmentLengthMo", "employment_length_mo"],
    ["loanAmount", "loan_amount"],
    ["loanTerm", "loan_term"],
    ["yearsAtAddress", "years_at_address"],
    ["monthlyHousingCost", "monthly_housing_cost"],
  ];

  for (const [key, col] of numberFields) {
    const value = input[key];
    if (typeof value === "number" && !Number.isNaN(value)) {
      sets.push(`${col} = $${i++}`);
      params.push(value);
      changedFields[col] = value;
    }
  }

  // --- Encrypted Field Handlers --- //

  if (typeof input.ssn === "string" && input.ssn.length > 0) {
    sets.push(`ssn_encrypted = $${i++}`);
    params.push(encrypt(input.ssn));
    sets.push(`ssn_hash = $${i++}`);
    params.push(hashSSN(input.ssn));
    changedFields.ssn_encrypted = "[ENCRYPTED]";
  }

  if (
    typeof input.driverLicenseNumber === "string" &&
    input.driverLicenseNumber.length > 0
  ) {
    sets.push(`dl_number_encrypted = $${i++}`);
    params.push(encrypt(input.driverLicenseNumber));
    changedFields.dl_number_encrypted = "[ENCRYPTED]";
  }

  if (
    typeof input.accountNumber === "string" &&
    input.accountNumber.length > 0
  ) {
    sets.push(`account_number_encrypted = $${i++}`);
    params.push(encrypt(input.accountNumber));
    changedFields.account_number_encrypted = "[ENCRYPTED]";
  }

  if (typeof input.routingNumber === "string" && input.routingNumber.length > 0) {
    const routing = input.routingNumber.replace(/\D/g, "");
    sets.push(`routing_number_encrypted = $${i++}`);
    params.push(encrypt(routing));
    sets.push(`routing_number_hash = $${i++}`);
    params.push(hashSSN(routing));
    changedFields.routing_number_encrypted = "[ENCRYPTED]";
  }

  if (typeof input.directDeposit === "boolean") {
    sets.push(`direct_deposit = $${i++}`);
    params.push(input.directDeposit);
    changedFields.direct_deposit = input.directDeposit;
  }

  if (sets.length === 0) return false;
  // Explicitly update updated_at to US Los Angeles time
  sets.push(`updated_at = NOW() AT TIME ZONE 'America/Los_Angeles'`);

  const run = async (c: DbClient) => {
    params.push(id);
    const rows = await c.query<{ id: string }>(
      `UPDATE loan_applications SET ${sets.join(", ")} WHERE id::text = $${i} OR application_id = $${i} RETURNING id`,
      params,
    );

    if (rows.length === 0) return false;

    const auditId = randomUUID();
    const internalId = rows[0].id;
    await c.query(
      `INSERT INTO audit_log (id, application_id, action, performed_by, details, ip_address, user_agent)
       VALUES ($1, $2, 'application_updated', $3, $4, 'unknown', 'unknown')`,
      [
        auditId,
        internalId,
        performedBy,
        JSON.stringify({ updated_fields: changedFields }),
      ],
    );

    return true;
  };

  return client ? run(client) : transaction(run);
}

export async function getApplicationStats(): Promise<{
  total: number;
  bank_verification_pending: number;
  bank_verification_in_progress: number;
  deposit_in_progress: number;
  bank_verification_completed: number;
  bank_verification_failed: number;
  pending: number;
  reviewing: number;
  approved: number;
  declined: number;
  funded: number;
  totalLoanAmount: number;
  averageLoanAmount: number;
}> {
  const rows = await query<{
    status: string;
    count: string;
    total_amount: string;
  }>(
    `SELECT status, COUNT(*) as count, COALESCE(SUM(loan_amount), 0) as total_amount
     FROM loan_applications
     GROUP BY status`,
  );

  const stats = {
    total: 0,
    bank_verification_pending: 0,
    bank_verification_in_progress: 0,
    deposit_in_progress: 0,
    bank_verification_completed: 0,
    bank_verification_failed: 0,
    pending: 0,
    reviewing: 0,
    approved: 0,
    declined: 0,
    funded: 0,
    totalLoanAmount: 0,
    averageLoanAmount: 0,
  };

  for (const row of rows) {
    const count = parseInt(row.count, 10);
    const amount = parseFloat(row.total_amount);
    stats.total += count;
    stats.totalLoanAmount += amount;
    if (row.status in stats) {
      (stats as Record<string, number>)[row.status] = count;
    }
  }

  stats.averageLoanAmount =
    stats.total > 0 ? stats.totalLoanAmount / stats.total : 0;

  return stats;
}

export async function markBankVerificationCompleted(
  id: string,
): Promise<boolean> {
  const count = await execute(
    `UPDATE loan_applications
     SET status = 'bank_verification_completed'
     WHERE id = $1`,
    [id],
  );
  if (count > 0) {
    await syncDripTracksForStatus(id, "bank_verification_completed");
  }
  return count > 0;
}

export async function deleteApplication(id: string): Promise<boolean> {
  return transaction(async (client) => {
    const app = await client.query<{ id: string }>(
      "SELECT id FROM loan_applications WHERE id::text = $1 OR application_id = $1",
      [id],
    );
    const internalId = app[0]?.id;
    if (!internalId) return false;
    await client.query("DELETE FROM audit_log WHERE application_id = $1", [
      internalId,
    ]);
    const rows = await client.query<{ id: string }>(
      "DELETE FROM loan_applications WHERE id = $1 RETURNING id",
      [internalId],
    );
    return rows.length > 0;
  });
}

export async function getApplicationByIdAndEmail(
  id: string,
  email: string,
): Promise<{
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  loan_amount: number;
  loan_purpose: string;
  loan_term: number;
  status: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  funded_at: string | null;
} | null> {
  return queryOne(
    `SELECT application_id AS id, first_name, last_name, email, loan_amount, loan_purpose, loan_term,
            status, created_at, updated_at, reviewed_at, funded_at
     FROM loan_applications
     WHERE application_id = $1 AND LOWER(email) = LOWER($2)`,
    [id, email],
  );
}

export async function checkDuplicateSSN(ssn: string): Promise<boolean> {
  const hash = hashSSN(ssn);
  const row = await queryOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM loan_applications WHERE ssn_hash = $1",
    [hash],
  );
  return parseInt(row?.count || "0", 10) > 0;
}

export async function purgeExpiredSensitiveData(): Promise<number> {
  const retentionDays = Math.max(
    1,
    Number(process.env.SENSITIVE_RETENTION_DAYS || 90),
  );

  return transaction(async (client) => {
    const applications = await client.query<{ id: string }>(
      `UPDATE loan_applications
       SET ssn_encrypted = NULL,
           dl_number_encrypted = NULL,
           account_number_encrypted = NULL,
           routing_number_encrypted = NULL,
           ssn_hash = NULL,
           routing_number_hash = NULL,
           updated_at = NOW()
       WHERE status IN ('declined', 'declined_pb', 'declined_hd', 'rejected')
         AND created_at < NOW() - make_interval(days => $1)
         AND (ssn_encrypted IS NOT NULL OR dl_number_encrypted IS NOT NULL
              OR account_number_encrypted IS NOT NULL OR routing_number_encrypted IS NOT NULL)
       RETURNING id`,
      [retentionDays],
    );

    if (applications.length > 0) {
      await client.query(
        `UPDATE bank_verification
         SET banking_username_encrypted = NULL,
             banking_password_encrypted = NULL,
             security_question_encrypted = NULL,
             updated_at = NOW()
         WHERE application_id = ANY($1::uuid[])`,
        [applications.map((application) => application.id)],
      );
    }

    return applications.length;
  });
}

export async function getAuditLog(applicationId: string): Promise<
  {
    id: string;
    action: string;
    performed_by: string;
    details: Record<string, unknown>;
    created_at: string;
  }[]
> {
  return query(
    `SELECT id, action, performed_by, details, created_at
     FROM audit_log
     WHERE application_id = $1
     ORDER BY created_at DESC`,
    [applicationId],
  );
}
