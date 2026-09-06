/**
 * KBZ safety net: find paid checkouts (PWA + QR) without storefront orders and finalize them.
 * Design: ONLY successful KBZPay payments that never became a registered order.
 */
import type { Context } from "hono";
import * as kv from "./kv_store.tsx";
import {
  finalizePwaCheckoutOrder,
  getPwaCheckoutDraft,
  type PwaCheckoutDraftRecord,
} from "./pwa_finalize.ts";

export const PWA_DRAFT_KEY_PREFIX = "kpay_pwa_draft:";

export type OrphanedPwaDraftRow = {
  merchantOrderId: string;
  savedAt: string;
  prepayId?: string;
  vendor?: string;
  vendorId?: string;
  total?: number;
  customer?: string;
  email?: string;
  itemCount?: number;
  txnStatus?: string;
  hasOrder: boolean;
  canRecover: boolean;
};

export type PwaReconcileResult = {
  scanned: number;
  finalized: number;
  skippedNoPayment: number;
  failed: Array<{ merchantOrderId: string; error: string; message?: string }>;
  recovered: Array<{ merchantOrderId: string; orderNumber?: string }>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Cart snapshot lives on the PWA draft and is also copied onto kpay_txn at start. */
function resolveCheckoutSnapshot(
  draft: PwaCheckoutDraftRecord | null | undefined,
  txn: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  return asRecord(draft?.draftOrder) || asRecord(txn?.draftOrder);
}

function snapshotCustomer(draftOrder: Record<string, unknown> | undefined): string {
  const ship = asRecord(draftOrder?.shippingInfo);
  return (
    text(draftOrder?.customerName) ||
    text(ship?.fullName) ||
    text(draftOrder?.customer) ||
    ""
  );
}

function snapshotEmail(draftOrder: Record<string, unknown> | undefined): string {
  const ship = asRecord(draftOrder?.shippingInfo);
  return text(draftOrder?.email) || text(ship?.email) || "";
}

function snapshotVendorFields(
  draftOrder: Record<string, unknown> | undefined,
): { vendor: string; vendorId: string } {
  if (!draftOrder) return { vendor: "", vendorId: "" };
  let vendor = text(draftOrder.vendor);
  let vendorId = text(draftOrder.vendorId) || vendor;
  if (vendor || vendorId) return { vendor, vendorId };
  if (Array.isArray(draftOrder.items)) {
    for (const raw of draftOrder.items) {
      const item = asRecord(raw);
      if (!item) continue;
      vendor = text(item.vendor);
      vendorId = text(item.vendorId) || vendor;
      if (vendor || vendorId) return { vendor, vendorId };
    }
  }
  return { vendor: "", vendorId: "" };
}

function hasCheckoutSnapshot(
  draft: PwaCheckoutDraftRecord | null | undefined,
  txn: Record<string, unknown> | null | undefined,
): boolean {
  const snapshot = resolveCheckoutSnapshot(draft, txn);
  if (!snapshot || typeof snapshot !== "object") return false;
  return Object.keys(snapshot).length > 0;
}

function hasMeaningfulCheckoutSnapshot(
  draftOrder: Record<string, unknown> | undefined,
): boolean {
  if (!draftOrder || typeof draftOrder !== "object") return false;
  if (snapshotCustomer(draftOrder)) return true;
  if (snapshotEmail(draftOrder)) return true;
  const { vendor, vendorId } = snapshotVendorFields(draftOrder);
  if (vendor || vendorId) return true;
  if (Array.isArray(draftOrder.items) && draftOrder.items.length > 0) return true;
  return false;
}

function snapshotItemCount(draftOrder: Record<string, unknown> | undefined): number | undefined {
  if (!Array.isArray(draftOrder?.items) || draftOrder.items.length === 0) return undefined;
  return draftOrder.items.length;
}

function parseDraftAgeMs(savedAt: string): number {
  const ms = Date.parse(savedAt);
  return Number.isFinite(ms) ? ms : 0;
}

function orderIdLookupVariants(id: string): string[] {
  const trimmed = text(id).toUpperCase();
  if (!trimmed) return [];
  const match = trimmed.match(/^(ORD|MOS|NOS)-(.+)$/);
  if (!match) return [trimmed];
  const code = match[2];
  return [`ORD-${code}`, `MOS-${code}`, `NOS-${code}`];
}

function merchantOrderIdVariants(id: string): string[] {
  return [...new Set([text(id), ...orderIdLookupVariants(text(id))].filter(Boolean))];
}

/** True when a live storefront order exists for this merchant order id. */
export async function storefrontOrderExists(merchantOrderId: string): Promise<boolean> {
  for (const id of merchantOrderIdVariants(merchantOrderId)) {
    const mappedId = text(await kv.get(`order_num:${id}`));
    if (!mappedId) continue;
    const order = (await kv.get(`order:${mappedId}`)) as unknown;
    if (order && typeof order === "object") return true;
  }
  return false;
}

function isKpayQrTxn(txn: Record<string, unknown> | null | undefined): boolean {
  if (!txn || typeof txn !== "object") return false;
  const method = text(txn.method).toLowerCase();
  const tradeType = text(txn.tradeType).toUpperCase();
  return method === "qr" || tradeType === "PAY_BY_QRCODE";
}

function isKpayPwaTxn(txn: Record<string, unknown> | null | undefined): boolean {
  if (!txn || typeof txn !== "object") return false;
  const method = text(txn.method).toLowerCase();
  const tradeType = text(txn.tradeType).toUpperCase();
  return method === "pwa" || tradeType === "PWAAPP" || Boolean(text(txn.prepayId));
}

/** Paid KBZ checkout eligible for orphan listing when any checkout snapshot exists. */
function isRecoverableOrphanTxn(
  txn: Record<string, unknown> | null | undefined,
  draft: PwaCheckoutDraftRecord | null | undefined,
): boolean {
  if (!hasCheckoutSnapshot(draft, txn)) return false;
  if (!txn || typeof txn !== "object") return true;
  if (isKpayQrTxn(txn) || isKpayPwaTxn(txn)) return true;
  return Boolean(draft?.draftOrder);
}

function isPaidOrphanScanCandidate(txn: Record<string, unknown> | null | undefined): boolean {
  if (!txn || typeof txn !== "object") return false;
  if (hasCheckoutSnapshot(undefined, txn)) {
    if (isKpayQrTxn(txn) || isKpayPwaTxn(txn)) return true;
  }
  return false;
}

/** @deprecated alias — use isKpayPwaTxn for PWA-only webhook paths */
function isRecoverablePwaTxn(txn: Record<string, unknown> | null | undefined): boolean {
  return isKpayPwaTxn(txn);
}

function vendorLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function draftMatchesVendorFilter(
  draftOrder: Record<string, unknown> | undefined,
  vendorFilter: string,
): boolean {
  const filter = vendorFilter.trim().toLowerCase();
  if (!filter) return true;
  const vendor = text(draftOrder?.vendor).toLowerCase();
  const vendorId = text(draftOrder?.vendorId).toLowerCase();
  const filterKey = vendorLookupKey(filter);
  const vendorKey = vendorLookupKey(vendor);
  const vendorIdKey = vendorLookupKey(vendorId);
  return (
    vendor === filter ||
    vendorId === filter ||
    vendor.includes(filter) ||
    vendorId.includes(filter) ||
    (filterKey.length > 0 &&
      (vendorKey === filterKey ||
        vendorIdKey === filterKey ||
        vendorKey.includes(filterKey) ||
        vendorIdKey.includes(filterKey)))
  );
}

function buildOrphanRowFromSnapshot(params: {
  merchantOrderId: string;
  draft: PwaCheckoutDraftRecord | null | undefined;
  txn: Record<string, unknown> | null | undefined;
  txnStatus: string;
}): OrphanedPwaDraftRow {
  const { merchantOrderId, draft, txn, txnStatus } = params;
  const draftOrder = resolveCheckoutSnapshot(draft, txn);
  const totalRaw = Number(draftOrder?.total ?? txn?.amount ?? NaN);
  const { vendor, vendorId } = snapshotVendorFields(draftOrder);
  return {
    merchantOrderId,
    savedAt:
      text(draft?.savedAt) ||
      text(txn?.paidAt) ||
      text(txn?.updatedAt) ||
      text(txn?.createdAt),
    prepayId: text(draft?.prepayId) || text(txn?.prepayId) || undefined,
    vendor: vendor || undefined,
    vendorId: vendorId || undefined,
    total: Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : undefined,
    customer: snapshotCustomer(draftOrder) || undefined,
    email: snapshotEmail(draftOrder) || undefined,
    itemCount: snapshotItemCount(draftOrder),
    txnStatus: txnStatus || "pending",
    hasOrder: false,
    canRecover: hasMeaningfulCheckoutSnapshot(draftOrder),
  };
}

async function loadTxnForMerchantOrderId(
  merchantOrderId: string,
): Promise<Record<string, unknown> | null> {
  for (const id of merchantOrderIdVariants(merchantOrderId)) {
    const txn = (await kv.get(`kpay_txn:${id}`)) as Record<string, unknown> | null;
    if (txn && typeof txn === "object") return txn;
  }
  return null;
}

async function collectCandidateMerchantOrderIds(options: {
  exactId?: string;
  limit: number;
}): Promise<string[]> {
  const ids = new Set<string>();

  if (options.exactId) {
    for (const id of merchantOrderIdVariants(options.exactId)) ids.add(id);
    return [...ids];
  }

  const draftRows = await kv
    .getByPrefixWithKeys(`${PWA_DRAFT_KEY_PREFIX}NOS-`)
    .catch(() => []);
  for (const row of draftRows) {
    if (!row?.key?.startsWith(PWA_DRAFT_KEY_PREFIX)) continue;
    ids.add(row.key.slice(PWA_DRAFT_KEY_PREFIX.length));
  }

  const txnRows = await kv.getByPrefixWithKeys("kpay_txn:NOS-").catch(() => []);
  const txnCandidates: Array<{ id: string; ms: number }> = [];
  for (const row of txnRows) {
    if (!row?.key?.startsWith("kpay_txn:")) continue;
    const id = row.key.slice("kpay_txn:".length);
    const txn = row.value as Record<string, unknown> | null;
    if (!isPaidOrphanScanCandidate(txn)) continue;
    const status = text(txn?.status).toLowerCase();
    if (status !== "paid" && status !== "pending") continue;
    txnCandidates.push({
      id,
      ms: parseDraftAgeMs(
        text(txn?.paidAt) || text(txn?.updatedAt) || text(txn?.createdAt),
      ),
    });
  }
  txnCandidates.sort((a, b) => b.ms - a.ms);
  for (const candidate of txnCandidates.slice(0, options.limit * 3)) {
    ids.add(candidate.id);
  }

  return [...ids];
}

async function evaluateOrphanCandidate(
  merchantOrderId: string,
  options: {
    minAgeMs: number;
    now: number;
    vendorFilter: string;
    exactId?: string;
    exactIdVariants: string[];
    syncStatus?: (merchantOrderId: string) => Promise<unknown>;
    synced: { count: number };
    maxSync: number;
  },
): Promise<OrphanedPwaDraftRow | null> {
  const id = text(merchantOrderId);
  if (!id) return null;
  if (options.exactId && !options.exactIdVariants.includes(id.toUpperCase())) return null;

  if (await storefrontOrderExists(id)) return null;

  const draft = await getPwaCheckoutDraft(id);
  let txn = await loadTxnForMerchantOrderId(id);

  if (!isRecoverableOrphanTxn(txn, draft)) return null;

  const savedAt =
    text(draft?.savedAt) ||
    text(txn?.paidAt) ||
    text(txn?.updatedAt) ||
    text(txn?.createdAt);
  const savedMs = parseDraftAgeMs(savedAt);
  if (!options.exactId && savedMs && options.now - savedMs < options.minAgeMs) return null;

  let txnStatus = text(txn?.status).toLowerCase();
  const recentEnough = !savedMs || options.now - savedMs < 7 * 24 * 60 * 60 * 1000;
  if (
    options.syncStatus &&
    options.synced.count < options.maxSync &&
    txnStatus !== "paid" &&
    txnStatus !== "failed" &&
    recentEnough &&
    (isKpayPwaTxn(txn) || isKpayQrTxn(txn))
  ) {
    options.synced.count += 1;
    await options.syncStatus(id);
    txn = await loadTxnForMerchantOrderId(id);
    txnStatus = text(txn?.status).toLowerCase();
  }

  if (txnStatus !== "paid") return null;
  if (!isRecoverableOrphanTxn(txn, draft)) return null;

  const draftOrder = resolveCheckoutSnapshot(draft, txn);
  if (options.vendorFilter && !draftMatchesVendorFilter(draftOrder, options.vendorFilter)) {
    return null;
  }

  return buildOrphanRowFromSnapshot({ merchantOrderId: id, draft, txn, txnStatus });
}

export async function listOrphanedPwaDrafts(options?: {
  minAgeMinutes?: number;
  limit?: number;
  vendorId?: string;
  merchantOrderId?: string;
  syncStatus?: (merchantOrderId: string) => Promise<unknown>;
}): Promise<OrphanedPwaDraftRow[]> {
  const minAgeMs = Math.max(0, (options?.minAgeMinutes ?? 0) * 60 * 1000);
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const vendorFilter = text(options?.vendorId);
  const exactId = text(options?.merchantOrderId);
  const exactIdVariants = exactId ? orderIdLookupVariants(exactId) : [];
  const now = Date.now();

  const candidateIds = await collectCandidateMerchantOrderIds({ exactId, limit });
  const synced = { count: 0 };
  const maxSync = exactId ? 4 : 16;
  const result: OrphanedPwaDraftRow[] = [];
  const seen = new Set<string>();

  for (const merchantOrderId of candidateIds) {
    if (result.length >= limit) break;
    const canonical = merchantOrderId.toUpperCase();
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    const row = await evaluateOrphanCandidate(merchantOrderId, {
      minAgeMs,
      now,
      vendorFilter,
      exactId,
      exactIdVariants,
      syncStatus: options?.syncStatus,
      synced,
      maxSync,
    });
    if (row) result.push(row);
  }

  result.sort((a, b) => parseDraftAgeMs(b.savedAt) - parseDraftAgeMs(a.savedAt));
  return result.slice(0, limit);
}

export async function reconcileOrphanedPwaDrafts(params: {
  minAgeMinutes?: number;
  limit?: number;
  vendorId?: string;
  syncStatus: (merchantOrderId: string) => Promise<unknown>;
}): Promise<PwaReconcileResult> {
  const drafts = await listOrphanedPwaDrafts({
    minAgeMinutes: params.minAgeMinutes ?? 10,
    limit: params.limit ?? 100,
    vendorId: params.vendorId,
    syncStatus: params.syncStatus,
  });

  const result: PwaReconcileResult = {
    scanned: drafts.length,
    finalized: 0,
    skippedNoPayment: 0,
    failed: [],
    recovered: [],
  };

  for (const row of drafts) {
    try {
      await params.syncStatus(row.merchantOrderId);
      let fin = await finalizePwaCheckoutOrder(row.merchantOrderId);

      for (
        let attempt = 0;
        attempt < 2 && !fin.ok && fin.error === "payment_not_confirmed";
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await params.syncStatus(row.merchantOrderId);
        fin = await finalizePwaCheckoutOrder(row.merchantOrderId);
      }

      if (fin.ok) {
        result.finalized += 1;
        const orderNumber = text((fin.order as Record<string, unknown> | undefined)?.orderNumber) ||
          row.merchantOrderId;
        result.recovered.push({ merchantOrderId: row.merchantOrderId, orderNumber });
        continue;
      }

      if (fin.error === "payment_not_confirmed") {
        result.skippedNoPayment += 1;
      }
      result.failed.push({
        merchantOrderId: row.merchantOrderId,
        error: fin.error || "finalize_failed",
        message: fin.message,
      });
    } catch (error) {
      result.failed.push({
        merchantOrderId: row.merchantOrderId,
        error: "exception",
        message: String((error as Error)?.message || error),
      });
    }
  }

  return result;
}

function assertReconcileSecret(c: Context): Response | undefined {
  const expected = String(
    Deno.env.get("KPAY_PWA_RECONCILE_SECRET") ||
      Deno.env.get("EDGE_ADMIN_OPERATION_SECRET") ||
      "",
  ).trim();
  if (!expected) {
    return c.json(
      {
        error: "misconfigured",
        message: "Set KPAY_PWA_RECONCILE_SECRET (or EDGE_ADMIN_OPERATION_SECRET) on the Edge function.",
      },
      503,
    );
  }
  const provided = String(
    c.req.header("x-kpay-reconcile-secret") ||
      c.req.header("x-admin-operation-secret") ||
      "",
  ).trim();
  if (provided !== expected) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return undefined;
}

export async function getOrphanedPwaDraftsRoute(
  c: Context,
  syncStatus?: (merchantOrderId: string) => Promise<unknown>,
) {
  try {
    const url = new URL(c.req.url);
    const minAgeMinutes = Number(url.searchParams.get("minAgeMinutes") || "0");
    const limit = Number(url.searchParams.get("limit") || "50");
    const vendorId = text(url.searchParams.get("vendorId"));
    const merchantOrderId = text(url.searchParams.get("merchantOrderId"));

    const drafts = await listOrphanedPwaDrafts({
      minAgeMinutes: Number.isFinite(minAgeMinutes) ? minAgeMinutes : 0,
      limit: Number.isFinite(limit) ? limit : 50,
      vendorId: vendorId || undefined,
      merchantOrderId: merchantOrderId || undefined,
      syncStatus,
    });

    return c.json({ success: true, drafts, count: drafts.length });
  } catch (error) {
    console.error("getOrphanedPwaDraftsRoute error", error);
    return c.json({ error: "Failed to list orphaned PWA drafts" }, 500);
  }
}

export async function getPwaDraftStatusRoute(
  c: Context,
  syncStatus?: (merchantOrderId: string) => Promise<unknown>,
) {
  try {
    const merchantOrderId = text(c.req.param("merchantOrderId"));
    if (!merchantOrderId) {
      return c.json({ error: "merchantOrderId is required" }, 400);
    }

    const draft = await getPwaCheckoutDraft(merchantOrderId);
    let txn = await loadTxnForMerchantOrderId(merchantOrderId);

    if (!isRecoverableOrphanTxn(txn, draft)) {
      return c.json({
        success: true,
        merchantOrderId,
        hasDraft: Boolean(draft?.draftOrder),
        hasOrder: await storefrontOrderExists(merchantOrderId),
        txnStatus: text(txn?.status) || null,
        canRecover: false,
      });
    }

    if (syncStatus && (isKpayPwaTxn(txn) || isKpayQrTxn(txn))) {
      await syncStatus(merchantOrderId);
      txn = await loadTxnForMerchantOrderId(merchantOrderId);
    }

    const hasOrder = await storefrontOrderExists(merchantOrderId);
    const txnStatus = text(txn?.status).toLowerCase();
    const draftOrder = resolveCheckoutSnapshot(draft, txn);
    const totalRaw = Number(draftOrder?.total ?? txn?.amount ?? NaN);
    const vendorFields = snapshotVendorFields(draftOrder);

    return c.json({
      success: true,
      merchantOrderId,
      hasDraft: Boolean(draftOrder),
      hasOrder,
      txnStatus: txnStatus || null,
      prepayId: text(draft?.prepayId) || text(txn?.prepayId) || null,
      savedAt:
        text(draft?.savedAt) ||
        text(txn?.paidAt) ||
        text(txn?.updatedAt) ||
        text(txn?.createdAt) ||
        null,
      vendor: vendorFields.vendor || null,
      vendorId: vendorFields.vendorId || null,
      customer: snapshotCustomer(draftOrder) || null,
      email: snapshotEmail(draftOrder) || null,
      itemCount: snapshotItemCount(draftOrder) ?? null,
      amount: Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null,
      total: Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null,
      canRecover:
        !hasOrder &&
        txnStatus === "paid" &&
        isRecoverableOrphanTxn(txn, draft) &&
        hasMeaningfulCheckoutSnapshot(draftOrder),
    });
  } catch (error) {
    console.error("getPwaDraftStatusRoute error", error);
    return c.json({ error: "Failed to read PWA draft status" }, 500);
  }
}

export async function postPwaReconcileRoute(
  c: Context,
  syncStatus: (merchantOrderId: string) => Promise<unknown>,
) {
  const denied = assertReconcileSecret(c);
  if (denied) return denied;

  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const minAgeMinutes = Number(body.minAgeMinutes ?? 10);
    const limit = Number(body.limit ?? 100);
    const vendorId = text(body.vendorId);

    const result = await reconcileOrphanedPwaDrafts({
      minAgeMinutes: Number.isFinite(minAgeMinutes) ? minAgeMinutes : 10,
      limit: Number.isFinite(limit) ? limit : 100,
      vendorId: vendorId || undefined,
      syncStatus,
    });

    console.log(
      `[kpay-pwa-reconcile] scanned=${result.scanned} finalized=${result.finalized} skippedNoPayment=${result.skippedNoPayment} failed=${result.failed.length}`,
    );

    return c.json({ success: true, ...result });
  } catch (error) {
    console.error("postPwaReconcileRoute error", error);
    return c.json({ error: "PWA reconcile failed" }, 500);
  }
}
