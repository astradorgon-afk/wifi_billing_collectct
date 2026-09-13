# Session Status — wifi-billing

Last updated: 2026-09-13

## Goal

Connect the offline-first WiFi Billing PWA to Supabase so the PC and phone
share one dataset. User-decided requirements:

- **Public access** — no login; the client uses only the anon (publishable) key.
- **Two-way auto-sync** — every write syncs automatically whenever online.

## Architecture decisions

- `next.config.ts` uses `output: "export"` → the app is a static build; there is
  no server. The browser talks to Supabase directly with the anon key + RLS.
- **LWW sync**: each synced row carries `updated_at`; the writer's timestamp is
  authoritative. The server does NOT re-stamp `updated_at` and discards any
  UPDATE older than the stored row (`maintain_updated_at` trigger), so an
  out-of-order push from an offline device can't clobber a newer change.
- **Deletes**: hard deletes are recorded in a local `sync_tombstones` table and
  pushed up as soft-deletes (`deleted_at`), then propagated to other devices.
- **Local-only data**: `users` (PIN hashes), `audit_log`, and the `meta` table
  never sync.

## Work completed

### Bug fixes (earlier in session)
- `changePin` "column index out of range": removed a stray `nowISO()` param in
  `src/lib/db/users.ts`.
- Pill-nav alignment / PIN-hash SHA-256 fallback (no `crypto.subtle` on plain
  HTTP) from earlier sessions.

### Supabase integration
1. **Setup**: installed `@supabase/supabase-js`; created `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — gitignored).
2. **`supabase/schema.sql`** — six synced tables (plans, customers,
   installations, invoices, payments, requests) + `device_metadata`:
   - money columns as `double precision`;
   - `maintain_updated_at()`: stale-upsert guard + null-timestamp stamping;
   - RLS enabled with `to anon` policies (public access);
   - `public.users` and `public.audit_log` intentionally **not** created
     (PIN hashes must never be anon-readable); rerun drops any stale copies.
3. **Local DB migration v4** (`src/lib/db/schema.ts`, `SCHEMA_VERSION = 4`):
   adds `updated_at` to the six tables + `users`, backfills from
   `created_at`/`requested_at`, creates `sync_tombstones`.
4. **Instrumentation**:
   - `src/lib/db/repository.ts` — `updated_at` on every write;
     `deleteCustomer` also writes a tombstone.
   - `src/lib/db/users.ts` — `updated_at` on user writes.
   - `src/lib/db/database.ts` — `onMutate`/`fireMutation` hooks called from
     `run()` and `runBatch()`.
5. **`src/lib/supabase.ts`** — anon-key client singleton + helpers.
6. **`src/lib/sync.ts`** — reconcile engine (see "How sync works").
7. **`src/providers/DataProvider.tsx`** — calls `initSync()` on mount,
   subscribes to sync state, exposes `syncState` / `syncEnabled()` / `syncNow()`
   on context, re-queries after each successful sync.
8. **Settings** (`src/app/settings/page.tsx`) — "Online sync (Supabase)" card:
   project ref, last-sync time, last error, "Sync now", pause/resume toggle;
   About text updated (data now mirrors to Supabase when sync is on).
9. **`SyncState`** added to `src/lib/types.ts`.

## How sync works (src/lib/sync.ts)

- Per-table full reconcile (pull full remote set, compare every row's
  `updated_at`, push the newer side; applied locally with
  `ON CONFLICT(id) DO UPDATE ... WHERE excluded.updated_at >= local.updated_at`).
- Push uses `.upsert(..., { onConflict: "id" })`; remote soft-deletes arrive as
  local deletes; tombstoned (locally-deleted) rows are excluded from pulls to
  prevent resurrection.
- Triggers: debounced ~1.5s after any mutation, on load, and on
  `visibilitychange`; sync ON by default when configured (meta key
  `sync.enabled`), togglable in Settings.
- Removed remote `users`/`audit_log` from the schema (security) and dropped the
  FKs that referenced them.

## Verification

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — clean (all 12 routes prerendered)
- `git check-ignore .env.local` — ignored; no secrets in the repo

## Git

- `8057637` "Add offline-first wifi billing PWA with Supabase schema" pushed to
  `origin/main` (`astradorgon-afk/wifi_billing_collectct`).
- Current uncommitted work: the Supabase integration files above
  (package.json + lockfile, schema.sql, db/schema.ts, database.ts,
  repository.ts, users.ts, types.ts, supabase.ts, sync.ts, DataProvider.tsx,
  settings/page.tsx).

## User TODO (manual steps)

1. **Run the schema**: Supabase Dashboard → SQL Editor → paste `supabase/schema.sql` → Run.
2. **Restart the dev server** (`npm run dev`) after rebuilding — this is a
   static export, so env and code changes need a fresh build. Also hard-refresh
   the phone.
3. **Rotate leaked keys**: the service-role JWT and `sb_secret_...` key were
   pasted earlier in chat; they bypass RLS. Revoke/rotate both in
   Supabase Dashboard → Settings → API Keys.
4. **Smoke test**: change something on the PC, then on the phone (after reload)
   and confirm it appears both ways; also try Settings → Sync now.

## Known limitations / caveats

- **ID collisions**: two devices both offline creating a new row with the same
  auto id would clobber each other on sync. Low risk (random-ish ids); true fix
  is UUIDs (major refactor).
- **Clock skew**: LWW trusts device timestamps; devices with very skewed clocks
  could order edits wrongly.
- **Public access**: anyone holding the anon key (shipped in app code) can read
  all billing data. Acceptable for a single-owner household app; if stricter
  access is wanted, move to Supabase Auth + `to authenticated` policies.