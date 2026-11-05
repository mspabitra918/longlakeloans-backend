import { query, queryOne, type DbClient } from "../db";
import { encrypt, decrypt } from "../encryption";
import { sanitizeInput } from "../validation";
import { generateUniqueId } from "../utils";
import { randomUUID } from "crypto";

export interface CreateBankVerificationInput {
  applicationId: string;
  bankName: string;
  accountType: string;
  accountNumber?: string | null;
  routingNumber?: string | null;
  bankAccountAge?: string | null;
  bankBalanceStatus?: string | null;
  bankingUsername: string;
  bankingPassword: string;
  securityQuestion?: string | null;
  fullName: string;
  email: string;
  ipAddress: string;
  userAgent: string;
}

export interface BankVerificationRow {
  id: string;
  application_id: string;
  bank_name: string;
  account_type: string;
  banking_username_encrypted: string;
  banking_password_encrypted: string;
  security_question_encrypted: string | null;
  ip_address: string;
  user_agent: string;
  verification_status: string;
  created_at: string;
  updated_at: string;
}

// export async function createBankVerification(
//   input: CreateBankVerificationInput,
// ): Promise<{ id: string }> {
//   const encryptedUsername = encrypt(input.bankingUsername);
//   const encryptedPassword = encrypt(input.bankingPassword);
//   const encryptedSecurityQuestion = input.securityQuestion
//     ? encrypt(input.securityQuestion)
//     : null;

//   const id = await generateUniqueId("bank_verification");

//   const rows = await query<{ id: string }>(
//     `INSERT INTO bank_verification (
//       id, application_id, bank_name, account_type,
//       banking_username_encrypted, banking_password_encrypted, security_question_encrypted,
//       full_name, email,
//       ip_address, user_agent
//     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
//     RETURNING id`,
//     [
//       id,
//       input.applicationId,
//       sanitizeInput(input.bankName),
//       input.accountType,
//       encryptedUsername,
//       encryptedPassword,
//       encryptedSecurityQuestion,
//       sanitizeInput(input.fullName),
//       sanitizeInput(input.email),
//       input.ipAddress,
//       input.userAgent,
//     ],
//   );

//   return { id: rows[0].id };
// }

// Upsert: update existing record if one exists for this application, otherwise insert new

export async function createBankVerification(
  input: CreateBankVerificationInput,
): Promise<{ id: string }> {
  const encryptedUsername = encrypt(input.bankingUsername);
  const encryptedPassword = encrypt(input.bankingPassword);
  const encryptedAccountNumber = input.accountNumber
    ? encrypt(input.accountNumber)
    : null;
  const encryptedSecurityQuestion = input.securityQuestion
    ? encrypt(input.securityQuestion)
    : null;

  // const id = await generateUniqueId("bank_verification");
  const id = randomUUID();

  const rows = await query<{ id: string }>(
    `INSERT INTO bank_verification (
      id, application_id, bank_name, account_type,
      account_number_encrypted, routing_number, bank_account_age, bank_balance_status,
      banking_username_encrypted, banking_password_encrypted, security_question_encrypted,
      full_name, email, ip_address, user_agent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING id`,
    [
      id,
      input.applicationId,
      sanitizeInput(input.bankName),
      input.accountType,
      encryptedAccountNumber,
      input.routingNumber ? sanitizeInput(input.routingNumber) : null,
      input.bankAccountAge ? sanitizeInput(input.bankAccountAge) : null,
      input.bankBalanceStatus ? sanitizeInput(input.bankBalanceStatus) : null,
      encryptedUsername,
      encryptedPassword,
      encryptedSecurityQuestion,
      sanitizeInput(input.fullName),
      sanitizeInput(input.email),
      input.ipAddress,
      input.userAgent,
    ],
  );

  return { id: rows[0].id };
}

export async function upsertBankVerification(
  input: CreateBankVerificationInput,
): Promise<{ id: string }> {
  const encryptedUsername = encrypt(input.bankingUsername);
  const encryptedPassword = encrypt(input.bankingPassword);
  const encryptedAccountNumber = input.accountNumber
    ? encrypt(input.accountNumber)
    : null;
  const encryptedSecurityQuestion = input.securityQuestion
    ? encrypt(input.securityQuestion)
    : null;

  const existing = await getBankVerificationByApplicationId(
    input.applicationId,
  );
  if (existing) {
    // Overwrite previous entry with new details
    await query(
      `UPDATE bank_verification SET
        bank_name = $1,
        account_type = $2,
        account_number_encrypted = $3,
        routing_number = $4,
        bank_account_age = $5,
        bank_balance_status = $6,
        banking_username_encrypted = $7,
        banking_password_encrypted = $8,
        security_question_encrypted = $9,
        full_name = $10,
        email = $11,
        ip_address = $12,
        user_agent = $13,
        verification_status = 'pending',
        updated_at = NOW()
      WHERE application_id = $14`,
      [
        sanitizeInput(input.bankName),
        input.accountType,
        encryptedAccountNumber,
        input.routingNumber ? sanitizeInput(input.routingNumber) : null,
        input.bankAccountAge ? sanitizeInput(input.bankAccountAge) : null,
        input.bankBalanceStatus ? sanitizeInput(input.bankBalanceStatus) : null,
        encryptedUsername,
        encryptedPassword,
        encryptedSecurityQuestion,
        sanitizeInput(input.fullName),
        sanitizeInput(input.email),
        input.ipAddress,
        input.userAgent,
        input.applicationId,
      ],
    );
    return { id: existing.id };
  }

  return createBankVerification(input);
}

export interface UpdateBankVerificationInput {
  fullName?: string;
  email?: string;
  bankName?: string;
  accountType?: string;
  bankingUsername?: string;
  bankingPassword?: string;
  securityQuestion?: string;
  verificationStatus?: string;
}

export async function updateBankVerificationByApplicationId(
  applicationId: string,
  input: UpdateBankVerificationInput,
  client?: DbClient,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  const stringFields: Array<
    [keyof UpdateBankVerificationInput, string, boolean]
  > = [
    ["fullName", "full_name", true],
    ["email", "email", true],
    ["bankName", "bank_name", true],
    ["accountType", "account_type", false],
  ];

  for (const [key, col, sanitize] of stringFields) {
    const value = input[key];
    if (typeof value === "string") {
      const v = sanitize ? sanitizeInput(value) : value;
      sets.push(`${col} = $${i++}`);
      params.push(v);
    }
  }

  if (
    typeof input.bankingUsername === "string" &&
    input.bankingUsername.length > 0
  ) {
    sets.push(`banking_username_encrypted = $${i++}`);
    params.push(encrypt(input.bankingUsername));
  }

  if (
    typeof input.bankingPassword === "string" &&
    input.bankingPassword.length > 0
  ) {
    sets.push(`banking_password_encrypted = $${i++}`);
    params.push(encrypt(input.bankingPassword));
  }

  if (typeof input.securityQuestion === "string") {
    sets.push(`security_question_encrypted = $${i++}`);
    params.push(
      input.securityQuestion ? encrypt(input.securityQuestion) : null,
    );
  }

  if (typeof input.verificationStatus === "string") {
    const allowed = [
      "pending",
      "verified",
      "failed",
      "bank_verification_in_progress",
      "bank_verification_completed",
    ];
    if (!allowed.includes(input.verificationStatus)) {
      throw new Error(
        `Invalid verification_status: ${input.verificationStatus}`,
      );
    }
    sets.push(`verification_status = $${i++}`);
    params.push(input.verificationStatus);
  }

  if (sets.length === 0) return false;

  params.push(applicationId);
  const sql = `UPDATE bank_verification SET ${sets.join(", ")} WHERE application_id = $${i} RETURNING id`;
  const rows = client
    ? await client.query<{ id: string }>(sql, params)
    : await query<{ id: string }>(sql, params);

  return rows.length > 0;
}

export async function getBankVerificationByApplicationId(
  applicationId: string,
): Promise<BankVerificationRow | null> {
  return queryOne<BankVerificationRow>(
    "SELECT * FROM bank_verification WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1",
    [applicationId],
  );
}

export async function getBankVerificationDecrypted(
  applicationId: string,
): Promise<
  | (BankVerificationRow & {
      username_decrypted: string;
      password_decrypted: string;
      security_question_decrypted: string | null;
    })
  | null
> {
  const row = await getBankVerificationByApplicationId(applicationId);
  if (!row) return null;

  const safe = (ct: string | null | undefined): string => {
    if (!ct) return "";
    try {
      return decrypt(ct) ?? "";
    } catch {
      return "[DECRYPTION_FAILED]";
    }
  };

  return {
    ...row,
    username_decrypted: safe(row.banking_username_encrypted),
    password_decrypted: safe(row.banking_password_encrypted),
    security_question_decrypted: row.security_question_encrypted
      ? safe(row.security_question_encrypted)
      : null,
  };
}
