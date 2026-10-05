import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationNames = [
  "202610050001_d1_product_schema.sql",
  "202610050002_d3_follow_lifecycle.sql",
  "202610050003_d4_feed.sql",
  "202610050004_d5_summary_engine.sql",
  "202610050005_d7_billing.sql",
];

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid)
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to public;
  `);
  for (const name of migrationNames) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  await db.exec(`
    insert into auth.users (id,email) values ('00000000-0000-4000-8000-00000000000a','a@example.test');
    insert into public.channels (channel_uid,native_channel_id,title,canonical_url)
      values ('youtube-channel:UC1','UC1','Test','https://youtube.com/channel/UC1');
    insert into public.videos (video_uid,channel_uid,native_video_id,title,canonical_url,published_at,duration_seconds,availability)
      values ('youtube:abcdefghijk','youtube-channel:UC1','abcdefghijk','Video','https://youtube.com/watch?v=abcdefghijk',now(),121,'public');
  `);
  return db;
}

async function apply(db, {
  eventId = "event-1", action = "active", eventAt = "2026-10-05T12:00:00Z",
  periodStart = "2026-10-01T00:00:00Z", periodEnd = "2026-11-01T00:00:00Z", sub = "sub-1",
} = {}) {
  const { rows } = await db.query(`select public.apply_polar_entitlement_event(
    $1,'00000000-0000-4000-8000-00000000000a',$2,$3,'customer-1',$4,$5,$6,30,600) as result`,
  [eventId, action, sub, periodStart, periodEnd, eventAt]);
  return rows[0].result;
}

test("Polar event receipt and entitlement mutation are atomic, idempotent, and renewal aware", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  assert.equal(await apply(db), "applied");
  assert.deepEqual((await db.query("select plan_code,status,follow_limit,generation_minutes_limit,billing_subscription_id from public.entitlements")).rows[0], {
    plan_code: "paid", status: "active", follow_limit: 30, generation_minutes_limit: 600, billing_subscription_id: "sub-1",
  });
  assert.equal(await apply(db), "duplicate");

  assert.equal(await apply(db, { eventId: "renewal", eventAt: "2026-11-01T00:00:05Z", periodStart: "2026-11-01T00:00:00Z", periodEnd: "2026-12-01T00:00:00Z" }), "applied");
  assert.equal((await db.query("select to_char(period_end at time zone 'UTC','YYYY-MM-DD') as end from public.entitlements")).rows[0].end, "2026-12-01");
  assert.equal(await apply(db, { eventId: "old-event", eventAt: "2026-10-20T00:00:00Z", action: "past_due" }), "stale");
  assert.equal((await db.query("select status from public.entitlements")).rows[0].status, "active");
  assert.equal((await db.query("select count(*)::int as n from public.billing_webhook_events")).rows[0].n, 3);
});

test("paid-through cancellation remains authorized until period end; payment issues and expiry block access", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  assert.equal(await apply(db), "applied");
  assert.equal(await apply(db, { eventId: "cancel", action: "canceled", eventAt: "2026-10-05T13:00:00Z" }), "applied");
  const duringPeriod = await db.query("select public.has_paid_entitlement_access(status, period_end) as allowed from public.entitlements");
  assert.equal(duringPeriod.rows[0].allowed, true);
  await db.query("select * from public.create_follow_with_limit('00000000-0000-4000-8000-00000000000a','youtube-channel:UC1')");
  const summary = await db.query(`select public.claim_summary_generation(
    '00000000-0000-4000-8000-00000000000a','youtube:abcdefghijk',
    'sha256:${"a".repeat(64)}','v1','primary',3) as result`);
  assert.equal(summary.rows[0].result.state, "claimed");

  assert.equal(await apply(db, { eventId: "expired-active", action: "active", eventAt: "2026-10-05T13:30:00Z", periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-10-02T00:00:00Z" }), "applied");
  assert.equal((await db.query("select plan_code from public.entitlements")).rows[0].plan_code, "none");
  const expiredSummary = await db.query(`select public.claim_summary_generation(
    '00000000-0000-4000-8000-00000000000a','youtube:abcdefghijk',
    'sha256:${"c".repeat(64)}','v1','primary',3) as result`);
  assert.equal(expiredSummary.rows[0].result.state, "quota_blocked");
  await db.query("delete from public.follows where user_id='00000000-0000-4000-8000-00000000000a'");
  await assert.rejects(db.query("select * from public.create_follow_with_limit('00000000-0000-4000-8000-00000000000a','youtube-channel:UC1')"));

  assert.equal(await apply(db, { eventId: "expired", action: "canceled", eventAt: "2026-11-01T00:00:00Z", periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-10-02T00:00:00Z" }), "applied");
  assert.deepEqual((await db.query("select plan_code,status,follow_limit,generation_minutes_limit from public.entitlements")).rows[0], {
    plan_code: "none", status: "none", follow_limit: 0, generation_minutes_limit: 0,
  });

  assert.equal(await apply(db, { eventId: "reactivate", eventAt: "2026-11-02T00:00:00Z" }), "applied");
  await db.query("select * from public.create_follow_with_limit('00000000-0000-4000-8000-00000000000a','youtube-channel:UC1')");
  assert.equal(await apply(db, { eventId: "past-due", action: "past_due", eventAt: "2026-11-03T00:00:00Z" }), "applied");
  const blocked = await db.query(`select public.claim_summary_generation(
    '00000000-0000-4000-8000-00000000000a','youtube:abcdefghijk',
    'sha256:${"b".repeat(64)}','v1','primary',3) as result`);
  assert.equal(blocked.rows[0].result.state, "quota_blocked");
});

test("a browser role cannot apply a billing event or change its own plan", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec("begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a'");
  try {
    await assert.rejects(db.query(`select public.apply_polar_entitlement_event('browser','00000000-0000-4000-8000-00000000000a','active','s','c',now(),now()+interval '1 month',now(),30,600)`));
    await assert.rejects(db.exec("update public.entitlements set status='active',plan_code='paid',follow_limit=999"));
  } finally {
    await db.exec("rollback");
  }
  assert.equal((await db.query("select count(*)::int as n from public.billing_webhook_events")).rows[0].n, 0);
});
