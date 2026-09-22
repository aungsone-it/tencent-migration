import * as kv from "./kv_store.tsx";

export const ORDER_NUMBER_PREFIX = "NOS";
export const ORDER_SERIAL_COUNTER_KEY = "order_serial_counter";
const ORDER_SERIAL_RESERVATION_PREFIX = "order_serial_reservation:";
export const ORDER_SERIAL_REJECTED_PREFIX = "order_serial_rejected:";

/** Do not reuse gap serials below this — legacy pre-895 abandons stay retired. */
export const ORDER_SERIAL_GAP_REUSE_FLOOR = 895;

/**
 * @deprecated Legacy cutoff — unpaid abandons are always eligible for reuse now.
 * Kept exported so older deploy notes / scripts do not break on import.
 */
export const ORDER_SERIAL_REUSE_CUTOFF_MS = Date.parse("2026-09-08T00:00:00.000+06:30");

/** Unpaid KBZ txn/draft still considered in-flight for this long (bare reservations reuse immediately). */
export const ORDER_SERIAL_CHECKOUT_ACTIVE_MS = 15 * 60 * 1000;

function parseIsoMs(value: unknown): number {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

function kpayTxnIsPaid(txn: Record<string, unknown> | null | undefined): boolean {
  if (!txn || typeof txn !== "object") return false;
  const status = String(txn.status || "").trim().toLowerCase();
  return status === "paid" || status === "refunded";
}

async function hasAllocationArtifacts(orderNumber: string): Promise<boolean> {
  const reservation = await kv.get(`${ORDER_SERIAL_RESERVATION_PREFIX}${orderNumber}`);
  if (reservation) return true;
  const txn = await kv.get(`kpay_txn:${orderNumber}`);
  if (txn) return true;
  const draft = await kv.get(`kpay_pwa_draft:${orderNumber}`);
  if (draft) return true;
  return false;
}

/** True when an order row still exists for this serial (cleans stale order_num mappings). */
async function hasPersistedOrder(orderNumber: string): Promise<boolean> {
  const mapped = await kv.get(`order_num:${orderNumber}`);
  if (typeof mapped !== "string" || !mapped.trim()) return false;
  const order = await kv.get(`order:${mapped.trim()}`);
  if (order && typeof order === "object") return true;
  await kv.del(`order_num:${orderNumber}`).catch(() => undefined);
  return false;
}

/**
 * Blocks reuse while a KBZ payment session may still be in progress.
 * A bare reservation (no txn/draft yet) is not active — those are abandoned pre-KBZ serials.
 */
async function unpaidKpaySessionActive(orderNumber: string): Promise<boolean> {
  const txn = (await kv.get(`kpay_txn:${orderNumber}`)) as Record<string, unknown> | null;
  if (txn && typeof txn === "object" && !kpayTxnIsPaid(txn)) {
    const txnMs = Math.max(parseIsoMs(txn.updatedAt), parseIsoMs(txn.createdAt));
    if (!Number.isNaN(txnMs) && Date.now() - txnMs < ORDER_SERIAL_CHECKOUT_ACTIVE_MS) {
      return true;
    }
  }

  const draft = await kv.get(`kpay_pwa_draft:${orderNumber}`);
  if (draft && typeof draft === "object") {
    const draftMs = parseIsoMs((draft as { savedAt?: unknown }).savedAt);
    if (!Number.isNaN(draftMs) && Date.now() - draftMs < ORDER_SERIAL_CHECKOUT_ACTIVE_MS) {
      return true;
    }
  }

  return false;
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

/** UTC calendar day (YYYY-MM-DD) for admin order lists — matches Orders table Date column. */
export function resolveOrderListCalendarDate(order: {
  createdAt?: unknown;
  date?: unknown;
}): string {
  const raw = String(order.createdAt || order.date || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  const dayMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return dayMatch ? dayMatch[1] : "";
}

/** True when an order's list calendar day falls within yyyy-MM-dd bounds (inclusive). */
export function orderMatchesAdminDateRange(
  order: { createdAt?: unknown; date?: unknown },
  dateFrom: string,
  dateTo: string,
): boolean {
  const day = resolveOrderListCalendarDate(order);
  if (!day) return !dateFrom && !dateTo;
  if (dateFrom && day < dateFrom) return false;
  if (dateTo && day > dateTo) return false;
  return true;
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
  const effective = Math.max(bootstrapped, ORDER_SERIAL_GAP_REUSE_FLOOR - 1);
  await kv.set(ORDER_SERIAL_COUNTER_KEY, effective);
  return effective;
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

/** Admin rejected this serial — permanent gap in the listing. */
export async function isOrderNumberAdminRejected(orderNumber: unknown): Promise<boolean> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) return false;
  return Boolean(await kv.get(`${ORDER_SERIAL_REJECTED_PREFIX}${num}`));
}

/**
 * True when the serial can be assigned again.
 * Permanent gaps are only allowed for admin-rejected or paid KBZ drafts (orphan recovery).
 */
export async function isOrderNumberReusable(orderNumber: unknown): Promise<boolean> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) return false;
  const serial = parseSerialFromOrderNumber(num);
  if (serial > 0 && serial < ORDER_SERIAL_GAP_REUSE_FLOOR) return false;
  if (await isOrderNumberAdminRejected(num)) return false;
  if (await hasPersistedOrder(num)) return false;

  const txn = (await kv.get(`kpay_txn:${num}`)) as Record<string, unknown> | null;
  if (kpayTxnIsPaid(txn)) return false;

  if (!(await hasAllocationArtifacts(num))) return false;

  // Stale unpaid KBZ session — reuse for the same checkout retry; in-flight — wait until timeout.
  if (await unpaidKpaySessionActive(num)) return false;

  return true;
}

/** Keep counter aligned with persisted orders and in-flight reservations (no backward jumps). */
async function syncOrderSerialCounter(): Promise<number> {
  await ensureOrderSerialCounterInitialized();
  const maxFromOrders = await scanMaxExistingSerial();
  let maxFromAllocations = maxFromOrders;
  const scanPrefixes = [
    ORDER_SERIAL_RESERVATION_PREFIX,
    "kpay_txn:",
    "kpay_pwa_draft:",
  ];
  try {
    for (const prefix of scanPrefixes) {
      const rows = await kv.getByPrefixWithKeys(prefix);
      for (const row of rows) {
        const suffix = String(row.key || "").slice(prefix.length);
        const serial = parseSerialFromOrderNumber(suffix);
        if (serial > maxFromAllocations) maxFromAllocations = serial;
      }
    }
  } catch {
    /* non-fatal */
  }
  const current = Number(await kv.get(ORDER_SERIAL_COUNTER_KEY)) || 0;
  const synced = Math.max(
    current,
    maxFromOrders,
    maxFromAllocations,
    ORDER_SERIAL_GAP_REUSE_FLOOR - 1,
  );
  if (synced !== current) {
    await kv.set(ORDER_SERIAL_COUNTER_KEY, synced);
  }
  return synced;
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

  if (await hasPersistedOrder(num)) {
    return { ok: false, error: "order_already_exists", message: "Order already registered" };
  }

  const txn = (await kv.get(`kpay_txn:${num}`)) as Record<string, unknown> | null;
  if (!txn && !(await kv.get(`kpay_pwa_draft:${num}`))) {
    return { ok: false, error: "draft_not_found", message: "No KBZPay draft found for this order number" };
  }
  if (!kpayTxnIsPaid(txn)) {
    return {
      ok: false,
      error: "draft_not_paid",
      message: "Only paid KBZ drafts can be rejected — unpaid sessions are reused automatically",
    };
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
  const current = await syncOrderSerialCounter();
  if (serial > current) {
    await kv.set(ORDER_SERIAL_COUNTER_KEY, serial);
  }
}

export async function consumeOrderNumberReservation(orderNumber: unknown): Promise<void> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) return;
  await kv.del(`${ORDER_SERIAL_RESERVATION_PREFIX}${num}`).catch(() => undefined);
}

/** Ensure a client-supplied serial has an active reservation before order create. */
export async function touchOrderNumberReservation(orderNumber: unknown): Promise<void> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) return;
  const existing = await kv.get(`${ORDER_SERIAL_RESERVATION_PREFIX}${num}`);
  if (existing) return;
  // Only refresh reservations for the same in-flight checkout — never resurrect old gap serials.
  if ((await hasAllocationArtifacts(num)) && (await isOrderNumberReusable(num))) {
    await reserveOrderNumber(num, true);
  }
}

/** Guard explicit order numbers on POST /orders — blocks rejected serials and paid KBZ orphans used as COD. */
export async function ensureOrderNumberAssignableForCreate(
  orderNumber: unknown,
  opts?: { paymentMethod?: unknown; paymentStatus?: unknown },
): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  const num = canonicalizeOrderNumber(orderNumber);
  if (!num) {
    return { ok: false, error: "invalid_order_number", message: "Invalid order number" };
  }
  const serial = parseSerialFromOrderNumber(num);
  if (
    serial > 0 &&
    serial < ORDER_SERIAL_GAP_REUSE_FLOOR &&
    !(await hasPersistedOrder(num))
  ) {
    const txn = (await kv.get(`kpay_txn:${num}`)) as Record<string, unknown> | null;
    if (!kpayTxnIsPaid(txn)) {
      return {
        ok: false,
        error: "order_number_retired",
        message: `Order numbers below NOS-${String(ORDER_SERIAL_GAP_REUSE_FLOOR).padStart(5, "0")} are no longer assigned`,
      };
    }
  }
  if (await isOrderNumberAdminRejected(num)) {
    return {
      ok: false,
      error: "order_number_rejected",
      message: "This order number was rejected and cannot be reused",
    };
  }

  const current = await syncOrderSerialCounter();
  const inFlight = await hasAllocationArtifacts(num);
  if (serial > 0 && !(await hasPersistedOrder(num))) {
    if (serial > current + 1 && !inFlight) {
      return {
        ok: false,
        error: "order_number_out_of_sequence",
        message: `Next order number must follow NOS-${String(Math.max(current + 1, ORDER_SERIAL_GAP_REUSE_FLOOR)).padStart(5, "0")}`,
      };
    }
    if (serial < current + 1 && !inFlight) {
      return {
        ok: false,
        error: "order_number_retired",
        message: `Order numbers below NOS-${String(current + 1).padStart(5, "0")} are no longer assigned`,
      };
    }
  }

  const txn = (await kv.get(`kpay_txn:${num}`)) as Record<string, unknown> | null;
  if (kpayTxnIsPaid(txn) && !(await hasPersistedOrder(num))) {
    const paymentStatus = String(opts?.paymentStatus || "").trim().toLowerCase();
    const paymentMethod = String(opts?.paymentMethod || "").trim().toLowerCase();
    const isKpayPaidCreate =
      paymentStatus === "paid" &&
      (paymentMethod.includes("kpay") || paymentMethod.includes("kbz"));
    if (!isKpayPaidCreate) {
      return {
        ok: false,
        error: "paid_draft_pending_recovery",
        message:
          "This order number has a paid KBZ payment awaiting recovery — use Recover order in admin Orders",
      };
    }
  }

  return { ok: true };
}

/**
 * Allocate the next serial strictly in sequence (NOS-00895, NOS-00896, …).
 * No gap backfill — only the immediate next serial; stale in-flight checkout retries reuse the same id.
 */
export async function allocateNextOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const current = await syncOrderSerialCounter();
    const nextSerial = Math.max(current + 1, ORDER_SERIAL_GAP_REUSE_FLOOR);
    const orderNumber = formatSerialOrderNumber(nextSerial);

    const reserved = await kv.setIfAbsent(`${ORDER_SERIAL_RESERVATION_PREFIX}${orderNumber}`, {
      reservedAt: new Date().toISOString(),
    });
    if (!reserved) {
      // Same checkout retry — reclaim stale reservation instead of jumping ahead.
      if (await isOrderNumberReusable(orderNumber)) {
        await prepareOrderNumberForReuse(orderNumber);
        await kv.set(ORDER_SERIAL_COUNTER_KEY, nextSerial);
        return orderNumber;
      }
      // Blocked (admin-rejected / active KBZ) — advance past this serial only.
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
