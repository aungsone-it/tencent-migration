import * as kv from "./kv_store.tsx";

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function resolveVendorIdFromSlugOrId(vendorIdOrSlug: string): Promise<string> {
  const raw = text(vendorIdOrSlug, 160);
  if (!raw) return "";
  const slugRow = (await kv.get(`vendor_slug_${raw}`).catch(() => null)) as
    | { vendorId?: unknown }
    | null;
  const slugVendorId = text(slugRow?.vendorId, 160);
  if (slugVendorId) return slugVendorId;
  const direct = (await kv.get(`vendor:${raw}`).catch(() => null)) as { id?: unknown } | null;
  const directId = text(direct?.id, 160);
  if (directId) return directId;
  return raw;
}

export async function deleteVendorSubscriberRecords(
  vendorIdOrSlug: string,
  customerId?: string,
): Promise<{ deleted: number; keys: string[] }> {
  const vendorId = await resolveVendorIdFromSlugOrId(vendorIdOrSlug);
  if (!vendorId) return { deleted: 0, keys: [] };

  let subscriptionKeys: string[] = [];
  const prefix = `customer_subscription:${vendorId}:`;
  if (customerId) {
    const exactKey = `${prefix}${customerId}`;
    const row = await kv.get(exactKey);
    if (row) {
      subscriptionKeys = [exactKey];
    } else {
      const rows = await kv.getByPrefixWithKeys(prefix);
      subscriptionKeys = rows
        .filter(({ value }) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return false;
          return text((value as Record<string, unknown>).customerId, 160) === customerId;
        })
        .map(({ key }) => key);
    }
  } else {
    const rows = await kv.getByPrefixWithKeys(prefix);
    subscriptionKeys = rows.map((row) => row.key);
  }

  const targetCustomerIds = customerId
    ? new Set([customerId])
    : new Set(
        subscriptionKeys
          .map((key) => key.slice(prefix.length))
          .filter(Boolean),
      );

  const keysToDelete = new Set<string>(subscriptionKeys);
  const paymentRows = await kv.getByPrefixWithKeys("subscription_payment:");
  for (const { key, value } of paymentRows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const payment = value as Record<string, unknown>;
    if (text(payment.vendorId, 160) !== vendorId) continue;
    if (!targetCustomerIds.has(text(payment.customerId, 160))) continue;
    keysToDelete.add(key);
    const merchantOrderId = text(payment.merchantOrderId, 120);
    if (merchantOrderId) keysToDelete.add(`kpay_txn:${merchantOrderId}`);
  }

  const keys = [...keysToDelete];
  if (keys.length > 0) await kv.mdel(keys);
  return { deleted: keys.length, keys };
}

export { resolveVendorIdFromSlugOrId };
