import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/202610050001_d1_product_schema.sql", import.meta.url);
const d3MigrationUrl = new URL("../supabase/migrations/202610050002_d3_follow_lifecycle.sql", import.meta.url);
const d4MigrationUrl = new URL("../supabase/migrations/202610050003_d4_feed.sql", import.meta.url);
const d5MigrationUrl = new URL("../supabase/migrations/202610050004_d5_summary_engine.sql", import.meta.url);
const d8MigrationUrl = new URL("../supabase/migrations/202610050006_d8_demo_feed.sql", import.meta.url);

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
      )
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to public;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(await readFile(d3MigrationUrl, "utf8"));
  await db.exec(await readFile(d4MigrationUrl, "utf8"));
  await db.exec(await readFile(d5MigrationUrl, "utf8"));
  await db.exec(await readFile(d8MigrationUrl, "utf8"));
  await db.exec(`
    insert into auth.users (id, email) values
      ('00000000-0000-0000-0000-00000000000a', 'a@example.test'),
      ('00000000-0000-0000-0000-00000000000b', 'b@example.test');
    insert into public.channels (channel_uid, native_channel_id, title, canonical_url)
      values ('youtube-channel:UC1', 'UC1', 'Test', 'https://youtube.com/channel/UC1');
    insert into public.follows (user_id, channel_uid) values
      ('00000000-0000-0000-0000-00000000000a', 'youtube-channel:UC1'),
      ('00000000-0000-0000-0000-00000000000b', 'youtube-channel:UC1');
    insert into public.videos (video_uid, channel_uid, native_video_id, title, canonical_url, published_at)
      values ('youtube:v1', 'youtube-channel:UC1', 'v1', 'Video', 'https://youtube.com/watch?v=v1', now());
    insert into public.summaries (summary_key, video_uid, spec_version, language, state, summary_id, summary_text, generated_at)
      values ('s1', 'youtube:v1', 'v1', 'en', 'available', 'provider-summary-1', 'Summary', now()),
             ('s2', 'youtube:v1', 'v2', 'en', 'generating', null, null, null),
             ('s3', 'youtube:v1', 'v3', 'en', 'available', 'provider-summary-3', 'Summary', now());
    insert into public.summary_generation_claims (summary_key, claimant_user_id, state, finished_at) values
      ('s1', '00000000-0000-0000-0000-00000000000a', 'succeeded', now()),
      ('s3', '00000000-0000-0000-0000-00000000000b', 'succeeded', now());
    insert into public.summary_usage (user_id, summary_key, billing_period, charged_minutes) values
      ('00000000-0000-0000-0000-00000000000a', 's1', current_date, 2),
      ('00000000-0000-0000-0000-00000000000b', 's3', current_date, 3);
  `);
  return db;
}

async function asRole(db, role, userId, sql) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    if (userId) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return await sql();
  } finally {
    await db.exec("rollback");
  }
}

test("D1 migration enforces two-user isolation, anonymous boundaries and protected writes", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  const b = "00000000-0000-0000-0000-00000000000b";

  const defaults = await db.query("select plan_code, status, follow_limit, generation_minutes_limit from public.entitlements order by user_id");
  assert.deepEqual(defaults.rows, [
    { plan_code: "none", status: "none", follow_limit: 0, generation_minutes_limit: 0 },
    { plan_code: "none", status: "none", follow_limit: 0, generation_minutes_limit: 0 },
  ]);
  assert.equal((await db.query("select count(*)::int as n from public.profiles")).rows[0].n, 2);

  const own = await asRole(db, "authenticated", a, async () => {
    const follows = await db.query("select channel_uid from public.follows");
    const entitlements = await db.query("select plan_code from public.entitlements");
    const summaries = await db.query("select summary_key from public.summaries");
    const usage = await db.query("select count(*)::int as n from public.summary_usage");
    const profileUpdate = await db.query("update public.profiles set updated_at = now() where user_id = $1", [a]);
    const otherProfileUpdate = await db.query("update public.profiles set updated_at = now() where user_id = $1", [b]);
    return { follows, entitlements, summaries, usage, profileUpdate, otherProfileUpdate };
  });
  assert.deepEqual(own.follows.rows, [{ channel_uid: "youtube-channel:UC1" }]);
  assert.deepEqual(own.entitlements.rows, [{ plan_code: "none" }]);
  assert.deepEqual(own.summaries.rows, [{ summary_key: "s1" }, { summary_key: "s3" }]);
  assert.equal(own.usage.rows[0].n, 1);
  assert.equal(own.profileUpdate.rowCount, 1);
  assert.equal(own.otherProfileUpdate.rowCount, 0);
  const ownFollowDelete = await asRole(db, "authenticated", a, () => db.query("delete from public.follows where channel_uid = $1", ["youtube-channel:UC1"]));
  assert.equal(ownFollowDelete.rowCount, 1);

  const noBRows = await asRole(db, "authenticated", a, () => db.query("select * from public.profiles where user_id = $1", [b]));
  assert.equal(noBRows.rows.length, 0);
  await assert.rejects(asRole(db, "authenticated", a, () => db.exec(`update public.follows set followed_at = now() where user_id = '${b}'`)));

  for (const statement of [
    "insert into public.follows (user_id, channel_uid) values ('00000000-0000-0000-0000-00000000000a', 'youtube-channel:UC1')",
    "insert into public.channels (channel_uid, native_channel_id, title, canonical_url) values ('youtube-channel:UC2', 'UC2', 'x', 'https://youtube.com/channel/UC2')",
    "update public.videos set title = 'forged'",
    "update public.summaries set summary_text = 'forged'",
    "update public.entitlements set follow_limit = 500",
    "insert into public.summary_usage (user_id, summary_key, billing_period, charged_minutes) values ('00000000-0000-0000-0000-00000000000a', 's1', current_date, 2)",
    "insert into public.summary_generation_claims (summary_key, claimant_user_id) values ('s1', '00000000-0000-0000-0000-00000000000a')",
  ]) {
    await assert.rejects(asRole(db, "authenticated", a, () => db.exec(statement)));
  }

  await assert.rejects(asRole(db, "anon", null, () => db.query("select * from public.channels")));
  await assert.rejects(asRole(db, "anon", null, () => db.exec("insert into public.follows (user_id, channel_uid) values ('00000000-0000-0000-0000-00000000000a', 'youtube-channel:UC1')")));
  for (const table of ["profiles", "channels", "follows", "videos", "summaries", "summary_generation_claims", "summary_usage", "entitlements"]) {
    await assert.rejects(asRole(db, "anon", null, () => db.query(`select * from public.${table}`)));
  }
  await assert.rejects(asRole(db, "anon", null, () => db.query("select public.grant_internal_test_entitlement($1)", [a])));
});

test("D8 public demo query is bounded, cached-only, independent of follows, and service-role-only", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const channelUid = "youtube-channel:UC0123456789abcdefghijkl";
  await db.exec(`
    insert into public.channels (channel_uid, native_channel_id, title, canonical_url)
      values ('${channelUid}', 'UC0123456789abcdefghijkl', 'Demo Channel', 'https://youtube.com/@demo');
    insert into public.videos (video_uid, channel_uid, native_video_id, title, canonical_url, published_at, availability, live_status)
      values ('youtube:abcdefghijk', '${channelUid}', 'abcdefghijk', 'Cached demo video', 'https://youtube.com/watch?v=abcdefghijk', now(), 'public', 'completed'),
             ('youtube:ZYXWVUTSRQP', '${channelUid}', 'ZYXWVUTSRQP', 'Uncached video', 'https://youtube.com/watch?v=ZYXWVUTSRQP', now() - interval '1 hour', 'public', 'completed'),
             ('youtube:mnopqrstuvw', '${channelUid}', 'mnopqrstuvw', 'Private video', 'https://youtube.com/watch?v=mnopqrstuvw', now() - interval '2 hours', 'private', 'completed'),
             ('youtube:12345678901', '${channelUid}', '12345678901', 'Live video', 'https://youtube.com/watch?v=12345678901', now() - interval '3 hours', 'public', 'live');
    insert into public.summaries (summary_key, video_uid, spec_version, language, state, summary_id, summary_text, key_points, generated_at)
      values ('demo-summary', 'youtube:abcdefghijk', 'v1', 'en', 'available', 'demo-1', 'Already cached.', '["Useful point"]'::jsonb, now());
  `);

  const visible = await asRole(db, "service_role", null, () => db.query(
    "select feed_item from public.read_demo_feed_page($1::text[], 50)", [[channelUid]],
  ));
  assert.equal(visible.rows.length, 1);
  assert.equal(visible.rows[0].feed_item.summary.state, "available");
  assert.equal(visible.rows[0].feed_item.summary.summary, "Already cached.");
  await assert.rejects(() => asRole(db, "anon", null, () => db.query(
    "select * from public.read_demo_feed_page($1::text[], 20)", [[channelUid]],
  )), /permission denied/);
});

test("D1 charges only a successful available summary to its winning claimant", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  const b = "00000000-0000-0000-0000-00000000000b";

  await db.exec("delete from public.summary_usage; delete from public.summary_generation_claims");
  await assert.rejects(db.exec("insert into public.summary_usage (user_id, summary_key, billing_period, charged_minutes) values ('00000000-0000-0000-0000-00000000000a', 's1', current_date, 2)"));
  await db.exec(`insert into public.summary_generation_claims (summary_key, claimant_user_id, state)
    values ('s2', '${a}', 'failed')`);
  await assert.rejects(db.exec(`insert into public.summary_usage (user_id, summary_key, billing_period, charged_minutes) values ('${a}', 's2', current_date, 2)`));
  await db.exec(`insert into public.summary_generation_claims (summary_key, claimant_user_id, state, finished_at)
    values ('s1', '${a}', 'succeeded', now())`);
  await assert.rejects(db.exec(`insert into public.summary_usage (user_id, summary_key, billing_period, charged_minutes) values ('${b}', 's1', current_date, 2)`));
  await db.exec(`insert into public.summary_usage (user_id, summary_key, billing_period, charged_minutes) values ('${a}', 's1', current_date, 2)`);
  await assert.rejects(db.exec(`insert into public.summary_usage (user_id, summary_key, billing_period, charged_minutes) values ('${a}', 's1', current_date, 2)`));
});

test("service role can perform server-owned global and follow writes", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  await db.exec("set role service_role");
  await db.exec("update public.channels set title = 'Updated' where channel_uid = 'youtube-channel:UC1'");
  await db.exec("insert into public.follows (user_id, channel_uid) values ('00000000-0000-0000-0000-00000000000a', 'youtube-channel:UC1') on conflict do nothing");
  await db.exec("reset role");
  assert.equal((await db.query("select title from public.channels where channel_uid = 'youtube-channel:UC1'")).rows[0].title, "Updated");
  assert.equal((await db.query("select count(*)::int as n from public.follows where user_id = $1", [a])).rows[0].n, 1);
});

test("internal-test entitlements are callable only through the server role", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  await assert.rejects(asRole(db, "authenticated", a, () => db.query("select public.grant_internal_test_entitlement($1)", [a])));
  await db.exec("set role service_role");
  await db.query("select public.grant_internal_test_entitlement($1)", [a]);
  await db.exec("reset role");
  const entitlement = await db.query("select plan_code,status,follow_limit,generation_minutes_limit from public.entitlements where user_id = $1", [a]);
  assert.deepEqual(entitlement.rows[0], { plan_code: "internal_test", status: "active", follow_limit: 30, generation_minutes_limit: 600 });
});

test("follow-limit RPC is server-only, idempotent, and rejects the next follow", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  await db.exec("set role service_role");
  await db.exec("delete from public.follows where user_id = '00000000-0000-0000-0000-00000000000a'");
  await db.query("select public.grant_internal_test_entitlement($1, $2, $3)", [a, 1, 0]);
  await db.exec("insert into public.channels (channel_uid, native_channel_id, title, canonical_url) values ('youtube-channel:UC2', 'UC2', 'Second', 'https://youtube.com/channel/UC2')");
  const first = await db.query("select * from public.create_follow_with_limit($1, $2)", [a, "youtube-channel:UC1"]);
  const replay = await db.query("select * from public.create_follow_with_limit($1, $2)", [a, "youtube-channel:UC1"]);
  await db.exec("reset role");
  assert.equal(first.rows[0].created, true);
  assert.equal(replay.rows[0].created, false);
  await db.exec("set role service_role");
  await assert.rejects(db.query("select * from public.create_follow_with_limit($1, $2)", [a, "youtube-channel:UC2"]));
  await db.exec("reset role");
  await assert.rejects(asRole(db, "authenticated", a, () => db.query("select * from public.create_follow_with_limit($1, $2)", [a, "youtube-channel:UC2"])));
});

test("D4 feed RPC scopes to follows, pages by published_at and video_uid, and includes only available cached summaries", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  const b = "00000000-0000-0000-0000-00000000000b";
  await db.exec(`
    insert into public.channels (channel_uid, native_channel_id, title, canonical_url)
      values ('youtube-channel:UC2', 'UC2', 'Other channel', 'https://youtube.com/channel/UC2');
    insert into public.follows (user_id, channel_uid)
      values ('${b}', 'youtube-channel:UC2');
    insert into public.videos (video_uid, channel_uid, native_video_id, title, canonical_url, published_at)
      values
        ('youtube:aaaaaaaaaaa', 'youtube-channel:UC1', 'aaaaaaaaaaa', 'Tie A', 'https://youtube.com/watch?v=aaaaaaaaaaa', '2099-12-31T12:00:00Z'),
        ('youtube:bbbbbbbbbbb', 'youtube-channel:UC1', 'bbbbbbbbbbb', 'Tie B', 'https://youtube.com/watch?v=bbbbbbbbbbb', '2099-12-31T12:00:00Z'),
        ('youtube:ccccccccccc', 'youtube-channel:UC1', 'ccccccccccc', 'Older', 'https://youtube.com/watch?v=ccccccccccc', '2099-12-31T11:00:00Z'),
        ('youtube:ddddddddddd', 'youtube-channel:UC2', 'ddddddddddd', 'Other user only', 'https://youtube.com/watch?v=ddddddddddd', '2100-01-01T00:00:00Z');
    insert into public.summaries (summary_key, video_uid, spec_version, language, state, summary_id, summary_text, key_points, generated_at)
      values ('feed-summary', 'youtube:bbbbbbbbbbb', 'v1', 'en', 'available', 'provider-summary', 'Cached only', '["One point"]'::jsonb, '2099-12-31T13:00:00Z');
  `);

  const firstPage = await db.query(
    "select feed_item from public.read_feed_page($1, $2, $3, $4, $5)",
    [a, null, null, null, 2],
  );
  assert.deepEqual(firstPage.rows.map((row) => row.feed_item.video.video_uid), [
    "youtube:bbbbbbbbbbb",
    "youtube:aaaaaaaaaaa",
    "youtube:ccccccccccc",
  ]);
  assert.equal(firstPage.rows[0].feed_item.summary.state, "available");
  assert.equal(firstPage.rows[0].feed_item.summary.summary, "Cached only");
  assert.equal(firstPage.rows[1].feed_item.summary.state, "not_requested");
  assert.deepEqual(Object.keys(firstPage.rows[0].feed_item).sort(), ["channel", "summary", "video"]);

  const nextPage = await db.query(
    "select feed_item from public.read_feed_page($1, $2, $3, $4, $5)",
    [a, firstPage.rows[1].feed_item.video.published_at, firstPage.rows[1].feed_item.video.video_uid, null, 2],
  );
  assert.deepEqual(nextPage.rows.map((row) => row.feed_item.video.video_uid), ["youtube:ccccccccccc", "youtube:v1"]);

  const filtered = await db.query(
    "select feed_item from public.read_feed_page($1, $2, $3, $4, $5)",
    [a, null, null, "youtube-channel:UC1", 20],
  );
  assert.ok(filtered.rows.every((row) => row.feed_item.channel.channel_uid === "youtube-channel:UC1"));
  const notFollowed = await db.query(
    "select feed_item from public.read_feed_page($1, $2, $3, $4, $5)",
    [a, null, null, "youtube-channel:UC2", 20],
  );
  assert.deepEqual(notFollowed.rows, []);
  const emptyAccount = await db.query(
    "select feed_item from public.read_feed_page($1, $2, $3, $4, $5)",
    ["00000000-0000-0000-0000-00000000000c", null, null, null, 20],
  );
  assert.deepEqual(emptyAccount.rows, []);

  await assert.rejects(asRole(db, "authenticated", a, () => db.query(
    "select * from public.read_feed_page($1, $2, $3, $4, $5)", [a, null, null, null, 20],
  )));
  await assert.rejects(asRole(db, "anon", null, () => db.query(
    "select * from public.read_feed_page($1, $2, $3, $4, $5)", [a, null, null, null, 20],
  )));
});

test("D5 serializes global claims, charges only the successful winner, and reuses the cache", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  const b = "00000000-0000-0000-0000-00000000000b";
  const videoUid = "youtube:abcdefghijk";
  const key = `sha256:${"a".repeat(64)}`;
  await db.exec("delete from public.summary_usage; delete from public.summary_generation_claims; delete from public.summaries");
  await db.exec("set role service_role");
  await db.query("select public.grant_internal_test_entitlement($1, 30, 10)", [a]);
  await db.query("select public.grant_internal_test_entitlement($1, 30, 10)", [b]);
  await db.exec(`insert into public.videos (video_uid,channel_uid,native_video_id,title,canonical_url,published_at,duration_seconds,availability,live_status)
    values ('${videoUid}','youtube-channel:UC1','abcdefghijk','Eligible','https://youtube.com/watch?v=abcdefghijk',now(),121,'public','completed')`);
  const claimArgs = [a, videoUid, key, "v1", "primary", 3];
  const winner = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result", claimArgs);
  const loser = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result", [b, ...claimArgs.slice(1)]);
  assert.equal(winner.rows[0].result.state, "claimed");
  assert.equal(loser.rows[0].result.state, "generating");
  const done = await db.query(`select public.complete_summary_generation($1,$2,$3,$4,$5,$6,$7,$8) as saved`,
    [key, a, "provider-summary-1", "A useful summary.", ["Point one"], "en", "Media Monitor", "test-model"]);
  assert.equal(done.rows[0].saved, true);
  assert.equal((await db.query("select count(*)::int as n from public.summary_usage where user_id=$1", [a])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from public.summary_usage where user_id=$1", [b])).rows[0].n, 0);
  const cached = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result", [b, ...claimArgs.slice(1)]);
  assert.equal(cached.rows[0].result.state, "available");
  assert.equal(cached.rows[0].result.summary.summary_text, "A useful summary.");
});

test("D5 quota, eligibility, and failed attempts stop before provider ownership or remain free", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  await db.exec("delete from public.summary_usage; delete from public.summary_generation_claims; delete from public.summaries");
  await db.exec("set role service_role");
  await db.query("select public.grant_internal_test_entitlement($1, 30, 1)", [a]);
  await db.exec(`insert into public.videos (video_uid,channel_uid,native_video_id,title,canonical_url,published_at,duration_seconds,availability,live_status)
    values ('youtube:abcdefghijk','youtube-channel:UC1','abcdefghijk','Eligible','https://youtube.com/watch?v=abcdefghijk',now(),121,'public','completed'),
           ('youtube:lmnopqrstuv','youtube-channel:UC1','lmnopqrstuv','Live','https://youtube.com/watch?v=lmnopqrstuv',now(),300,'public','upcoming'),
           ('youtube:mnopqrstuvw','youtube-channel:UC1','mnopqrstuvw','Short','https://youtube.com/watch?v=mnopqrstuvw',now(),89,'public','completed'),
           ('youtube:ZYXWVUTSRQP','youtube-channel:UC1','ZYXWVUTSRQP','Long','https://youtube.com/watch?v=ZYXWVUTSRQP',now(),7201,'public','completed')`);
  const eligibilityFeed = await db.query("select feed_item from public.read_feed_page($1,$2,$3,$4,$5)",
    [a, null, null, null, 20]);
  const stateByVideo = Object.fromEntries(eligibilityFeed.rows.map((row) => [row.feed_item.video.video_uid, row.feed_item.summary.state]));
  assert.equal(stateByVideo["youtube:mnopqrstuvw"], "short_video");
  assert.equal(stateByVideo["youtube:ZYXWVUTSRQP"], "long_video");
  assert.equal(stateByVideo["youtube:lmnopqrstuv"], "live_or_upcoming");
  const overQuota = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:abcdefghijk", `sha256:${"b".repeat(64)}`, "v1", "primary", 3]);
  assert.equal(overQuota.rows[0].result.state, "quota_blocked");
  assert.equal((await db.query("select count(*)::int as n from public.summary_generation_claims")).rows[0].n, 0);
  const live = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:lmnopqrstuv", `sha256:${"c".repeat(64)}`, "v1", "primary", 5]);
  assert.equal(live.rows[0].result.state, "live_or_upcoming");
  await db.query("select public.grant_internal_test_entitlement($1, 30, 10)", [a]);
  const key = `sha256:${"d".repeat(64)}`;
  const failedClaim = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:abcdefghijk", key, "v1", "primary", 3]);
  assert.equal(failedClaim.rows[0].result.state, "claimed");
  await db.query("select public.fail_summary_generation($1,$2)", [key, a]);
  assert.equal((await db.query("select count(*)::int as n from public.summary_usage")).rows[0].n, 0);
  assert.equal((await db.query("select state from public.summaries where summary_key=$1", [key])).rows[0].state, "failed");
  await db.query("update public.summaries set retry_after=now() - interval '1 second' where summary_key=$1", [key]);
  const secondAttempt = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:abcdefghijk", key, "v1", "primary", 3]);
  assert.equal(secondAttempt.rows[0].result.state, "claimed");
  await db.query("select public.fail_summary_generation($1,$2)", [key, a]);
  await db.query("update public.summaries set retry_after=now() - interval '1 second' where summary_key=$1", [key]);
  const thirdAttempt = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:abcdefghijk", key, "v1", "primary", 3]);
  assert.equal(thirdAttempt.rows[0].result.state, "claimed");
  await db.query("select public.fail_summary_generation($1,$2)", [key, a]);
  await db.query("update public.summaries set retry_after=now() - interval '1 second' where summary_key=$1", [key]);
  const exhausted = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:abcdefghijk", key, "v1", "primary", 3]);
  assert.deepEqual(exhausted.rows[0].result, { state: "failed", retryable: false });
});

test("D5 reserves allowance atomically across different concurrent summaries", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "00000000-0000-0000-0000-00000000000a";
  await db.exec("delete from public.summary_usage; delete from public.summary_generation_claims; delete from public.summaries");
  await db.exec("set role service_role");
  await db.query("select public.grant_internal_test_entitlement($1, 30, 4)", [a]);
  await db.exec(`insert into public.videos (video_uid,channel_uid,native_video_id,title,canonical_url,published_at,duration_seconds,availability)
    values ('youtube:abcdefghijk','youtube-channel:UC1','abcdefghijk','One','https://youtube.com/watch?v=abcdefghijk',now(),121,'public'),
           ('youtube:lmnopqrstuv','youtube-channel:UC1','lmnopqrstuv','Two','https://youtube.com/watch?v=lmnopqrstuv',now(),121,'public')`);
  const firstKey = `sha256:${"e".repeat(64)}`;
  const secondKey = `sha256:${"f".repeat(64)}`;
  const first = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:abcdefghijk", firstKey, "v1", "primary", 3]);
  const second = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:lmnopqrstuv", secondKey, "v1", "primary", 2]);
  assert.equal(first.rows[0].result.state, "claimed");
  assert.equal(second.rows[0].result.state, "quota_blocked");
  await db.query("select public.fail_summary_generation($1,$2)", [firstKey, a]);
  const afterRelease = await db.query("select public.claim_summary_generation($1,$2,$3,$4,$5,$6) as result",
    [a, "youtube:lmnopqrstuv", secondKey, "v1", "primary", 2]);
  assert.equal(afterRelease.rows[0].result.state, "claimed");
});
