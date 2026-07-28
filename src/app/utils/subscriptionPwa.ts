export const SUBSCRIPTION_PWA_PENDING_KEY = "nexa_subscription_pwa_pending";

export type SubscriptionPwaPending = {
  merchantOrderId: string;
  planId: string;
  vendorId: string;
  customerId: string;
  storefrontOrigin: string;
  originPath: string;
  createdAt: string;
};

export function readSubscriptionPwaPending(): SubscriptionPwaPending | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SUBSCRIPTION_PWA_PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as SubscriptionPwaPending;
    if (!value?.merchantOrderId || !value?.vendorId || !value?.planId) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeSubscriptionPwaPending(value: SubscriptionPwaPending): void {
  localStorage.setItem(SUBSCRIPTION_PWA_PENDING_KEY, JSON.stringify(value));
}

export function clearSubscriptionPwaPending(merchantOrderId?: string): void {
  const pending = readSubscriptionPwaPending();
  if (merchantOrderId && pending?.merchantOrderId !== merchantOrderId) return;
  localStorage.removeItem(SUBSCRIPTION_PWA_PENDING_KEY);
}
