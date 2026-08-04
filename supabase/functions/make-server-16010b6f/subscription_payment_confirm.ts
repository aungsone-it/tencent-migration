import * as kv from "./kv_store.tsx";
import { createClient } from "./cloudbase_compat.ts";
import { syncKPayTxnStatusFromProvider } from "./kpay_routes.tsx";
import {
  isPaidSubscriptionPayment,
  splitSubscriptionRevenue,
  subscriptionPaymentSplit,
} from "./subscription_finance.ts";

const supabase = createClient(undefined, undefined, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PERIOD_DAYS = 30;

export function isSubscriptionMerchantOrderId(merchantOrderId: string): boolean {
  return String(merchantOrderId || "").trim().startsWith("SUB");
}

function positiveMmk(value: unknown): number {
  const amount = Math.round(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export type FinalizeSubscriptionPaymentResult =
  | { ok: true; subscription: Record<string, unknown> }
  | {
      ok: false;
      error: string;
      status?: "pending" | "not_found" | "amount_mismatch" | "already_paid_needs_repair";
    };

export async function finalizeSubscriptionPayment(
  merchantOrderId: string,
  options?: { syncFromProvider?: boolean; syncRetries?: number },
): Promise<FinalizeSubscriptionPaymentResult> {
  const id = String(merchantOrderId || "").trim();
  if (!id) return { ok: false, error: "merchantOrderId is required", status: "not_found" };

  const payment = await kv.get(`subscription_payment:${id}`);
  if (!payment || typeof payment !== "object") {
    return { ok: false, error: "Subscription payment not found", status: "not_found" };
  }
  const p = payment as Record<string, unknown>;

  if (isPaidSubscriptionPayment(p)) {
    const storedSplit = subscriptionPaymentSplit(p);
    if (
      p.vendorPayout !== storedSplit.vendorPayout ||
      p.platformRevenue !== storedSplit.platformRevenue
    ) {
      await kv.set(`subscription_payment:${id}`, {
        ...p,
        ...storedSplit,
      });
    }
    const existingSubscription = await kv.get(
      `customer_subscription:${p.vendorId}:${p.customerId}`,
    );
    if (p.subscriptionId && existingSubscription?.id === p.subscriptionId) {
      return { ok: true, subscription: existingSubscription as Record<string, unknown> };
    }
    return {
      ok: false,
      error: "This payment was already processed; the subscription record needs repair",
      status: "already_paid_needs_repair",
    };
  }

  const syncRetries = Math.max(0, options?.syncRetries ?? 0);
  let txn = (await kv.get(`kpay_txn:${id}`)) as Record<string, unknown> | null;
  const txnPaid = txn && String(txn.status || "").toLowerCase() === "paid";

  if (options?.syncFromProvider && !txnPaid) {
    for (let attempt = 0; attempt <= syncRetries; attempt++) {
      await syncKPayTxnStatusFromProvider(id);
      txn = (await kv.get(`kpay_txn:${id}`)) as Record<string, unknown> | null;
      if (txn && String(txn.status || "").toLowerCase() === "paid") break;
      if (attempt < syncRetries) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  if (!txn || String(txn.status || "").toLowerCase() !== "paid") {
    return {
      ok: false,
      error: "Payment has not been confirmed by KBZPay",
      status: "pending",
    };
  }

  const paidAmount = positiveMmk(txn.amount);
  const expectedAmount = positiveMmk(p.amount);
  if (!paidAmount || !expectedAmount || paidAmount !== expectedAmount) {
    return {
      ok: false,
      error: "Paid amount does not match the plan price",
      status: "amount_mismatch",
    };
  }

  const key = `customer_subscription:${p.vendorId}:${p.customerId}`;
  const existing = await kv.get(key);
  const now = new Date();
  const revenueSplit = splitSubscriptionRevenue(p.amount);
  const oldEnd = existing?.currentPeriodEnd ? new Date(existing.currentPeriodEnd) : null;
  const periodStart = oldEnd && oldEnd > now ? oldEnd : now;
  const subscription = {
    id: existing?.id || randomId("sub"),
    vendorId: p.vendorId,
    customerId: p.customerId,
    customerName: p.customerName,
    customerEmail: p.customerEmail,
    customerPhone: p.customerPhone,
    planId: p.planId,
    status: "active",
    currentPeriodStart: periodStart.toISOString(),
    currentPeriodEnd: addDays(periodStart, PERIOD_DAYS).toISOString(),
    lastPaymentId: p.id,
    lastMerchantOrderId: id,
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const paidPayment = {
    ...p,
    ...revenueSplit,
    status: "paid",
    paidAt: now.toISOString(),
    subscriptionId: subscription.id,
  };

  const { data: persistedSubscription, error: persistError } = await supabase.rpc(
    "rpc_confirm_subscription_payment",
    {
      p_payment_key: `subscription_payment:${id}`,
      p_subscription_key: key,
      p_subscription_template: subscription,
      p_paid_payment: paidPayment,
      p_period_days: PERIOD_DAYS,
    },
  );
  if (persistError) {
    // Fast fallback when PostgREST/direct RPC path is unavailable.
    await kv.set(key, subscription);
    await kv.set(`subscription_payment:${id}`, paidPayment);
    const persisted = await kv.get(key);
    if (persisted && typeof persisted === "object") {
      return { ok: true, subscription: persisted as Record<string, unknown> };
    }
    throw new Error(persistError.message);
  }
  if (!persistedSubscription || typeof persistedSubscription !== "object") {
    throw new Error("Subscription confirmation did not return a subscription");
  }

  return { ok: true, subscription: persistedSubscription as Record<string, unknown> };
}
