import * as kv from "./kv_store.tsx";

export const ORDER_NUMBER_PREFIX = "NOS";
export const ORDER_SERIAL_COUNTER_KEY = "order_serial_counter";
const ORDER_SERIAL_RESERVATION_PREFIX = "order_serial_reservation:";
export const ORDER_SERIAL_REJECTED_PREFIX = "order_serial_rejected:";

/** Only reuse serials abandoned on/after this instant — leaves pre-existing listing gaps untouched. */
export const ORDER_SERIAL_REUSE_CUTOFF_MS = Date.parse("2026-09-08T00:00:00.000+06:30");

function parseIsoMs(value: unknown): number {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

async function abandonmentTimestampMs(orderNumber: string): Promise<number> {
  const reservation = await kv.get(`${ORDER_SERIAL_RESERVATION_PREFIX}${orderNumber}`);
  if (reservation && typeof reservation === "object") {
    const reservedMs = parseIsoMs((reservation as { reservedAt?: unknown }).reservedAt);
    if (!Number.isNaN(reservedMs)) return reservedMs;
  }

  const txn = (await kv.get(`kpay_txn:${orderNumber}`)) as Record<string, unknown> | null;
  if (txn && typeof txn === "object") {
    const txnMs = Math.max(parseIsoMs(txn.updatedAt), parseIsoMs(txn.createdAt));
    if (!Number.isNaN(txnMs)) return txnMs;
  }

  const draft = await kv.get(`kpay_pwa_draft:${orderNumber}`);
  if (draft && typeof draft === "object") {
    const draftMs = parseIsoMs((draft as { savedAt?: unknown }).savedAt);
    if (!Number.isNaN(draftMs)) return draftMs;
  }

  return NaN;
}

/** True when abandonment happened on/after the reuse cutoff (legacy burned serials stay frozen). */
async function isEligibleForReuseSinceCutoff(orderNumber: string): Promise<boolean> {
  const abandonedMs = await abandonmentTimestampMs(orderNumber);
  if (Number.isNaN(abandonedMs)) return false;
  return abandonedMs >= ORDER_SERIAL_REUSE_CUTOFF_MS;
}

/** Format serial as NOS-00001, NOS-00002, NOS-100000, etc. */
export function formatSerialOrderNumber(serial: number, prefix = ORDER_NUMBER_PREFIX): string {
  const n = Math.max(1, Math.floor(Number(serial) || 0));
  const body = n < 100000 ? String(n).padStart(5, "0") : String(n);
  return `${prefix}-${body}`;
}

export function parseSerialFromOrderNumber(value: unknown): number {
  const trimmed = String(value || "").trim().replace(/^#/, "");
  const match = trimmed.match(/(?:NOS|MOS|ORD)-(\d+)$/i);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function compareOrdersBySerial(
  a: { orderNumber?: unknown; createdAt?: unknown; date?: unknown; id?: unknown },
  b: { orderNumber?: unknown; createdAt?: unknown; date?: unknown; id?: unknown },
  direction: "newest" | "oldest" = "newest",
): number {
  const serialA = parseSerialFromOrderNumber(a.orderNumber);
  const serialB = parseSerialFromOrderNumber(b.orderNumber);
  if (serialA !== serialB) {
    return direction === "oldest" ? serialA - serialB : serialB - serialA;
  }
  const dateA = new Date(String(a.createdAt || a.date || 0)).getTime() || 0;
  const dateB = new Date(String(b.createdAt || b.date || 0)).getTime() || 0;
  if (dateA !== dateB) {
    return direction === "oldest" ? dateA - dateB : dateB - dateA;
  }
  return String(a.id || "").localeCompare(String(b.id || ""));
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

function kpayTxnIsPaid(txn: Record<string, unknown> | null | undefined): boolean {
  if (!txn || typeof txn !== "object") return false;
  const status = String(txn.status || "").trim().toLowerCase();
  return status === "paid" || status === "refunded";
}

/** Admin rejected this serial — permanent gap in the listing. */
export async function isOrderNumberAdminRejected(orderNumber: unknown): Promise<boolean> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) return false;
  return Boolean(await kv.get(`${ORDER_SERIAL_REJECTED_PREFIX}${num}`));
}

/** True when the serial can be assigned again (unpaid abandon, failed checkout, etc.). */
export async function isOrderNumberReusable(orderNumber: unknown): Promise<boolean> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) return false;
  if (await isOrderNumberAdminRejected(num)) return false;

  const mapped = await kv.get(`order_num:${num}`);
  if (mapped) return false;

  const txn = (await kv.get(`kpay_txn:${num}`)) as Record<string, unknown> | null;
  if (kpayTxnIsPaid(txn)) return false;

  if (!(await isEligibleForReuseSinceCutoff(num))) return false;

  return true;
}

/** Lowest unused serial (fills gaps). Paid drafts stay blocked until recover/reject. */
async function findLowestReusableOrderNumber(): Promise<string | null> {
  const counter = await ensureOrderSerialCounterInitialized();
  for (let serial = 1; serial <= counter; serial++) {
    const orderNumber = formatSerialOrderNumber(serial);
    if (await isOrderNumberReusable(orderNumber)) {
      return orderNumber;
    }
  }
  return null;
}

async function reserveOrderNumber(orderNumber: string, reused = false): Promise<void> {
  await kv.set(`${ORDER_SERIAL_RESERVATION_PREFIX}${orderNumber}`, {
    reservedAt: new Date().toISOString(),
    ...(reused ? { reused: true } : {}),
  });
}

/** Drop stale KBZ session keys before reusing an abandoned serial. */
async function prepareOrderNumberForReuse(orderNumber: string): Promise<void> {
  await kv.del(`kpay_txn:${orderNumber}`);
  await kv.del(`kpay_pwa_draft:${orderNumber}`);
  await reserveOrderNumber(orderNumber, true);
}

/** Admin rejects a paid KBZ draft — only intentional way to leave a gap in the serial list. */
export async function rejectOrderDraft(orderNumber: unknown): Promise<{ ok: boolean; error?: string; message?: string }> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) {
    return { ok: false, error: "invalid_order_number", message: "Invalid order number" };
  }

  if (await kv.get(`order_num:${num}`)) {
    return { ok: false, error: "order_already_exists", message: "Order already registered" };
  }

  const txn = (await kv.get(`kpay_txn:${num}`)) as Record<string, unknown> | null;
  if (!txn && !(await kv.get(`kpay_pwa_draft:${num}`))) {
    return { ok: false, error: "draft_not_found", message: "No KBZPay draft found for this order number" };
  }

  await kv.set(`${ORDER_SERIAL_REJECTED_PREFIX}${num}`, {
    rejectedAt: new Date().toISOString(),
  });
  await kv.del(`${ORDER_SERIAL_RESERVATION_PREFIX}${num}`);
  await kv.del(`kpay_txn:${num}`);
  await kv.del(`kpay_pwa_draft:${num}`);

  return { ok: true };
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

export async function consumeOrderNumberReservation(orderNumber: unknown): Promise<void> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) return;
  await kv.del(`${ORDER_SERIAL_RESERVATION_PREFIX}${num}`).catch(() => undefined);
}

/** Allocate the next serial order number (NOS-00001, NOS-00002, …). Reuses today's abandoned unpaid serials only. */
export async function allocateNextOrderNumber(): Promise<string> {
  await ensureOrderSerialCounterInitialized();

  const reused = await findLowestReusableOrderNumber();
  if (reused) {
    await prepareOrderNumberForReuse(reused);
    return reused;
  }

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

/** Prefer the serial reservation time so COD / QR / PWA share allocation order. */
export async function resolveAllocatedOrderCreatedAt(
  orderNumber: unknown,
  fallback?: unknown,
): Promise<string> {
  const fallbackIso = String(fallback || "").trim();
  const num = canonicalizeOrderNumber(orderNumber);
  if (num) {
    try {
      const reservation = await kv.get(`${ORDER_SERIAL_RESERVATION_PREFIX}${num}`);
      const reservedAt = String(
        reservation && typeof reservation === "object"
          ? (reservation as { reservedAt?: unknown }).reservedAt
          : "",
      ).trim();
      const reservedMs = reservedAt ? new Date(reservedAt).getTime() : NaN;
      if (!Number.isNaN(reservedMs)) {
        const fallbackMs = fallbackIso ? new Date(fallbackIso).getTime() : NaN;
        if (Number.isNaN(fallbackMs) || reservedMs <= fallbackMs) return reservedAt;
      }
    } catch {
      /* non-fatal */
    }
  }
  if (fallbackIso && !Number.isNaN(new Date(fallbackIso).getTime())) return fallbackIso;
  return new Date().toISOString();
}
