import type { Context } from "hono";
import * as kv from "./kv_store.tsx";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type VendorSessionRecord = {
  vendorId: string;
  email: string;
  createdAt: string;
  expiresAt: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readVendorSessionToken(c: Context): string {
  return text(c.req.header("x-vendor-session"));
}

/** Issue a server-side session token after successful vendor login. */
export async function issueVendorSessionToken(vendorId: string, email: string): Promise<string> {
  const id = text(vendorId);
  const mail = text(email).toLowerCase();
  if (!id || !mail) {
    throw new Error("vendorId and email are required for session issuance");
  }

  const previous = (await kv.get(`vendor_session_active:${id}`)) as { token?: string } | null;
  if (previous?.token) {
    await kv.del(`vendor_session:${previous.token}`).catch(() => undefined);
  }

  const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const record: VendorSessionRecord = {
    vendorId: id,
    email: mail,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };

  await kv.set(`vendor_session:${token}`, record);
  await kv.set(`vendor_session_active:${id}`, { token, ...record });
  return token;
}

export async function revokeVendorSession(vendorId: string): Promise<void> {
  const id = text(vendorId);
  if (!id) return;
  const active = (await kv.get(`vendor_session_active:${id}`)) as { token?: string } | null;
  if (active?.token) {
    await kv.del(`vendor_session:${active.token}`).catch(() => undefined);
  }
  await kv.del(`vendor_session_active:${id}`).catch(() => undefined);
}

/** Returns a JSON Response when the caller is not authorized for this vendor. */
export async function assertVendorSession(c: Context, vendorId: string): Promise<Response | undefined> {
  const allowLegacy = text(Deno.env.get("ALLOW_UNAUTHENTICATED_VENDOR_WITHDRAW")) === "1";
  if (allowLegacy) {
    console.warn("[security] ALLOW_UNAUTHENTICATED_VENDOR_WITHDRAW=1 — vendor session bypass enabled");
    return undefined;
  }

  const expectedVendorId = text(vendorId);
  if (!expectedVendorId) {
    return c.json({ error: "vendorId is required" }, 400);
  }

  const token = readVendorSessionToken(c);
  if (!token) {
    return c.json({ error: "Vendor login required. Please sign in again." }, 401);
  }

  const session = (await kv.get(`vendor_session:${token}`)) as VendorSessionRecord | null;
  if (!session || text(session.vendorId) !== expectedVendorId) {
    return c.json({ error: "Invalid vendor session. Please sign in again." }, 401);
  }

  const expiresAtMs = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    await kv.del(`vendor_session:${token}`).catch(() => undefined);
    return c.json({ error: "Vendor session expired. Please sign in again." }, 401);
  }

  return undefined;
}
