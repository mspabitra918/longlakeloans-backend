/**
 * Shared HTML email layout + primitives for every LongLake Loans email
 * (transactional and drip). Mirrors the frontend design system.
 */

/* -------------------------------------------------------------------------- */
/*  Design system — mirrors longlakeloans-frontend/app/globals.css             */
/* -------------------------------------------------------------------------- */

export const COLOR = {
  ink: "#0a0a0a",
  body: "#404040",
  muted: "#737373",
  line: "#e5e5e5",
  paper: "#ffffff",
  wash: "#f7f7f5",
  accent: "#166534",
  /* Green & White brand palette (frontend globals.css) */
  brand: "#0b5a32",
  brandDark: "#07401f",
  brandLight: "#22c55e",
  mint: "#e7f6ec",
  mintStrong: "#cdeed8",
  warning: "#b45309",
  danger: "#b91c1c",
} as const;

export const FONT =
  "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Same contact details as longlakeloans-frontend/components/CompanyContact.tsx */
export const CONTACT = {
  address: "626 Wilshire Blvd - 5th Floor, Ste 575, Los Angeles, CA 90017",
  email: "support@longlakeloans.com",
  website: "https://www.longlakeloans.com",
  local: { display: "(747) 202-5223", href: "tel:+17472025223" },
} as const;

/** Paragraph / link / strong inline styles shared by every template body. */
export const P = `style="margin: 0 0 16px; color: ${COLOR.body}; font-family: ${FONT}; font-size: 15px; line-height: 1.65;"`;
export const A = `style="color: ${COLOR.brand}; font-weight: 500; text-decoration: underline; text-underline-offset: 3px;"`;
export const STRONG = `style="color: ${COLOR.ink}; font-weight: 600;"`;

export const localPhoneLink = `<a href="${CONTACT.local.href}" ${A}>${CONTACT.local.display}</a>`;
export const supportEmailLink = `<a href="mailto:${CONTACT.email}" ${A}>${CONTACT.email}</a>`;

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/** Rounded, solid-green button — matches `buttonPrimary` in the frontend. */
export function renderButton(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0;">
      <tr>
        <td bgcolor="${COLOR.brand}" style="background: ${COLOR.brand}; border-radius: 8px;">
          <a href="${href}" style="display: inline-block; padding: 14px 28px; border-radius: 8px; color: ${COLOR.paper}; font-family: ${FONT}; font-size: 14px; font-weight: 600; text-decoration: none; letter-spacing: 0.01em;">
            ${label} &rarr;
          </a>
        </td>
      </tr>
    </table>
  `;
}

/** Label / value summary block on the mint surface with a hairline border. */
export function renderDetails(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value], i) => `
        <tr>
          <td style="padding: 12px 20px; ${i > 0 ? `border-top: 1px solid ${COLOR.mintStrong};` : ""} color: ${COLOR.muted}; font-family: ${FONT}; font-size: 13px;">${label}</td>
          <td align="right" style="padding: 12px 20px; ${i > 0 ? `border-top: 1px solid ${COLOR.mintStrong};` : ""} color: ${COLOR.ink}; font-family: ${FONT}; font-size: 14px; font-weight: 600;">${value}</td>
        </tr>`,
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0; background: ${COLOR.mint}; border: 1px solid ${COLOR.mintStrong}; border-radius: 8px; border-collapse: separate; border-spacing: 0;">
      ${body}
    </table>
  `;
}

/** Bordered note panel used for supporting information (e.g. security notes). */
export function renderPanel(title: string, innerHtml: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0; background: ${COLOR.mint}; border: 1px solid ${COLOR.mintStrong}; border-radius: 8px;">
      <tr>
        <td style="padding: 20px 24px;">
          <p style="margin: 0 0 12px; color: ${COLOR.brand}; font-family: ${FONT}; font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase;">${title}</p>
          ${innerHtml}
        </td>
      </tr>
    </table>
  `;
}

export function renderSignOff(lines: string): string {
  return `<p style="margin: 28px 0 0; color: ${COLOR.body}; font-family: ${FONT}; font-size: 15px; line-height: 1.65;">${lines}</p>`;
}

export interface LayoutOptions {
  previewText?: string;
  /** Small uppercase label above the title, like the site's <Eyebrow>. */
  eyebrow?: string;
  /** Colour of the square marker beside the eyebrow. */
  tone?: string;
  title?: string;
  bodyHtml: string;
}

/**
 * Shared shell for every transactional email: logo header, white card on the
 * green header band, and a footer that mirrors the site footer.
 * Table-based with inline styles so it renders in Gmail, Outlook and Apple Mail.
 */
export function renderEmailLayout({
  previewText,
  eyebrow,
  tone = COLOR.brand,
  title,
  bodyHtml,
}: LayoutOptions): string {
  const eyebrowHtml = eyebrow
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 16px;">
        <tr>
          <td width="8" valign="middle" style="width: 8px; font-size: 0; line-height: 0;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${tone};">&nbsp;</span></td>
          <td style="padding-left: 10px; color: ${COLOR.brand}; font-family: ${FONT}; font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase;">${eyebrow}</td>
        </tr>
      </table>`
    : "";

  const titleHtml = title
    ? `<h1 style="margin: 0 0 24px; color: ${COLOR.ink}; font-family: ${FONT}; font-size: 26px; font-weight: 600; line-height: 1.25; letter-spacing: -0.02em;">${title}</h1>`
    : "";

  const footerLink = `color: ${COLOR.brand}; text-decoration: none;`;

  return `
<div style="margin: 0; padding: 0; background: ${COLOR.wash};">
  ${
    previewText
      ? `<div style="display: none; font-size: 1px; color: ${COLOR.wash}; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden;">${previewText}</div>`
      : ""
  }
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.wash}" style="background: ${COLOR.wash};">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">

          <!-- Logo header — matches the site's dark-green navbar -->
          <tr>
            <td bgcolor="${COLOR.brandDark}" style="background: ${COLOR.brandDark}; border-radius: 12px 12px 0 0; padding: 18px 36px;">
              <a href="${CONTACT.website}" style="text-decoration: none;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="28" height="28" align="center" valign="middle" bgcolor="${COLOR.paper}" style="width: 28px; height: 28px; background: ${COLOR.paper}; border-radius: 6px; color: ${COLOR.brand}; font-family: ${FONT}; font-size: 14px; font-weight: 700; line-height: 28px;">L</td>
                    <td style="padding-left: 10px; color: ${COLOR.paper}; font-family: ${FONT}; font-size: 17px; font-weight: 600; letter-spacing: -0.01em;">LongLake Loans</td>
                  </tr>
                </table>
              </a>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td bgcolor="${COLOR.paper}" style="background: ${COLOR.paper}; border: 1px solid ${COLOR.line}; border-top: 3px solid ${COLOR.brandLight}; border-radius: 0 0 12px 12px; padding: 40px 36px;">
              ${eyebrowHtml}
              ${titleHtml}
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 32px 4px 0;">
              <p style="margin: 0 0 12px; color: ${COLOR.brand}; font-family: ${FONT}; font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase;">Support</p>
              <p style="margin: 0 0 6px; color: ${COLOR.body}; font-family: ${FONT}; font-size: 13px; line-height: 1.6;">
                <a href="mailto:${CONTACT.email}" style="${footerLink}">${CONTACT.email}</a>
              </p>
              <p style="margin: 0 0 6px; color: ${COLOR.body}; font-family: ${FONT}; font-size: 13px; line-height: 1.6;">
                Local <a href="${CONTACT.local.href}" style="${footerLink}">${CONTACT.local.display}</a>
              </p>
              <p style="margin: 0 0 6px; color: ${COLOR.muted}; font-family: ${FONT}; font-size: 13px; line-height: 1.6;">${CONTACT.address}</p>
              <p style="margin: 0; color: ${COLOR.body}; font-family: ${FONT}; font-size: 13px; line-height: 1.6;">
                <a href="${CONTACT.website}" style="${footerLink}">www.longlakeloans.com</a>
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 24px;">
                <tr>
                  <td style="border-top: 1px solid ${COLOR.line}; padding-top: 20px; color: ${COLOR.muted}; font-family: ${FONT}; font-size: 12px; line-height: 1.6;">
                    All loan approvals, rates, and funding times depend on individual eligibility verification, bank authorization, and underwriting guidelines.
                    <br /><br />
                    This is an automated email from LongLake Loans. Please do not reply to this email.
                    <br />
                    &copy; ${new Date().getFullYear()} LongLake Loans. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</div>
  `;
}
