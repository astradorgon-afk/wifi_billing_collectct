"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for the online sync layer.
 * Uses only the PUBLIC anon (publishable) key + Row Level Security. Secrets
 * (service-role / sb_secret) must never be added here — they bypass RLS.
 *
 * These env values are inlined by Next.js from `.env.local` at build time
 * (NEXT_PUBLIC_* prefix), which is also why a rebuild is required after
 * changing them.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

let client: SupabaseClient | null = null;

/** Returns a configured client, or null when Supabase isn't set up. */
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function supabaseProjectRef(): string | null {
  const m = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
  return m ? m[1] : null;
}