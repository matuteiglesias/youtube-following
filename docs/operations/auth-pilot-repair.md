# Authentication repair and first-user pilot — 2026-10-19

## Verified live root cause and repair

- The deployed `APP_URL` already pointed to
  `https://youtube-following-web-azt5ox4xuq-rj.a.run.app`.
- The hosted Supabase project's **effective** Auth config was separately pulled
  and found to contain `site_url = "http://localhost:3000"` and a localhost-only
  callback allowlist.
- The hosted Auth project (`xffmfedbivleqqtfjcly`) was updated with the
  production Cloud Run origin and exact `/auth/callback` redirect, retaining
  localhost callback for local development.
- Supabase CLI config diff after the update reported **zero changes** in the
  two managed Auth settings (six remote-only SMTP fields were deliberately
  preserved). `supabase/config.toml` in this repo remains a local dev config;
  do not push it blindly to production.
- **Browser completion and mailbox delivery remain to be verified.** A redirect
  configuration PASS is not evidence of successful end-to-end login.

## New credentials UX

- Password-first form at `/login` for existing Supabase users.
- Explicit email/password registration; hosted Supabase currently has email
  confirmation enabled, so new users verify **once**, not at every login.
- Existing magic-link-only users can log in once with the now-corrected link
  and visit `/account/password` to set a password for future logins.
- Optional username `demo` is merely an alias for an **existing** Supabase
  account configured through server-only `PILOT_DEMO_EMAIL`. It is not a
  hardcoded password or authorization bypass.
- Account creation and internal test entitlement are separate operations.
  Normal sign-up begins with zero follow/generation privileges.

## Pilot credential handling and limitations

The preferred preprovisioned pilot identity is
`pilot-demo@youtube-following.test`. An operator with legitimate access to the
existing server-role credential can provision it with
`scripts/provision-pilot-demo.mjs` by setting the required temporary
environment values (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `PILOT_DEMO_EMAIL`,
`PILOT_DEMO_PASSWORD`).
The provisioning script requires a random password of at least 18 characters,
confirms the synthetic pilot email, and grants **4 follows/240 generation
minutes**, so an accidental anonymous/shared account cannot cause unbounded
AI spend.

**Current result:** That administrative provision was not completed in this
intervention because access to the credential-handling operation was blocked.
Do not announce `demo` as a working account without an actual successful
admin provisioning receipt. Do not deploy weak `demo/1234` credentials to
public Cloud Run; a scripted attacker could exhaust allowance or access all
pilot account data.

## Next acceptance gate

- Existing user: request a fresh sign-in email; verify callback ends at the
  Cloud Run origin and creates an authenticated session, then set a long
  password once at `/account/password`.
- Or new user: create account with password, confirm mailbox once, sign in
  directly thereafter.
- Assign a bounded internal test entitlement by a trusted operator before
  expecting Follow or uncached Summaries to work.
- Confirm password logout/login and two real followed channels; document
  anonymized results in issue #19.
