export const SUBSCRIPTION_VENDOR_PERCENT = 90;
export const SUBSCRIPTION_PLATFORM_PERCENT = 10;

export type SubscriptionRevenueSplit = {
  grossAmount: number;
  vendorPayout: number;
  platformRevenue: number;
};

function positiveMmk(value: unknown): number {
  const amount = Math.round(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function nonNegativeMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100) / 100
    : 0;
}

export function splitSubscriptionRevenue(amount: unknown): SubscriptionRevenueSplit {
  const grossAmount = positiveMmk(amount);
  const vendorPayout =
    Math.round(grossAmount * SUBSCRIPTION_VENDOR_PERCENT) / 100;

  return {
    grossAmount,
    vendorPayout,
    platformRevenue: Math.round((grossAmount - vendorPayout) * 100) / 100,
  };
}

export function subscriptionPaymentSplit(
  payment: Record<string, unknown>,
): SubscriptionRevenueSplit {
  const calculated = splitSubscriptionRevenue(payment.amount);
  const storedVendorPayout = nonNegativeMoney(payment.vendorPayout);
  const storedPlatformRevenue = nonNegativeMoney(payment.platformRevenue);

  if (
    storedVendorPayout === calculated.vendorPayout &&
    storedPlatformRevenue === calculated.platformRevenue
  ) {
    return {
      grossAmount: calculated.grossAmount,
      vendorPayout: storedVendorPayout,
      platformRevenue: storedPlatformRevenue,
    };
  }

  return calculated;
}

export function isPaidSubscriptionPayment(
  payment: Record<string, unknown>,
): boolean {
  return String(payment.status || "").trim().toLowerCase() === "paid";
}

export function paidSubscriptionPaymentDate(
  payment: Record<string, unknown>,
): Date | null {
  if (!isPaidSubscriptionPayment(payment)) return null;
  const split = subscriptionPaymentSplit(payment);
  if (split.grossAmount <= 0) return null;

  for (const candidate of [payment.paidAt, payment.createdAt]) {
    const date = new Date(String(candidate || ""));
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}
