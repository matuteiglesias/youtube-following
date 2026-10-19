type AuthClient = {
  auth: {
    signInWithOtp(input: { email: string; options: { emailRedirectTo: string; shouldCreateUser: true } }): Promise<{ error: unknown }>;
    signOut(): Promise<{ error: unknown }>;
    signInWithPassword(input: { email: string; password: string }): Promise<{ error: unknown }>;
    signUp(input: { email: string; password: string; options: { emailRedirectTo: string } }): Promise<{ data: { session: unknown }; error: unknown }>;
    updateUser(input: { password: string }): Promise<{ error: unknown }>;
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

/** Demo is only an alias for a provisioned Supabase user, never an auth bypass. */
export async function requestPasswordSignIn(
  client: Pick<AuthClient, "auth">,
  identifier: unknown,
  password: unknown,
  pilotDemoEmail: string | undefined,
) {
  const name = String(identifier ?? "").trim().toLowerCase();
  const email = normalizeEmail(name === "demo" ? pilotDemoEmail : name);
  if (!email || typeof password !== "string" || password.length === 0) {
    return "invalid-credentials" as const;
  }
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? "invalid-credentials" as const : "signed-in" as const;
}

export async function requestPasswordRegistration(
  client: Pick<AuthClient, "auth">,
  value: unknown,
  password: unknown,
  appUrl: string,
) {
  const email = normalizeEmail(value);
  if (!email) return "invalid-email" as const;
  if (typeof password !== "string" || password.length < 12) return "weak-password" as const;
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: magicLinkRedirect(appUrl) },
  });
  if (error) return "failed" as const;
  return data.session ? "signed-in" as const : "check-email" as const;
}

export async function requestPasswordUpdate(client: Pick<AuthClient, "auth">, value: unknown) {
  if (typeof value !== "string" || value.length < 12) return "weak-password" as const;
  const { error } = await client.auth.updateUser({ password: value });
  return error ? "failed" as const : "updated" as const;
}

export async function endSession(client: AuthClient) {
  const { error } = await client.auth.signOut();
  return !error;
}

export function safeNextPath(value: string | null) {
  return value === "/" || value === "/following" ? value : "/";
}
