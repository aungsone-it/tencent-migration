/** Three checkout placement kinds — do not mix their summary hydration. */

export type CheckoutPlacementMethod = "COD" | "Card" | "KPay" | "KPay-PWA" | "BankTransfer";

export type CheckoutSummarySnapshotLike = {
  orderNumber: string;
  paymentMethod: CheckoutPlacementMethod | string;
};

export function normalizeCheckoutPaymentMethod(
  raw: unknown,
): CheckoutPlacementMethod {
  const txt = String(raw || "").trim().toLowerCase();
  if (!txt) return "Card";
  if (txt === "cod" || txt === "cash" || txt.includes("cash on delivery")) return "COD";
  if (txt.includes("pwa") || txt.includes("mobile browser")) return "KPay-PWA";
  if (
    txt === "kpay" ||
    txt === "kbzpay" ||
    txt === "kbz pay" ||
    txt.includes("kpay qr") ||
    txt.includes("kbzpay qr") ||
    txt.includes("kbz pay qr")
  ) {
    return "KPay";
  }
  if (txt.includes("bank")) return "BankTransfer";
  if (txt.includes("credit") || txt.includes("debit") || txt.includes("card")) return "Card";
  return "Card";
}

/** COD and QR create the order on Place Order. PWA does not. */
export function isImmediatePlacementMethod(
  method: CheckoutPlacementMethod | null | undefined,
): boolean {
  return method === "COD" || method === "KPay";
}

export function isPwaPlacementMethod(
  method: CheckoutPlacementMethod | null | undefined,
): boolean {
  return method === "KPay-PWA";
}

export type CheckoutSummaryPlacementInput<T extends CheckoutSummarySnapshotLike> = {
  urlOrderId: string;
  urlPrepayId: string;
  pendingMerchantOrderId: string;
  pendingHasDraft: boolean;
  pathSnapshot: T | null;
  latestSnapshot: T | null;
};

export type CheckoutSummaryPlacement<T extends CheckoutSummarySnapshotLike> = {
  snapshot: T | null;
  pendingOrderId: string;
  fromPersistedSnapshot: boolean;
};

function snapshotMethod(
  snapshot: CheckoutSummarySnapshotLike | null,
): CheckoutPlacementMethod | null {
  return snapshot ? normalizeCheckoutPaymentMethod(snapshot.paymentMethod) : null;
}

function matchingSnapshot<T extends CheckoutSummarySnapshotLike>(
  orderId: string,
  pathSnapshot: T | null,
  latestSnapshot: T | null,
): T | null {
  if (!orderId) return null;
  return (
    [pathSnapshot, latestSnapshot].find(
      (s) => s && String(s.orderNumber).trim() === orderId,
    ) ?? null
  );
}

/**
 * Pick summary data without letting leftover COD/QR snapshots steal a PWA return,
 * or leftover PWA drafts steal a just-placed COD/QR order.
 */
export function resolveCheckoutSummaryPlacement<T extends CheckoutSummarySnapshotLike>(
  input: CheckoutSummaryPlacementInput<T>,
): CheckoutSummaryPlacement<T> {
  const urlOrderId = String(input.urlOrderId || "").trim();
  const urlPrepayId = String(input.urlPrepayId || "").trim();
  const pendingId = String(input.pendingMerchantOrderId || "").trim();
  const placedSnapshot = input.pathSnapshot || input.latestSnapshot;

  // KBZ PWA return always has prepay_id and/or merch_order_id. URL wins.
  if (urlPrepayId || urlOrderId) {
    const targetId = urlOrderId || pendingId;
    const matching = matchingSnapshot(targetId, input.pathSnapshot, input.latestSnapshot);
    if (matching) {
      return { snapshot: matching, pendingOrderId: targetId, fromPersistedSnapshot: true };
    }
    return { snapshot: null, pendingOrderId: targetId, fromPersistedSnapshot: false };
  }

  // Vendor /summary after COD or QR Place Order — no KBZ return query.
  if (isImmediatePlacementMethod(snapshotMethod(placedSnapshot)) && placedSnapshot) {
    return { snapshot: placedSnapshot, pendingOrderId: "", fromPersistedSnapshot: true };
  }

  if (pendingId && input.pendingHasDraft) {
    return { snapshot: null, pendingOrderId: pendingId, fromPersistedSnapshot: false };
  }

  return {
    snapshot: placedSnapshot,
    pendingOrderId: "",
    fromPersistedSnapshot: Boolean(placedSnapshot),
  };
}
