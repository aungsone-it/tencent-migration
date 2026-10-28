import type { Context } from "hono";
import * as kv from "./kv_store.tsx";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type StaffSessionRecord = {
  userId: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readStaffSessionToken(c: Context): string {
  return text(c.req.header("x-staff-session"));
}

/** Issue a server-side session token after successful staff login. */
export async function issueStaffSessionToken(
  userId: string,
  email: string,
  role: string,
): Promise<string> {
  const id = text(userId);
  const mail = text(email).toLowerCase();
  if (!id) {
    throw new Error("userId is required for staff session issuance");
  }

  const previous = (await kv.get(`staff_session_active:${id}`)) as { token?: string } | null;
  if (previous?.token) {
    await kv.del(`staff_session:${previous.token}`).catch(() => undefined);
  }

  const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const record: StaffSessionRecord = {
    userId: id,
    email: mail,
    role: text(role),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };

  await kv.set(`staff_session:${token}`, record);
  await kv.set(`staff_session_active:${id}`, { token, ...record });
  return token;
}

export async function revokeStaffSession(userId: string): Promise<void> {
  const id = text(userId);
  if (!id) return;
  const active = (await kv.get(`staff_session_active:${id}`)) as { token?: string } | null;
  if (active?.token) {
    await kv.del(`staff_session:${active.token}`).catch(() => undefined);
  }
  await kv.del(`staff_session_active:${id}`).catch(() => undefined);
}

export async function resolveStaffSession(
  c: Context,
): Promise<StaffSessionRecord | null> {
  const token = readStaffSessionToken(c);
  if (!token) return null;

  const session = (await kv.get(`staff_session:${token}`)) as StaffSessionRecord | null;
  if (!session || !text(session.userId)) return null;

  const expiresAtMs = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    await kv.del(`staff_session:${token}`).catch(() => undefined);
    return null;
  }

  return session;
}

/** Returns a JSON Response when the caller has no valid staff session. */
export async function assertStaffSession(
  c: Context,
  opts?: { userId?: string },
): Promise<Response | undefined> {
  const session = await resolveStaffSession(c);
  if (!session) {
    return c.json({ error: "Staff login required. Please sign in again." }, 401);
  }

  const expectedUserId = text(opts?.userId);
  if (expectedUserId && text(session.userId) !== expectedUserId) {
    return c.json({ error: "Staff session does not match the requested account." }, 403);
  }

  return undefined;
}
