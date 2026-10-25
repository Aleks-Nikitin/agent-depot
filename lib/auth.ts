import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins";
import { getDb } from "./db/prisma";
import { HttpError } from "./auth/errors";

export function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseURL) throw new HttpError(503, "auth_not_configured");
  const url = new URL(baseURL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/"
    || url.search || url.hash || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new HttpError(503, "auth_not_configured");
  }
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return betterAuth({
    appName: "Agent Depot", baseURL: url.origin, secret,
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
    socialProviders: clientId && clientSecret ? { github: { clientId, clientSecret } } : {},
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { cookieCache: { enabled: false }, expiresIn: 7 * 24 * 60 * 60 },
    rateLimit: { enabled: true },
    logger: { disabled: true },
    plugins: [anonymous(), nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() { return instance ??= createAuth(); }
