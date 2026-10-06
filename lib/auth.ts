import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config";
import { encrypt, decrypt, equalSecret } from "./security";
import { AppError, type Identity } from "./model";
export function cookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get("cookie") || "").split(";").map((pair) => {
      const i = pair.indexOf("=");
      return i < 0 ? ["", ""] : [pair.slice(0, i).trim(), pair.slice(i + 1)];
    }),
  );
}
export function cookie(
  name: string,
  value: string,
  maxAge: number,
  path = "/",
  sameSite = "Lax",
) {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${config().local ? "" : "; Secure"}`;
}
export function verifyOrigin(request: Request) {
  if (request.headers.get("origin") !== config().origin)
    throw new AppError(403, "Request origin is not permitted.");
}
export function identity(request: Request): Identity {
  const cfg = config();
  if (!cfg.local && (!cfg.clientId || !cfg.clientSecret))
    throw new AppError(
      503,
      "Google sign-in is awaiting Internal OAuth configuration.",
    );
  const value = cookies(request).soe_session;
  if (!value) throw new AppError(401, "Sign in to continue.");
  const session = decrypt<{
    user: Identity;
    expires: number;
    application: string;
  }>(value, "owner-session");
  if (
    session.expires <= Date.now() ||
    session.application !== (cfg.local ? "local" : cfg.clientId)
  )
    throw new AppError(401, "Sign in again to continue.");
  return session.user;
}
export const sessionCookie = (user: Identity) =>
  cookie(
    "soe_session",
    encrypt(
      {
        user,
        expires: Date.now() + 8 * 3600000,
        application: config().local ? "local" : config().clientId,
      },
      "owner-session",
    ),
    8 * 3600,
  );
export async function beginOAuth() {
  const cfg = config();
  if (cfg.local || !cfg.clientId || !cfg.clientSecret)
    throw new AppError(503, "Internal Google OAuth has not been configured.");
  const oauth = new OAuth2Client(
    cfg.clientId,
    cfg.clientSecret,
    `${cfg.origin}/api/auth/callback`,
  );
  const pkce = await oauth.generateCodeVerifierAsync(),
    state = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url");
  const flow = encrypt(
    {
      state,
      nonce,
      verifier: pkce.codeVerifier,
      expires: Date.now() + 10 * 60000,
    },
    "oauth-flow",
  );
  return {
    url: oauth.generateAuthUrl({
      scope: ["openid", "email", "profile"],
      state,
      nonce,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: "S256" as never,
      prompt: "select_account",
    }),
    flow,
  };
}
export async function finishOAuth(request: Request): Promise<Identity> {
  const cfg = config(),
    url = new URL(request.url),
    value = cookies(request).soe_oauth_flow;
  if (cfg.local || !cfg.clientId || !cfg.clientSecret || !value)
    throw new AppError(401, "The sign-in request is invalid.");
  const flow = decrypt<{
    state: string;
    nonce: string;
    verifier: string;
    expires: number;
  }>(value, "oauth-flow");
  if (
    flow.expires <= Date.now() ||
    !equalSecret(url.searchParams.get("state") || "", flow.state) ||
    !url.searchParams.get("code")
  )
    throw new AppError(
      401,
      "The sign-in request expired or was rejected. Try again.",
    );
  const oauth = new OAuth2Client(
    cfg.clientId,
    cfg.clientSecret,
    `${cfg.origin}/api/auth/callback`,
  );
  const { tokens } = await oauth.getToken({
    code: url.searchParams.get("code")!,
    codeVerifier: flow.verifier,
  });
  if (!tokens.id_token)
    throw new AppError(401, "Google did not provide a verified identity.");
  const ticket = await oauth.verifyIdToken({
      idToken: tokens.id_token,
      audience: cfg.clientId,
    }),
    claims = ticket.getPayload();
  if (
    !claims ||
    !claims.email_verified ||
    !claims.sub ||
    !claims.email ||
    claims.exp * 1000 <= Date.now() ||
    !["accounts.google.com", "https://accounts.google.com"].includes(
      claims.iss,
    ) ||
    (claims as typeof claims & { nonce: string }).nonce !== flow.nonce
  )
    throw new AppError(401, "Google identity validation failed.");
  return {
    id: claims.sub,
    email: claims.email,
    name: claims.name || claims.email,
  };
}
