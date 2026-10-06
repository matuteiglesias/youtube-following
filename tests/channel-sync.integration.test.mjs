import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";

const migrations = [
  "202610050001_d1_product_schema.sql",
  "202610050002_d3_follow_lifecycle.sql",
  "202610050003_d4_feed.sql",
  "202610050004_d5_summary_engine.sql",
  "202610050005_d7_billing.sql",
  "202610050006_d8_demo_feed.sql",
  "202610060001_d6_channel_sync.sql",
  "202610060002_daily_digest.sql",
].map((name) => new URL(`../supabase/migrations/${name}`, import.meta.url));

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
  for (const migration of migrations) {
    await db.exec(await readFile(migration, "utf8"));
  }
  return db;
}

async function asRole(db, role, sql) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    return await sql();
  } finally {
    await db.exec("rollback");
  }
}

test("D6 claim RPC globally deduplicates followed channels, leases atomically, and recovers expired leases", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const a = "00000000-0000-0000-0000-00000000000a";
  const b = "00000000-0000-0000-0000-00000000000b";
  await db.exec(`
    insert into auth.users (id, email) values
      ('${a}', 'a@example.test'),
      ('${b}', 'b@example.test');

    insert into public.channels
      (channel_uid, native_channel_id, title, canonical_url, next_feed_check_at)
    values
      ('youtube-channel:UCshared', 'UCshared', 'Shared', 'https://youtube.com/channel/UCshared', now() - interval '1 hour'),
      ('youtube-channel:UCfuture', 'UCfuture', 'Future', 'https://youtube.com/channel/UCfuture', now() + interval '1 hour'),
      ('youtube-channel:UCunfollowed', 'UCunfollowed', 'Unfollowed', 'https://youtube.com/channel/UCunfollowed', now() - interval '1 hour');

    insert into public.follows (user_id, channel_uid) values
      ('${a}', 'youtube-channel:UCshared'),
      ('${b}', 'youtube-channel:UCshared'),
      ('${a}', 'youtube-channel:UCfuture');
  `);

  await db.exec("set role service_role");
  const first = await db.query("select * from public.claim_due_channels($1,$2)", [25, 300]);
  const duringLease = await db.query("select * from public.claim_due_channels($1,$2)", [25, 300]);
  const dueCount = await db.query("select public.count_due_channels()::int as n");
  await db.exec("reset role");

  assert.deepEqual(first.rows.map((row) => row.channel_uid), ["youtube-channel:UCshared"]);
  assert.equal(first.rows[0].sync_claim_until instanceof Date || typeof first.rows[0].sync_claim_until === "string", true);
  assert.deepEqual(duringLease.rows, []);
  assert.equal(dueCount.rows[0].n, 0);

  await db.exec("update public.channels set sync_claim_until = now() - interval '1 second' where channel_uid = 'youtube-channel:UCshared'");
  await db.exec("set role service_role");
  const reclaimed = await db.query("select * from public.claim_due_channels($1,$2)", [25, 300]);
  await db.exec("reset role");
  assert.deepEqual(reclaimed.rows.map((row) => row.channel_uid), ["youtube-channel:UCshared"]);
});

test("D6 claim/count RPCs are service-role only and enforce bounded inputs", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  await assert.rejects(asRole(db, "authenticated", () => db.query("select * from public.claim_due_channels(25,300)")));
  await assert.rejects(asRole(db, "anon", () => db.query("select public.count_due_channels()")));

  await db.exec("set role service_role");
  await assert.rejects(db.query("select * from public.claim_due_channels(26,300)"));
  await assert.rejects(db.query("select * from public.claim_due_channels(25,10)"));
  await db.exec("reset role");
});
