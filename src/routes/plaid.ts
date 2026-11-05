import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";

const router = Router();

const plaidClientId = process.env.PLAID_CLIENT_ID;
const plaidSecret = process.env.PLAID_SECRET;
const plaidEnv = process.env.PLAID_ENV || "sandbox";

const plaidConfig = new Configuration({
  basePath:
    PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ||
    PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": plaidClientId || "",
      "PLAID-SECRET": plaidSecret || "",
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

export const publicTokenSchema = z.object({
  publicToken: z.string().min(1, "Public token is required"),
});

router.post("/create-link-token", async (_req: Request, res: Response) => {
  try {
    if (!plaidClientId || !plaidSecret) {
      return res.status(500).json({
        error: "Plaid credentials are not configured on the backend.",
      });
    }

    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: "Oakhill-loans-user",
      },
      client_name: "LongLake Loans",
      products: [Products.Auth, Products.Transactions],
      language: "en",
      country_codes: [CountryCode.Us],
      redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
    });

    return res.json({
      success: true,
      linkToken: response.data.link_token,
    });
  } catch (error) {
    console.error("Plaid link token creation failed:", error);
    return res.status(500).json({
      error: "Unable to initialize Plaid bank linking.",
    });
  }
});

router.post("/exchange-public-token", async (req: Request, res: Response) => {
  try {
    if (!plaidClientId || !plaidSecret) {
      return res.status(500).json({
        error: "Plaid credentials are not configured on the backend.",
      });
    }

    const parsed = publicTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || "Invalid public token",
      });
    }

    const exchange = await plaidClient.itemPublicTokenExchange({
      public_token: parsed.data.publicToken,
    });

    const accounts = await plaidClient.accountsGet({
      access_token: exchange.data.access_token,
    });

    const institutionName =
      accounts.data.accounts[0]?.official_name ||
      accounts.data.accounts[0]?.name ||
      "Plaid Connected Account";

    const account = accounts.data.accounts[0];

    return res.json({
      success: true,
      itemId: exchange.data.item_id,
      institutionName,
      accountId: account?.account_id || null,
      accountMask: account?.mask || null,
      accountType: account?.subtype || account?.type || null,
    });
  } catch (error) {
    console.error("Plaid public token exchange failed:", error);
    return res.status(500).json({
      error: "Unable to complete Plaid verification.",
    });
  }
});

export default router;
