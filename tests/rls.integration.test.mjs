import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/202610050001_d1_product_schema.sql", import.meta.url);
const d3MigrationUrl = new URL("../supabase/migrations/202610050002_d3_follow_lifecycle.sql", import.meta.url);

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
