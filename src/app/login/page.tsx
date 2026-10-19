import { redirect } from "next/navigation";
import { sendMagicLink, signInWithPassword, createPasswordAccount } from "./actions";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  if (await getAuthenticatedUser()) redirect("/");
  const query = await searchParams;
  const sent = query.sent === "1";
  const error = query.error;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Sign in to YouTube Following</h1>
        <p>Use your email and password to sign in. No email code is needed after your account is set up.</p>
        {process.env.PILOT_DEMO_EMAIL
          ? <p>Pilot test account: enter <strong>demo</strong> as your username and its assigned password.</p>
          : null}
        {query.registered === "1"
          ? <p role="status">Account created. Check your inbox once to confirm your email, then sign in with your password.</p>
          : null}
        {error === "invalid-credentials"
          ? <p role="alert">That username or password didn’t work. Check the credentials and try again.</p> : null}
        <form action={signInWithPassword} className="auth-form">
          <label htmlFor="identifier">Email or pilot username</label>
          <input id="identifier" name="identifier" type="text" autoComplete="username" required />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button type="submit">Sign in</button>
        </form>
        <details className="auth-alternative">
          <summary>New here? Create an account with a password</summary>
          {error === "weak-password" ? <p role="alert">Choose a password with at least 12 characters.</p> : null}
          {error === "signup-failed" ? <p role="alert">Account creation failed. Try again or sign in with an existing account.</p> : null}
          <form action={createPasswordAccount} className="auth-form">
            <label htmlFor="signup-email">Email address</label>
            <input id="signup-email" name="email" type="email" autoComplete="email" required />
            <label htmlFor="signup-password">New password (12+ characters)</label>
            <input id="signup-password" name="password" type="password" autoComplete="new-password" minLength={12} required />
            <button type="submit">Create account</button>
          </form>
        </details>
        <details className="auth-alternative">
          <summary>Prefer a sign-in link by email?</summary>
          {sent ? <p role="status">Check your email for your sign-in link.</p> : null}
          {error === "invalid-email" ? <p role="alert">Enter a valid email address.</p> : null}
          {error === "send-failed" || error === "callback-failed"
            ? <p role="alert">We couldn’t sign you in. Please try again.</p> : null}
          <form action={sendMagicLink} className="auth-form">
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
            <button type="submit">Email me a sign-in link</button>
          </form>
        </details>
      </section>
    </main>
  );
}
