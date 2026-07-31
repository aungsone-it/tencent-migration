import * as kv from "./kv_store.tsx";
import { withTimeout } from "./helpers.tsx";
import { queueOrderReadModelSync } from "./read_model.ts";

const MYANMAR_PHONE_RE = /^(\+959|09)\d{9}$/;

/** Normalize Myanmar phone to +959XXXXXXXXX for exact-match comparison. */
export function normalizeMyanmarPhone(raw: string): string | null {
  const normalized = String(raw || "").replace(/[\s\-]/g, "");
  if (!MYANMAR_PHONE_RE.test(normalized)) return null;
  if (normalized.startsWith("09")) return `+95${normalized.slice(1)}`;
  return normalized;
}

function isGuestOrder(order: Record<string, unknown>): boolean {
  const uid = order.userId ?? order.customerId;
  if (uid == null) return true;
  const s = String(uid).trim();
  return s === "" || s === "null" || s === "undefined";
}

function orderPhoneNormalized(order: Record<string, unknown>): string | null {
  const shipping =
    order.shipping && typeof order.shipping === "object"
      ? (order.shipping as Record<string, unknown>)
      : null;
  const raw =
    order.phone ??
    order.shippingPhone ??
    shipping?.phone ??
    null;
  return normalizeMyanmarPhone(String(raw || ""));
}

/** True when order has no owner and its phone exactly matches (after normalization). */
export function guestOrderMatchesPhone(
  order: Record<string, unknown>,
  normalizedPhone: string,
): boolean {
  if (!isGuestOrder(order)) return false;
  const orderPhone = orderPhoneNormalized(order);
  return Boolean(orderPhone && orderPhone === normalizedPhone);
}

/**
 * Attach prior guest checkout orders to a newly registered / logged-in customer.
 * Only orders with userId unset and an exact normalized phone match are updated.
 */
export async function linkGuestOrdersToUser(
  userId: string,
  normalizedPhone: string,
): Promise<number> {
  const uid = String(userId || "").trim();
  const phone = normalizeMyanmarPhone(normalizedPhone);
  if (!uid || !phone) return 0;

  const rows = await withTimeout(kv.getByPrefixWithKeys("order:"), 30000);
  let linked = 0;

  for (const { key, value } of rows) {
    if (!key.startsWith("order:") || key.startsWith("order_num:")) continue;
    if (!value || typeof value !== "object") continue;

    const order = value as Record<string, unknown>;
    if (!guestOrderMatchesPhone(order, phone)) continue;

    const orderId = String(order.id || key.slice("order:".length)).trim();
    const updated: Record<string, unknown> = {
      ...order,
      userId: uid,
      updatedAt: new Date().toISOString(),
    };
    if (order.customer && typeof order.customer === "object") {
      updated.customer = {
        ...(order.customer as Record<string, unknown>),
        userId: uid,
      };
    }

    await withTimeout(kv.set(key, updated), 5000);
    queueOrderReadModelSync(orderId, updated);
    linked += 1;
  }

  if (linked > 0) {
    console.log(`🔗 Linked ${linked} guest order(s) to user ${uid} by phone ${phone}`);
  }
  return linked;
}

/** Resolve a customer's normalized phone from KV auth / customer records. */
export async function resolveCustomerPhoneByUserId(userId: string): Promise<string | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  const authRec = await withTimeout(kv.get(`customer_auth:${uid}`), 5000).catch(() => null);
  if (authRec && typeof authRec === "object" && (authRec as { phone?: string }).phone) {
    const p = normalizeMyanmarPhone(String((authRec as { phone: string }).phone));
    if (p) return p;
  }

  const customers = await withTimeout(kv.getByPrefix("customer:"), 30000).catch(() => []);
  if (Array.isArray(customers)) {
    for (const c of customers) {
      if (!c || typeof c !== "object") continue;
      if (String((c as { userId?: string }).userId || "").trim() !== uid) continue;
      const p = normalizeMyanmarPhone(String((c as { phone?: string }).phone || ""));
      if (p) return p;
    }
  }
  return null;
}

/** Whether an order belongs in a user's history via exact phone match (guest or owned). */
export function orderMatchesUserPhone(
  order: Record<string, unknown>,
  userId: string,
  normalizedPhone: string,
): boolean {
  const orderPhone = orderPhoneNormalized(order);
  if (!orderPhone || orderPhone !== normalizedPhone) return false;

  const orderUserId = String(order.userId ?? order.customerId ?? "").trim();
  return !orderUserId || orderUserId === userId;
}
