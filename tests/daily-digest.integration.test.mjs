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

test("R3 projection is Follow-scoped, half-open, stable, cached-only, bounded, and service-role-only", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const a = "00000000-0000-0000-0000-00000000000a";
  const b = "00000000-0000-0000-0000-00000000000b";
  const start = "2026-10-06T00:00:00Z";
  const end = "2026-10-07T00:00:00Z";

  await db.exec(`
    insert into auth.users (id, email) values
      ('${a}', 'a@example.test'),
      ('${b}', 'b@example.test');

    insert into public.channels (channel_uid, native_channel_id, handle, title, canonical_url) values
      ('youtube-channel:UCshared', 'UCshared', '@shared', 'Shared', 'https://youtube.com/@shared'),
      ('youtube-channel:UConlya', 'UConlya', '@onlya', 'Only A', 'https://youtube.com/@onlya'),
      ('youtube-channel:UConlyb', 'UConlyb', '@onlyb', 'Only B', 'https://youtube.com/@onlyb'),
      ('youtube-channel:UCunfollowed', 'UCunfollowed', '@unfollowed', 'Unfollowed', 'https://youtube.com/@unfollowed');

    insert into public.follows (user_id, channel_uid) values
      ('${a}', 'youtube-channel:UCshared'),
      ('${a}', 'youtube-channel:UConlya'),
      ('${b}', 'youtube-channel:UCshared'),
      ('${b}', 'youtube-channel:UConlyb');

    insert into public.videos
      (video_uid, channel_uid, native_video_id, title, canonical_url, published_at, duration_seconds, availability, live_status)
    values
      ('youtube:before00000', 'youtube-channel:UCshared', 'before00000', 'Before', 'https://youtube.com/watch?v=before00000', '2026-10-05T23:59:59.999Z', 120, 'public', 'completed'),
      ('youtube:start000000', 'youtube-channel:UCshared', 'start000000', 'At start', 'https://youtube.com/watch?v=start000000', '2026-10-06T00:00:00Z', 121, 'public', 'completed'),
      ('youtube:tieaaaaaaaa', 'youtube-channel:UCshared', 'tieaaaaaaaa', 'Tie A', 'https://youtube.com/watch?v=tieaaaaaaaa', '2026-10-06T12:00:00Z', 122, 'public', 'completed'),
      ('youtube:tiezzzzzzzz', 'youtube-channel:UCshared', 'tiezzzzzzzz', 'Tie Z', 'https://youtube.com/watch?v=tiezzzzzzzz', '2026-10-06T12:00:00Z', 123, 'public', 'completed'),
      ('youtube:onlya000000', 'youtube-channel:UConlya', 'onlya000000', 'Only A', 'https://youtube.com/watch?v=onlya000000', '2026-10-06T10:00:00Z', 124, 'public', 'completed'),
      ('youtube:onlyb000000', 'youtube-channel:UConlyb', 'onlyb000000', 'Only B', 'https://youtube.com/watch?v=onlyb000000', '2026-10-06T11:00:00Z', 125, 'public', 'completed'),
      ('youtube:unfollow000', 'youtube-channel:UCunfollowed', 'unfollow000', 'Unfollowed', 'https://youtube.com/watch?v=unfollow000', '2026-10-06T09:00:00Z', 126, 'public', 'completed'),
      ('youtube:end0000000', 'youtube-channel:UCshared', 'end0000000', 'At end', 'https://youtube.com/watch?v=end0000000', '2026-10-07T00:00:00Z', 127, 'public', 'completed');

    insert into public.summaries
      (summary_key, video_uid, spec_version, language, state, summary_id, summary_text, key_points, generated_at)
    values
      ('old-summary', 'youtube:tiezzzzzzzz', 'v0', 'en', 'available', 'old', 'Older cached summary.', '["Old point"]'::jsonb, '2026-10-06T12:30:00Z'),
      ('new-summary', 'youtube:tiezzzzzzzz', 'v1', 'en', 'available', 'new', 'Newest cached summary.', '["New point"]'::jsonb, '2026-10-06T13:00:00Z');
  `);

  await db.exec("set role service_role");
  const aRows = await db.query(
    "select feed_item from public.read_daily_digest($1,$2,$3,$4)",
    [a, start, end, 100],
  );
  const bRows = await db.query(
    "select feed_item from public.read_daily_digest($1,$2,$3,$4)",
    [b, start, end, 100],
  );
  await db.exec("reset role");

  assert.deepEqual(aRows.rows.map((row) => row.feed_item.video.video_uid), [
    "youtube:tiezzzzzzzz",
    "youtube:tieaaaaaaaa",
    "youtube:onlya000000",
    "youtube:start000000",
  ]);
  assert.deepEqual(bRows.rows.map((row) => row.feed_item.video.video_uid), [
    "youtube:tiezzzzzzzz",
    "youtube:tieaaaaaaaa",
    "youtube:onlyb000000",
    "youtube:start000000",
  ]);
  assert.equal(aRows.rows[0].feed_item.summary.state, "available");
  assert.equal(aRows.rows[0].feed_item.summary.summary, "Newest cached summary.");
  assert.equal(aRows.rows.at(-1).feed_item.summary.state, "not_requested");
  assert.deepEqual(Object.keys(aRows.rows[0].feed_item).sort(), ["channel", "summary", "video"]);
  assert.equal("provider" in aRows.rows[0].feed_item.summary, false);
  assert.equal("model" in aRows.rows[0].feed_item.summary, false);

  await db.exec("set role service_role");
  const empty = await db.query(
    "select feed_item from public.read_daily_digest($1,$2,$3,$4)",
    [a, "2026-10-08T00:00:00Z", "2026-10-09T00:00:00Z", 100],
  );
  const truncated = await db.query(
    "select feed_item from public.read_daily_digest($1,$2,$3,$4)",
    [a, start, end, 2],
  );
  await db.exec("reset role");
  assert.deepEqual(empty.rows, []);
  assert.equal(truncated.rows.length, 3);

  await db.exec("set role service_role");
  await assert.rejects(db.query(
    "select * from public.read_daily_digest($1,$2,$3,$4)",
    [a, start, "2026-10-14T00:00:00.001Z", 100],
  ));
  await assert.rejects(db.query(
    "select * from public.read_daily_digest($1,$2,$3,$4)",
    [a, start, end, 101],
  ));
  await db.exec("reset role");

  await assert.rejects(asRole(db, "authenticated", a, () => db.query(
    "select * from public.read_daily_digest($1,$2,$3,$4)",
    [a, start, end, 100],
  )));
  await assert.rejects(asRole(db, "anon", null, () => db.query(
    "select * from public.read_daily_digest($1,$2,$3,$4)",
    [a, start, end, 100],
  )));
});
