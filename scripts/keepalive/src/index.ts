/**
 * Supabase Free-Tier Keep-Alive Ping
 *
 * Prevents the free-tier project from auto-pausing after 7 days of inactivity
 * by executing a trivial `SELECT 1` (via the `public.ping()` RPC) on a cron
 * schedule. Intended to be run by a serverless cron (Render, GitHub Actions,
 * etc.) so it works even when your laptop/phone are switched off.
 *
 * Runs once and exits 0 on success / 1 on failure. No server is started.
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env (local) ` +
        "or set it in the platform dashboard (Render/Vercel/GitHub).",
    );
  }
  return value;
}

async function pingOnce(client: SupabaseClient): Promise<number> {
  const started = Date.now();
  const { data, error } = await client.rpc("ping");
  if (error) {
    throw new Error(error.message);
  }
  if ((data as unknown) !== 1) {
    throw new Error(`Unexpected ping result: ${String(data)}`);
  }
  return Date.now() - started;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const url = required("SUPABASE_URL");
  const anonKey = required("SUPABASE_ANON_KEY");

  // No auth session is needed: the anon (publishable) key is enough for the
  // public.ping() RPC. persistSession:false also keeps the client lean and
  // avoids writing anything to disk.
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "wifi-billing-keepalive/1.0.0" },
    },
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const ms = await pingOnce(client);
      console.log(
        `[keepalive] ping ok (attempt ${attempt}/${RETRIES}) in ${ms}ms ` +
          `at ${new Date().toISOString()}`,
      );
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `[keepalive] ping attempt ${attempt}/${RETRIES} failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt < RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError ?? new Error("ping failed");
}

main().catch((err) => {
  console.error(
    `[keepalive] fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});