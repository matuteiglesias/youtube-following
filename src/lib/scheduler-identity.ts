import { createPublicKey, verify as verifySignature } from "node:crypto";

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const MAX_CLOCK_SKEW_SECONDS = 300;

type Jwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  sub?: string;
};

type CachedJwks = {
  expiresAt: number;
  keys: Jwk[];
};

let cachedJwks: CachedJwks | null = null;

export class SchedulerIdentityError extends Error {
  readonly code: "missing_token" | "invalid_token" | "wrong_identity" | "verification_unavailable";

  constructor(code: SchedulerIdentityError["code"]) {
    super("Scheduler identity could not be verified");
    this.name = "SchedulerIdentityError";
    this.code = code;
  }
}

function decodeJsonSegment<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new SchedulerIdentityError("invalid_token");
  }
}

function audienceMatches(actual: string | string[] | undefined, expected: string): boolean {
  if (typeof actual === "string") return actual === expected;
  return Array.isArray(actual) && actual.includes(expected);
}

function maxAgeSeconds(value: string | null): number {
  if (!value) return 3600;
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(value);
  if (!match) return 3600;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

async function getGoogleJwks(
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<Jwk[]> {
  if (cachedJwks && cachedJwks.expiresAt > nowMs) return cachedJwks.keys;
  let response: Response;
  try {
    response = await fetcher(GOOGLE_JWKS_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new SchedulerIdentityError("verification_unavailable");
  }
  if (!response.ok) throw new SchedulerIdentityError("verification_unavailable");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SchedulerIdentityError("verification_unavailable");
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { keys?: unknown }).keys)) {
    throw new SchedulerIdentityError("verification_unavailable");
  }
  const keys = (payload as { keys: Jwk[] }).keys.filter(
    (key) => key && key.kty === "RSA" && typeof key.kid === "string",
  );
  if (keys.length === 0) throw new SchedulerIdentityError("verification_unavailable");
  cachedJwks = {
    keys,
    expiresAt: nowMs + maxAgeSeconds(response.headers.get("cache-control")) * 1000,
  };
  return keys;
}

export function verifySchedulerIdentityToken(
  token: string,
  options: {
    audience: string;
    serviceAccountEmail: string;
    jwks: Jwk[];
    nowSeconds?: number;
  },
): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new SchedulerIdentityError("invalid_token");
  }

  const header = decodeJsonSegment<JwtHeader>(parts[0]);
  const payload = decodeJsonSegment<JwtPayload>(parts[1]);
  if (header.alg !== "RS256" || !header.kid) {
    throw new SchedulerIdentityError("invalid_token");
  }

  const jwk = options.jwks.find(
    (candidate) =>
      candidate.kid === header.kid
      && candidate.kty === "RSA"
      && (candidate.alg === undefined || candidate.alg === "RS256"),
  );
  if (!jwk) throw new SchedulerIdentityError("invalid_token");

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    throw new SchedulerIdentityError("invalid_token");
  }

  let signatureValid = false;
  try {
    signatureValid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) throw new SchedulerIdentityError("invalid_token");

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !payload.iss
    || !GOOGLE_ISSUERS.has(payload.iss)
    || !audienceMatches(payload.aud, options.audience)
    || typeof payload.exp !== "number"
    || payload.exp <= now - MAX_CLOCK_SKEW_SECONDS
    || typeof payload.iat !== "number"
    || payload.iat > now + MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new SchedulerIdentityError("invalid_token");
  }

  if (
    payload.email !== options.serviceAccountEmail
    || payload.email_verified !== true
    || typeof payload.sub !== "string"
    || payload.sub.length === 0
  ) {
    throw new SchedulerIdentityError("wrong_identity");
  }

  return payload;
}

export async function verifySchedulerRequest(
  authorizationHeader: string | null,
  options: {
    audience: string;
    serviceAccountEmail: string;
    fetcher?: typeof fetch;
    nowMs?: number;
  },
): Promise<void> {
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorizationHeader ?? "");
  if (!match) throw new SchedulerIdentityError("missing_token");
  const nowMs = options.nowMs ?? Date.now();
  const jwks = await getGoogleJwks(options.fetcher ?? fetch, nowMs);
  verifySchedulerIdentityToken(match[1], {
    audience: options.audience,
    serviceAccountEmail: options.serviceAccountEmail,
    jwks,
    nowSeconds: Math.floor(nowMs / 1000),
  });
}
