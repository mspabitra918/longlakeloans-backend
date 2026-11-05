/**
 * OpenAPI spec for the LongLake Loans API, served by Swagger UI at /api/docs
 * (raw JSON at /api/docs.json). Request bodies are generated from the same zod
 * schemas the routes validate with, so they can't drift from the code.
 *
 * When you add or change a route, add or update its entry in `paths` below.
 */
import { z } from "zod";
import {
  applicationSchema,
  bankVerificationSchema,
  contactSchema,
  adminLoginSchema,
} from "./validation";
import { submitSchema, stepSubmissionSchema } from "./routes/apply";
import { publicTokenSchema } from "./routes/plaid";

type Json = Record<string, unknown>;

function schema(s: z.ZodType): Json {
  return z.toJSONSchema(s, {
    io: "input",
    unrepresentable: "any",
    target: "openapi-3.0",
  }) as Json;
}

const body = (ref: string): Json => ({
  required: true,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${ref}` } },
  },
});

const ok = (description = "Success"): Json => ({
  description,
  content: { "application/json": { schema: { type: "object" } } },
});

const std = {
  "200": ok(),
  "400": { description: "Validation error" },
  "500": { description: "Internal error" },
};

const authed = (roles?: string[]) => ({
  security: [{ bearerAuth: [] }],
  responses: {
    ...std,
    "401": { description: "Missing / invalid / expired token" },
    "403": { description: `Requires role: ${(roles ?? ["any"]).join(", ")}` },
  },
});

const rolesNote = (roles?: string[]) =>
  roles ? `**Roles:** ${roles.join(", ")}` : "**Roles:** any signed-in user";

const pathParam = (name: string, description?: string): Json => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
  description,
});

const query = (
  name: string,
  description?: string,
  extra: Json = {},
  required = false,
): Json => ({
  name,
  in: "query",
  required,
  description,
  schema: { type: "string", ...extra },
});

const pagination = [
  query("page", "Page number", { type: "integer", default: 1 }),
  query("limit", "Page size (max 100)", { type: "integer", default: 20 }),
];

const appId = pathParam("application_id", "5-digit application ID");

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "LongLake Loans API",
    version: "1.0.0",
    description:
      "Public endpoints power the applicant site; `/api/admin/*` endpoints power the admin portal.\n\n" +
      "To call admin endpoints: run **POST /api/admin/auth**, copy the `token` from the response, " +
      "click **Authorize** and paste it.",
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "Health" },
    { name: "Applications", description: "Applicant loan application flow" },
    { name: "Application status" },
    { name: "Bank verification" },
    { name: "Plaid" },
    { name: "Contact" },
    { name: "Lookups" },
    { name: "Admin auth" },
    { name: "Admin applications" },
    { name: "Admin dashboard" },
    { name: "Admin users" },
    { name: "Admin messages" },
    { name: "SEO" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      SubmitApplication: schema(submitSchema),
      StepSubmission: schema(stepSubmissionSchema),
      Application: schema(applicationSchema),
      BankVerification: schema(bankVerificationSchema),
      Contact: schema(contactSchema),
      AdminLogin: schema(adminLoginSchema),
      AdminRegister: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
          name: { type: "string" },
          role: { type: "string", enum: ["admin", "reviewer", "viewer"] },
          action: { type: "string" },
          setupKey: { type: "string" },
        },
      },
      PlaidPublicToken: schema(publicTokenSchema),
      AdminApplicationUpdate: {
        type: "object",
        description:
          "Partial update. Any application column may be sent; masked values (`[ENCRYPTED]…`) are ignored.",
        properties: {
          status: { type: "string" },
          ssn_decrypted: { type: "string" },
          dl_decrypted: { type: "string" },
          account_decrypted: { type: "string" },
          bankVerification: { type: "object" },
        },
        additionalProperties: true,
      },
    },
  },
  paths: {
    "/api/health": {
      get: { tags: ["Health"], summary: "Health check", responses: { "200": ok() } },
    },

    // ---------------------------------------------------------- applicant --
    "/api/apply/submit": {
      post: {
        tags: ["Applications"],
        summary: "Submit a completed application (single transaction)",
        description: "Also mounted at `/api/applications/submit`.",
        requestBody: body("SubmitApplication"),
        responses: { ...std, "429": { description: "Rate limited" } },
      },
    },
    "/api/apply/steps": {
      post: {
        tags: ["Applications"],
        summary: "Save one wizard step (deprecated — use /submit)",
        deprecated: true,
        description: "Also mounted at `/api/applications/steps`.",
        requestBody: body("StepSubmission"),
        responses: std,
      },
    },
    "/api/apply": {
      post: {
        tags: ["Applications"],
        summary: "Submit a full application (legacy single-form)",
        description: "Also mounted at `/api/applications`.",
        requestBody: body("Application"),
        responses: std,
      },
    },
    "/api/application-status": {
      get: {
        tags: ["Application status"],
        summary: "Look up an application's status",
        parameters: [
          query("id", "Application ID", {}, true),
          query("email", "Applicant email", { format: "email" }, true),
        ],
        responses: { ...std, "404": { description: "Not found" } },
      },
    },
    "/api/bank-verification/lookup": {
      get: {
        tags: ["Bank verification"],
        summary: "Fetch an application's existing bank details (masked)",
        parameters: [query("applicationId", "Application ID", {}, true)],
        responses: { ...std, "404": { description: "Not found" } },
      },
    },
    "/api/bank-verification": {
      post: {
        tags: ["Bank verification"],
        summary: "Submit manual bank verification",
        requestBody: body("BankVerification"),
        responses: std,
      },
    },
    "/api/bank-verification/reconnect-bank-verification": {
      post: {
        tags: ["Bank verification"],
        summary: "Re-submit bank verification for an existing application",
        requestBody: body("BankVerification"),
        responses: std,
      },
    },
    "/api/plaid/create-link-token": {
      post: {
        tags: ["Plaid"],
        summary: "Create a Plaid Link token",
        responses: std,
      },
    },
    "/api/plaid/exchange-public-token": {
      post: {
        tags: ["Plaid"],
        summary: "Exchange a Plaid public token for an access token",
        requestBody: body("PlaidPublicToken"),
        responses: std,
      },
    },
    "/api/contact": {
      post: {
        tags: ["Contact"],
        summary: "Send a contact-form message",
        requestBody: body("Contact"),
        responses: { ...std, "429": { description: "Rate limited" } },
      },
    },
    "/api/geo-check": {
      get: {
        tags: ["Lookups"],
        summary: "Check the caller's location from their IP",
        responses: std,
      },
    },
    "/api/routing-lookup": {
      get: {
        tags: ["Lookups"],
        summary: "Look up a bank by routing number",
        parameters: [
          query("routing", "9-digit routing number", {}, true),
          query("type", "Lookup type", { default: "routing" }),
        ],
        responses: std,
      },
    },

    // -------------------------------------------------------------- admin --
    "/api/admin/auth": {
      post: {
        tags: ["Admin auth"],
        summary: "Log in (returns a JWT)",
        description:
          'Send `action: "setup"` with `setupKey` = `ADMIN_SETUP_KEY` to bootstrap the first admin.',
        requestBody: body("AdminLogin"),
        responses: {
          ...std,
          "401": { description: "Invalid credentials" },
          "429": { description: "Too many login attempts" },
        },
      },
      get: {
        tags: ["Admin auth"],
        summary: "Get the current user from the token",
        security: [{ bearerAuth: [] }],
        responses: { ...std, "401": { description: "Invalid token" } },
      },
    },
    "/api/admin/auth/register": {
      post: {
        tags: ["Admin auth"],
        summary: "Register an admin user",
        requestBody: body("AdminRegister"),
        responses: std,
      },
    },
    "/api/admin/auth/delete": {
      delete: {
        tags: ["Admin auth"],
        summary: "Deactivate the signed-in user's own account",
        description: rolesNote(),
        ...authed(),
      },
    },
    "/api/admin/applications": {
      get: {
        tags: ["Admin applications"],
        summary: "List applications",
        description: rolesNote(),
        parameters: [
          query("status"),
          query("country"),
          query("search", "Name / email / ID"),
          query("date", "Single day (YYYY-MM-DD)"),
          query("dateFrom", "YYYY-MM-DD"),
          query("dateTo", "YYYY-MM-DD"),
          query("all", "`1` to skip the default date filter"),
          query("sortBy", undefined, { default: "created_at" }),
          query("sortOrder", undefined, { enum: ["asc", "desc"], default: "desc" }),
          ...pagination,
        ],
        ...authed(),
      },
    },
    "/api/admin/applications/{application_id}": {
      get: {
        tags: ["Admin applications"],
        summary: "Get one application",
        description: rolesNote(["admin", "reviewer", "viewer"]),
        parameters: [appId],
        ...authed(["admin", "reviewer", "viewer"]),
      },
      patch: {
        tags: ["Admin applications"],
        summary: "Update an application",
        description: rolesNote(["admin", "reviewer"]),
        parameters: [appId],
        requestBody: body("AdminApplicationUpdate"),
        ...authed(["admin", "reviewer"]),
      },
      delete: {
        tags: ["Admin applications"],
        summary: "Delete an application",
        description: rolesNote(["admin"]),
        parameters: [appId],
        ...authed(["admin"]),
      },
    },
    "/api/admin/applications/{application_id}/reveal-sensitive": {
      post: {
        tags: ["Admin applications"],
        summary: "Reveal decrypted SSN / DL / account number (audited)",
        description: rolesNote(["admin"]),
        parameters: [appId],
        ...authed(["admin"]),
      },
    },
    "/api/admin/applications/{application_id}/download-loan-agreement": {
      get: {
        tags: ["Admin applications"],
        summary: "Download the loan agreement PDF",
        description: "⚠️ This route currently has **no auth check**.",
        parameters: [appId],
        responses: {
          "200": {
            description: "PDF file",
            content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
          },
          "404": { description: "Not found" },
          "500": { description: "Internal error" },
        },
      },
    },
    "/api/admin/export-applications": {
      get: {
        tags: ["Admin applications"],
        summary: "All applications, unpaginated (for CSV export)",
        description: rolesNote(["admin", "reviewer"]),
        ...authed(["admin", "reviewer"]),
      },
    },
    "/api/admin/stats": {
      get: {
        tags: ["Admin dashboard"],
        summary: "Headline counts",
        description: rolesNote(),
        ...authed(),
      },
    },
    "/api/admin/analytics": {
      get: {
        tags: ["Admin dashboard"],
        summary: "Dashboard chart data",
        description: rolesNote(),
        parameters: [
          query("range", undefined, {
            enum: ["1d", "7d", "30d", "90d", "1y"],
            default: "30d",
          }),
        ],
        ...authed(),
      },
    },
    "/api/admin/users": {
      get: {
        tags: ["Admin users"],
        summary: "List admin users",
        description: rolesNote(["admin"]),
        parameters: [
          query("search"),
          query("role", undefined, { enum: ["admin", "reviewer", "viewer"] }),
          ...pagination,
        ],
        ...authed(["admin"]),
      },
    },
    "/api/admin/users/{id}/deactivate": {
      put: {
        tags: ["Admin users"],
        summary: "Deactivate a user",
        description: rolesNote(["admin"]),
        parameters: [pathParam("id")],
        ...authed(["admin"]),
      },
    },
    "/api/admin/users/{id}/activate": {
      put: {
        tags: ["Admin users"],
        summary: "Activate a user",
        description: rolesNote(["admin"]),
        parameters: [pathParam("id")],
        ...authed(["admin"]),
      },
    },
    "/api/admin/messages": {
      get: {
        tags: ["Admin messages"],
        summary: "List contact-form messages",
        description: rolesNote(),
        parameters: [query("search"), ...pagination],
        ...authed(),
      },
    },

    // ---------------------------------------------------------------- seo --
    "/sitemap.xml": {
      get: {
        tags: ["SEO"],
        summary: "Sitemap",
        responses: {
          "200": { description: "XML", content: { "application/xml": {} } },
        },
      },
    },
  },
};
