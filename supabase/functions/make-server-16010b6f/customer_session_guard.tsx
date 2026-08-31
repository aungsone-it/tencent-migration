import type { Context } from "hono";
import * as kv from "./kv_store.tsx";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CustomerSessionRecord = {
  userId: string;
  createdAt: string;
  expiresAt: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readCustomerSessionToken(c: Context): string {
  return text(c.req.header("x-customer-session"));
}

export async function issueCustomerSessionToken(userId: string): Promise<string> {
  const id = text(userId);
  if (!id) throw new Error("userId is required for customer session issuance");

  const previous = (await kv.get(`customer_session_active:${id}`)) as { token?: string } | null;
  if (previous?.token) {
    await kv.del(`customer_session:${previous.token}`).catch(() => undefined);
  }

  const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const record: CustomerSessionRecord = {
    userId: id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };

  await kv.set(`customer_session:${token}`, record);
  await kv.set(`customer_session_active:${id}`, { token, ...record });
  return token;
}

export async function revokeCustomerSession(userId: string): Promise<void> {
  const id = text(userId);
  if (!id) return;
  const active = (await kv.get(`customer_session_active:${id}`)) as { token?: string } | null;
  if (active?.token) {
    await kv.del(`customer_session:${active.token}`).catch(() => undefined);
  }
  await kv.del(`customer_session_active:${id}`).catch(() => undefined);
}

/** Returns a JSON Response when the caller is not the storefront customer for this userId. */
export async function assertCustomerSession(c: Context, userId: string): Promise<Response | undefined> {
  const expectedUserId = text(userId);
  if (!expectedUserId) {
    return c.json({ error: "userId is required" }, 400);
  }

  const token = readCustomerSessionToken(c);
  if (!token) {
    return c.json({ error: "Sign in required to update this profile." }, 401);
  }

  const session = (await kv.get(`customer_session:${token}`)) as CustomerSessionRecord | null;
  if (!session || text(session.userId) !== expectedUserId) {
    return c.json({ error: "Invalid customer session. Please sign in again." }, 401);
  }

  const expiresAtMs = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    await kv.del(`customer_session:${token}`).catch(() => undefined);
    return c.json({ error: "Customer session expired. Please sign in again." }, 401);
  }

  return undefined;
}
