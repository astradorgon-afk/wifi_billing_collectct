"use client";

import { all, one, runBatch, type Row } from "./database";
import type { SqlValue } from "sql.js";
import { nowISO } from "../dates";
import { uid } from "./repository";
import { auditStatement } from "./audit";
import type { User, UserRole } from "../types";

/* Default accounts created on first run (change the PIN before use). */
const DEFAULT_USERS: Array<{ username: string; name: string; role: UserRole; pin: string }> = [
  { username: "owner", name: "Owner", role: "owner", pin: "1234" },
  { username: "collector", name: "Collector", role: "collector", pin: "0000" },
];

const PIN_SALT = "wifi-billing-pin-v1";
const PIN_MIN = 4;

/**
 * SHA-256 in pure JS, used when Web Crypto (crypto.subtle) is unavailable —
 * browsers only expose it in secure contexts, so LAN devices on plain HTTP
 * can't use SubtleCrypto. Produces the same lowercase hex as SHA-256, so
 * hashes computed here are interchangeable with the native path (a backup
 * seeded over one connection still verifies over the other).
 */
function sha256Hex(data: Uint8Array): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  const bitLenHi = Math.floor((data.length * 8) / 0x100000000) >>> 0;
  const bitLenLo = (data.length * 8) >>> 0;
  const rem = data.length % 64;
  const pad = (rem < 56 ? 56 - rem : 120 - rem) + 8;
  const msg = new Uint8Array(data.length + pad);
  msg.set(data);
  msg[data.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(msg.length - 8, bitLenHi);
  view.setUint32(msg.length - 4, bitLenLo);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < msg.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => (v >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/** SHA-256 hash of a PIN. Web Crypto is async, so seeding happens on demand. */
async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${PIN_SALT}:${pin}`);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Non-secure context (e.g. LAN on plain HTTP): fall back to pure JS.
  return sha256Hex(data);
}

export function validatePin(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return "PIN must contain only digits.";
  if (pin.length < PIN_MIN) return `PIN must be at least ${PIN_MIN} digits.`;
  if (/(.)\1{3,}/.test(pin)) return "PIN is too repetitive — use at least 3 distinct digits.";
  return null;
}

interface UserRow extends Row {
  id: string;
  username: string;
  name: string;
  role: string;
  pin_hash: string;
  active: number;
  must_change_pin: number;
  created_at: string;
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    name: r.name,
    role: r.role === "owner" ? "owner" : "collector",
    active: r.active === 1,
    must_change_pin: r.must_change_pin === 1,
    created_at: r.created_at,
  };
}

function isPin(r: UserRow | null): r is UserRow {
  return !!r;
}

/** Create the default owner + collector accounts if the users table is empty. */
export async function ensureDefaultUsers(): Promise<void> {
  const row = await one<Row>(`SELECT COUNT(*) AS n FROM users`);
  const n = Number(row?.n ?? 0);
  if (n > 0) return;

  const now = nowISO();
  const statements = [];
  for (const u of DEFAULT_USERS) {
    statements.push({
      sql: `INSERT OR IGNORE INTO users (id, username, name, role, pin_hash, active, must_change_pin, created_at, updated_at)
            VALUES (?,?,?,?,?,1,1,?,?)`,
      params: [uid(), u.username, u.name, u.role, await hashPin(u.pin), now, now],
    });
  }
  await runBatch(statements);
}

/** Verify credentials and return the user, or throw "invalid" (never reveals which part). */
export async function authenticate(username: string, pin: string): Promise<User> {
  const user = await one<UserRow>(
    `SELECT * FROM users WHERE username = ? AND active = 1`,
    [username.trim().toLowerCase()],
  );
  if (!user) throw new Error("Incorrect username or PIN.");
  const hash = await hashPin(pin);
  if (user.pin_hash !== hash) throw new Error("Incorrect username or PIN.");
  return toUser(user);
}

export async function listUsers(): Promise<User[]> {
  const rows = await all<UserRow>(`SELECT * FROM users ORDER BY created_at ASC`);
  return rows.map(toUser);
}

export async function getUserById(id: string): Promise<User | null> {
  const row = await one<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
  return row ? toUser(row) : null;
}

async function getUser(id: string): Promise<UserRow | null> {
  return one<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
}

/** Set a new PIN for a user (owner reset, or self-change after verifying current). */
export async function changePin(
  userId: string,
  newPin: string,
  currentPin?: string,
): Promise<void> {
  const err = validatePin(newPin);
  if (err) throw new Error(err);

  const user = await getUser(userId);
  if (!isPin(user)) throw new Error("User not found.");

  const params: SqlValue[] = [await hashPin(newPin)];
  if (currentPin !== undefined) {
    const current = await hashPin(currentPin);
    if (user.pin_hash !== current) throw new Error("Your current PIN is incorrect.");
  }
  params.push(userId);

  await runBatch(
    [
      {
        sql: `UPDATE users SET pin_hash=?, must_change_pin=0, updated_at=? WHERE id=?`,
        params: [params[0], nowISO(), params[1]],
      },
      auditStatement("user.pin_changed", "users", userId, null, null),
    ],
    { immediate: true },
  );
}

/** Owner creates a collector (or another owner) account. PIN is temporary. */
export async function createUser(input: {
  username: string;
  name: string;
  role: UserRole;
  pin: string;
}): Promise<void> {
  const err = validatePin(input.pin);
  if (err) throw new Error(err);

  const username = input.username.trim().toLowerCase();
  if (!username || !input.name.trim()) throw new Error("Username and name are required.");

  const exists = await one<Row>(`SELECT COUNT(*) AS n FROM users WHERE username = ?`, [username]);
  if (Number(exists?.n ?? 0) > 0) throw new Error("That username is already taken.");

  const id = uid();
  await runBatch(
    [
      {
        sql: `INSERT INTO users (id, username, name, role, pin_hash, active, must_change_pin, created_at, updated_at)
              VALUES (?,?,?,?,?,1,1,?,?)`,
        params: [id, username, input.name.trim(), input.role, await hashPin(input.pin), nowISO(), nowISO()],
      },
      auditStatement("user.created", "users", id, null, { username, name: input.name, role: input.role }),
    ],
    { immediate: true },
  );
}

/** Owner deactivates (or reactivates) a user without deleting their history. */
export async function setUserActive(userId: string, active: boolean): Promise<void> {
  await runBatch(
    [
      { sql: `UPDATE users SET active=?, updated_at=? WHERE id=?`, params: [active ? 1 : 0, nowISO(), userId] },
      auditStatement(active ? "user.activated" : "user.deactivated", "users", userId, { active: !active }, { active }),
    ],
    { immediate: true },
  );
}

/** Owner forces a PIN reset: user must set a new PIN at next sign-in. */
export async function resetUserPin(userId: string): Promise<void> {
  await runBatch(
    [
      { sql: `UPDATE users SET must_change_pin=1, updated_at=? WHERE id=?`, params: [nowISO(), userId] },
      auditStatement("user.pin_reset", "users", userId, null, { forced: true }),
    ],
    { immediate: true },
  );
}