import { redirect } from "next/navigation";
import { sendMagicLink } from "./actions";
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
        <p>We’ll email you a secure sign-in link.</p>
        {sent ? <p role="status">Check your email for your sign-in link.</p> : null}
        {error === "invalid-email" ? <p role="alert">Enter a valid email address.</p> : null}
        {error === "send-failed" || error === "callback-failed" ? <p role="alert">We couldn’t sign you in. Please try again.</p> : null}
        <form action={sendMagicLink}>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <button type="submit">Email me a sign-in link</button>
        </form>
      </section>
    </main>
  );
}
