import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";

function deriveKey(salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    ENCRYPTION_KEY,
    salt,
    ITERATIONS,
    KEY_LENGTH,
    "sha512",
  );
}

export function encrypt(plaintext: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string | null | undefined): string | null {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }

  // Handle NULL / empty database values
  if (!ciphertext) {
    return null;
  }

  try {
    const data = Buffer.from(ciphertext, "base64");

    // Validate minimum encrypted payload size
    const minimumLength = SALT_LENGTH + IV_LENGTH + TAG_LENGTH;

    if (data.length < minimumLength) {
      console.error("Invalid encrypted data: payload is too short");
      return null;
    }

    const salt = data.subarray(0, SALT_LENGTH);

    const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);

    const tag = data.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
    );

    const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    const key = deriveKey(salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Decryption failed:", error);
    return null;
  }
}

// export function validateEncryptionKey(): void {
//   if (!ENCRYPTION_KEY) {
//     throw new Error("ENCRYPTION_KEY environment variable is not set");
//   }
// }

// export function safeDecrypt(ciphertext: string | null | undefined): string {
//   if (!ciphertext) return "";
//   try {
//     return decrypt(ciphertext);
//   } catch {
//     return "[DECRYPTION_FAILED]";
//   }
// }

export function hashSSN(ssn: string): string {
  return crypto
    .createHash("sha256")
    .update(ssn + ENCRYPTION_KEY)
    .digest("hex");
}
