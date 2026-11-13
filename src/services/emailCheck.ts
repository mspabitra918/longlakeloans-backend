import { promises as dns } from "dns";

// Server-side email checks for the apply API, so they hold even when the
// frontend is bypassed (Postman, curl, scripts).
//
// The typo logic below is a copy of
// longlakeloans-frontend/components/apply/emailSuggestion.ts — keep the two
// in sync when adding domains.

const KNOWN_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "gmx.com",
  "mail.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "charter.net",
  "cox.net",
  "earthlink.net",
  "optonline.net",
  "frontier.com",
  "windstream.net",
];

// email.com is deliberately left out: it's real, but far more often a typo
// for gmail.com, so we want it to trigger a suggestion.
const KNOWN = new Set(KNOWN_DOMAINS);

// Mistyped TLDs that are never real: fixed for any domain, not just known ones
const TLD_FIXES: Record<string, string> = {
  con: "com",
  cmo: "com",
  cpm: "com",
  ocm: "com",
  vom: "com",
  xom: "com",
  comm: "com",
  coom: "com",
  copm: "com",
  nte: "net",
  ner: "net",
  nett: "net",
  ent: "net",
  ogr: "org",
  orgg: "org",
};

// Edit distance that counts a swap of two adjacent letters as one edit
// (so "gmial" -> "gmail" is 1, not 2)
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function closestKnown(domain: string): string | null {
  // "gmail" with no TLD: compare against the name part of each known domain
  const hasDot = domain.includes(".");
  const candidates: [string, number][] = [];
  for (const known of KNOWN_DOMAINS) {
    const target = hasDot ? known : known.split(".")[0];
    // Allow 2 edits only when both sides are long, so short real domains
    // (acme.com vs me.com) aren't "corrected"
    const maxDist = Math.min(domain.length, target.length) >= 8 ? 2 : 1;
    const dist = editDistance(domain, target);
    // With no TLD, an exact name match ("gmail") still needs ".com" added
    if (dist <= maxDist && (dist > 0 || !hasDot)) candidates.push([known, dist]);
  }
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0]?.[0] ?? null;
}

/** Returns a corrected email if the domain looks like a typo, else null. */
export function suggestEmail(rawEmail: string): string | null {
  const email = rawEmail.trim();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (KNOWN.has(domain)) return null;

  const match = closestKnown(domain);
  if (match) return `${local}@${match}`;

  // Unknown domain (e.g. a work address): only fix an obviously broken TLD
  const dot = domain.lastIndexOf(".");
  if (dot > 0) {
    const tld = domain.slice(dot + 1);
    const fixed = TLD_FIXES[tld];
    if (fixed) return `${local}@${domain.slice(0, dot)}.${fixed}`;
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DNS_TIMEOUT_MS = 3000;

/**
 * Whether the domain can receive mail. Fails open (returns true) on timeouts
 * or DNS outages so a resolver hiccup never blocks a real applicant; only a
 * definite "this domain doesn't exist / has no mail server" returns false.
 */
async function domainAcceptsMail(domain: string): Promise<boolean> {
  const lookup = async () => {
    try {
      const mx = await dns.resolveMx(domain);
      if (mx.length > 0) return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOTFOUND" && code !== "ENODATA") return true;
    }
    // No MX record: mail falls back to the domain's A record (RFC 5321)
    try {
      return (await dns.resolve4(domain)).length > 0;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return code !== "ENOTFOUND" && code !== "ENODATA";
    }
  };
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(true), DNS_TIMEOUT_MS),
  );
  return Promise.race([lookup(), timeout]);
}

export type EmailCheckError = { error: string; suggestion?: string };

/** Validates an applicant's email: format, domain typos, and DNS. */
export async function checkApplicantEmail(
  rawEmail: string,
): Promise<EmailCheckError | null> {
  const email = rawEmail.trim();
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address" };

  const suggestion = suggestEmail(email);
  if (suggestion)
    return {
      error: `Did you mean ${suggestion}? Check your email address.`,
      suggestion,
    };

  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (!(await domainAcceptsMail(domain)))
    return { error: "This email domain can't receive mail. Check for typos." };

  return null;
}
