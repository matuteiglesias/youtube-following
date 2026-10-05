type AuthClient = {
  auth: {
    signInWithOtp(input: { email: string; options: { emailRedirectTo: string; shouldCreateUser: true } }): Promise<{ error: unknown }>;
    signOut(): Promise<{ error: unknown }>;
  };
};

export function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function magicLinkRedirect(appUrl: string): string {
  const url = new URL(appUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_URL must use HTTPS outside local development");
  }
  return `${url.origin}/auth/callback?next=%2F`;
}

export async function requestMagicLink(client: AuthClient, value: unknown, appUrl: string) {
  const email = normalizeEmail(value);
  if (!email) return "invalid-email" as const;
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: magicLinkRedirect(appUrl), shouldCreateUser: true },
  });
  return error ? "failed" as const : "sent" as const;
}

export async function endSession(client: AuthClient) {
  const { error } = await client.auth.signOut();
  return !error;
}

export function safeNextPath(value: string | null) {
  return value === "/" || value === "/following" ? value : "/";
}
