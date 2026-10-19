import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { setMyPassword } from "./actions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PasswordPage({ searchParams }: Props) {
  await requireAuthenticatedUser();
  const query = await searchParams;
  return <section className="auth-page auth-card">
    <h1>Set your password</h1>
    <p>Do this once after signing in with your email link. From then on, sign in directly with your email and password.</p>
    {query.updated === "1" ? <p role="status">Password saved. You can now sign in without email codes.</p> : null}
    {query.error === "weak-password" ? <p role="alert">Use at least 12 characters.</p> : null}
    {query.error === "update-failed" ? <p role="alert">Password update failed. Please try again.</p> : null}
    <form action={setMyPassword} className="auth-form">
      <label htmlFor="new-password">New password</label>
      <input id="new-password" name="password" type="password" minLength={12} autoComplete="new-password" required />
      <button type="submit">Save password</button>
    </form>
  </section>;
}
