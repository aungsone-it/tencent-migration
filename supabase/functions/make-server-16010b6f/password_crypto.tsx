/** PBKDF2-SHA256 password storage for legacy KV users (not Supabase Auth). */

import crypto from "node:crypto";

const ITERATIONS = 100_000;
const PREFIX = "pbkdf2_sha256";

function b64urlEncode(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export async function hashPasswordPlain(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(plain, salt, ITERATIONS, 32, "sha256");
  return `${PREFIX}$${ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Returns true if stored value is our PBKDF2 format. */
export function isPasswordHashFormat(stored: unknown): boolean {
  return typeof stored === "string" && stored.startsWith(`${PREFIX}$`);
}

/**
 * Verify plain against stored hash OR legacy plaintext (migrate on success).
 * On legacy match, caller should replace `password` with `passwordHash` from hashPasswordPlain.
 */
export async function verifyPasswordPlain(plain: string, stored: unknown): Promise<boolean> {
  if (typeof stored !== "string" || !stored) return false;
  if (!isPasswordHashFormat(stored)) {
    return timingSafeEqual(stored, plain);
  }
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iter = Number(parts[1]);
  if (!Number.isFinite(iter) || iter < 10_000) return false;
  const salt = b64urlDecode(parts[2]!);
  const expectedHash = b64urlDecode(parts[3]!);
  const got = crypto.pbkdf2Sync(plain, salt, iter, expectedHash.length, "sha256");
  if (got.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(got, expectedHash);
}
