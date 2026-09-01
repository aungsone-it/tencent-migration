import * as kv from "./kv_store.tsx";

export const ORDER_NUMBER_PREFIX = "NOS";
export const ORDER_SERIAL_COUNTER_KEY = "order_serial_counter";
const ORDER_SERIAL_RESERVATION_PREFIX = "order_serial_reservation:";

/** Format serial as NOS-00001, NOS-00002, NOS-100000, etc. */
export function formatSerialOrderNumber(serial: number, prefix = ORDER_NUMBER_PREFIX): string {
  const n = Math.max(1, Math.floor(Number(serial) || 0));
  const body = n < 100000 ? String(n).padStart(5, "0") : String(n);
  return `${prefix}-${body}`;
}

function parseSerialFromOrderNumber(value: unknown): number {
  const trimmed = String(value || "").trim();
  const match = trimmed.match(/^(?:NOS|MOS|ORD)-(\d+)$/i);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function scanMaxExistingSerial(): Promise<number> {
  let maxSerial = 0;
  try {
    const rows = await kv.getByPrefix("order:");
    for (const order of rows) {
      if (!order || typeof order !== "object") continue;
      const serial = parseSerialFromOrderNumber((order as Record<string, unknown>).orderNumber);
      if (serial > maxSerial) maxSerial = serial;
    }
  } catch {
    /* non-fatal — start from 0 */
  }
  return maxSerial;
}

async function ensureOrderSerialCounterInitialized(): Promise<number> {
  const stored = await kv.get(ORDER_SERIAL_COUNTER_KEY);
  const current = Number(stored);
  if (Number.isFinite(current) && current > 0) return current;

  const bootstrapped = await scanMaxExistingSerial();
  await kv.set(ORDER_SERIAL_COUNTER_KEY, bootstrapped);
  return bootstrapped;
}

/** Canonical order number before persisting (drops legacy MOS-/ORD- wrappers). */
export function canonicalizeOrderNumber(orderNumber: unknown): string {
  let raw = String(orderNumber || "").trim().replace(/^#/, "");
  if (!raw) return "";
  for (let pass = 0; pass < 3; pass++) {
    const stacked = raw.match(/^(?:ORD|MOS|NOS)-((?:NOS|MOS|ORD)-\d+)$/i);
    if (stacked) {
      raw = stacked[1];
      continue;
    }
    break;
  }
  const serialMatch = raw.match(/^(NOS|MOS|ORD)-(\d+)$/i);
  if (serialMatch) {
    return formatSerialOrderNumber(parseInt(serialMatch[2], 10));
  }
  return raw;
}

/** Advance the global counter when an explicit order number is used (e.g. KBZ precreate). */
export async function noteOrderNumberUsed(orderNumber: unknown): Promise<void> {
  const serial = parseSerialFromOrderNumber(orderNumber);
  if (serial <= 0) return;
  const current = await ensureOrderSerialCounterInitialized();
  if (serial > current) {
    await kv.set(ORDER_SERIAL_COUNTER_KEY, serial);
  }
}

/** Allocate the next serial order number (NOS-00001, NOS-00002, …). */
export async function allocateNextOrderNumber(): Promise<string> {
  await ensureOrderSerialCounterInitialized();

  for (let attempt = 0; attempt < 25; attempt++) {
    const current = Number(await kv.get(ORDER_SERIAL_COUNTER_KEY)) || 0;
    const nextSerial = current + 1;
    const orderNumber = formatSerialOrderNumber(nextSerial);

    const reserved = await kv.setIfAbsent(`${ORDER_SERIAL_RESERVATION_PREFIX}${orderNumber}`, {
      reservedAt: new Date().toISOString(),
    });
    if (!reserved) {
      await kv.set(ORDER_SERIAL_COUNTER_KEY, nextSerial);
      continue;
    }

    await kv.set(ORDER_SERIAL_COUNTER_KEY, nextSerial);
    return orderNumber;
  }

  throw new Error("Could not allocate order number");
}
