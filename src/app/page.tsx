import { FeedPlaceholder } from "@/components/feed-placeholder";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { signOut } from "@/app/login/actions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FeedPage({ searchParams }: Props) {
  const user = await requireAuthenticatedUser();
  const query = await searchParams;
  return <><header className="account-bar"><span>{user.email}</span><form action={signOut}><button type="submit">Sign out</button></form></header>{query.error === "signout-failed" ? <p role="alert">We couldn’t sign you out. Please try again.</p> : null}<FeedPlaceholder /></>;
}
