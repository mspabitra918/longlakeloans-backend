import { z } from "zod";

/**
 * The apply wizard's payload, section for section — mirrors ApplicationFormData
 * in longlakeloans-frontend/components/apply/types.ts. Types are deliberately
 * loose (the client sends NaN for unanswered numbers, which JSON turns into
 * null): range and enum checks happen in applicationService before the write,
 * where they can name the offending column.
 */
const text = z.string().optional().default("");
const numeric = z.union([z.number(), z.string()]).nullable().optional();

export const applicationFormSchema = z.object({
  loan: z.object({
    amount: numeric,
    loanTerm: numeric,
    purpose: text,
    otherPurpose: text,
  }),
  personal: z.object({
    firstName: text,
    lastName: text,
    email: text,
    phone: text,
    dobMonth: text,
    dobDay: text,
    dobYear: text,
    ssn: text,
    dlNumber: text,
    dlState: text,
    streetAddress: text,
    addressLine2: text,
    city: text,
    state: text,
    zip: text,
    yearsAtAddress: numeric,
    housingStatus: text,
    monthlyHousingCost: numeric,
  }),
  employment: z.object({
    employmentStatus: text,
    employerName: text,
    jobTitle: text,
    employmentLengthMo: numeric,
    employerPhone: text,
    payFrequency: text,
    nextPayDate: text,
    netMonthlyIncome: numeric,
    incomeSource: text,
  }),
  banking: z.object({
    bankName: text,
    accountType: text,
    routingNumber: text,
    accountNumber: text,
    confirmAccountNumber: text,
    accountAge: text,
    currentBalanceBand: text,
    directDeposit: z.boolean().nullable().optional(),
  }),
  consent: z.object({
    esign: z.boolean().optional().default(false),
    privacy: z.boolean().optional().default(false),
    creditPull: z.boolean().optional().default(false),
    tcpa: z.boolean().optional().default(false),
  }),
});

export type ApplicationForm = z.infer<typeof applicationFormSchema>;

/** True when a payload is the wizard's sectioned shape rather than a flat record. */
export function isSectionedApplicationForm(data: Record<string, unknown>): boolean {
  return (
    typeof data.loan === "object" &&
    data.loan !== null &&
    typeof data.personal === "object" &&
    data.personal !== null
  );
}

/**
 * Flattens the wizard's sections into the record applicationService persists.
 * The flat keys are the canonical names the column mapping reads.
 */
export function flattenApplicationForm(
  form: ApplicationForm,
): Record<string, unknown> {
  const { loan, personal, employment, banking, consent } = form;

  const dob =
    personal.dobYear && personal.dobMonth && personal.dobDay
      ? `${personal.dobYear}-${personal.dobMonth.padStart(2, "0")}-${personal.dobDay.padStart(2, "0")}`
      : "";

  return {
    loanAmount: loan.amount,
    loanTerm: loan.loanTerm,
    loanPurpose: loan.purpose,
    loanPurposeOther: loan.otherPurpose,

    firstName: personal.firstName,
    lastName: personal.lastName,
    email: personal.email,
    phone: personal.phone,
    dob,
    ssn: personal.ssn,
    dlNumber: personal.dlNumber,
    dlState: personal.dlState,
    streetAddress: personal.streetAddress,
    addressLine2: personal.addressLine2,
    city: personal.city,
    state: personal.state,
    zipCode: personal.zip,
    yearsAtAddress: personal.yearsAtAddress,
    housingStatus: personal.housingStatus,
    monthlyHousingCost: personal.monthlyHousingCost,

    employmentStatus: employment.employmentStatus,
    employerName: employment.employerName,
    jobTitle: employment.jobTitle,
    employmentLengthMo: employment.employmentLengthMo,
    employerPhone: employment.employerPhone,
    payFrequency: employment.payFrequency,
    nextPayDate: employment.nextPayDate,
    netMonthlyIncome: employment.netMonthlyIncome,
    incomeSource: employment.incomeSource,

    bankName: banking.bankName,
    accountType: banking.accountType,
    routingNumber: banking.routingNumber,
    accountNumber: banking.accountNumber,
    confirmAccountNumber: banking.confirmAccountNumber,
    accountAge: banking.accountAge,
    currentBalanceBand: banking.currentBalanceBand,
    directDeposit: banking.directDeposit,

    esignConsent: consent.esign,
    privacyConsent: consent.privacy,
    creditPullConsent: consent.creditPull,
    tcpaConsent: consent.tcpa,
  };
}
