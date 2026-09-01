import {
  cloudbaseApiBaseUrl,
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
} from "../../../utils/supabase/info";

export const APPLIED_COUPON_STORAGE_KEY = "migoo-applied-coupon";

export type CouponCampaignRules = {
  id?: string;
  name?: string;
  code?: string;
  discount?: number;
  discountType?: string;
  discountAmount?: number;
  minQuantity?: number;
  minAmount?: number;
  productScope?: string;
  specificProducts?: string[];
};

export type AppliedCoupon = {
  valid: boolean;
  campaign: CouponCampaignRules;
  message?: string;
};

export type CartCouponItem = {
  id?: string;
  sku?: string;
  price?: number;
  quantity?: number;
};

export function getCartQuantity(items: CartCouponItem[]): number {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

export function getCouponEligibleSubtotal(
  campaign: CouponCampaignRules,
  cartItems: CartCouponItem[],
  payableSubtotal: number,
): number {
  if (
    campaign.productScope === "specific" &&
    Array.isArray(campaign.specificProducts) &&
    campaign.specificProducts.length > 0
  ) {
    const eligibleSkus = campaign.specificProducts.map((sku) => String(sku).toUpperCase());
    return cartItems
      .filter((item) => eligibleSkus.includes(String(item.sku || item.id || "").toUpperCase()))
      .reduce(
        (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
        0,
      );
  }
  return payableSubtotal;
}

export function getCouponEligibilityError(
  campaign: CouponCampaignRules | undefined,
  cartItems: CartCouponItem[],
  payableSubtotal: number,
): string | null {
  if (!campaign) return null;

  const totalQuantity = getCartQuantity(cartItems);
  const minQty = Number(campaign.minQuantity) || 1;
  if (minQty > 1 && totalQuantity < minQty) {
    return `Minimum ${minQty} items required in cart`;
  }

  const eligibleTotal = getCouponEligibleSubtotal(campaign, cartItems, payableSubtotal);

  if (
    campaign.productScope === "specific" &&
    Array.isArray(campaign.specificProducts) &&
    campaign.specificProducts.length > 0 &&
    eligibleTotal <= 0
  ) {
    return `This coupon only applies to: ${campaign.specificProducts.join(", ")}`;
  }

  const minAmount = Number(campaign.minAmount) || 0;
  if (minAmount > 0 && eligibleTotal < minAmount) {
    return `Minimum order amount is ${minAmount.toLocaleString()} Ks`;
  }

  return null;
}

export function computeCouponDiscountAmount(
  campaign: CouponCampaignRules,
  cartItems: CartCouponItem[],
  payableSubtotal: number,
): number {
  if (getCouponEligibilityError(campaign, cartItems, payableSubtotal)) return 0;

  const eligibleTotal = getCouponEligibleSubtotal(campaign, cartItems, payableSubtotal);
  const discount = Number(campaign.discount) || 0;

  if (discount <= 0) {
    return Math.max(Number(campaign.discountAmount) || 0, 0);
  }

  let amount = 0;
  if (campaign.discountType === "percentage") {
    amount = (eligibleTotal * discount) / 100;
  } else if (campaign.discountType === "fixed") {
    amount = discount;
  } else {
    amount = Number(campaign.discountAmount) || 0;
  }

  return Math.min(Math.max(amount, 0), eligibleTotal);
}

export function readAppliedCouponFromStorage(): AppliedCoupon | null {
  try {
    const raw = localStorage.getItem(APPLIED_COUPON_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.valid && parsed?.campaign) return parsed as AppliedCoupon;
    return null;
  } catch {
    return null;
  }
}

export function writeAppliedCouponToStorage(coupon: AppliedCoupon | null): void {
  try {
    if (!coupon) {
      localStorage.removeItem(APPLIED_COUPON_STORAGE_KEY);
      return;
    }
    localStorage.setItem(APPLIED_COUPON_STORAGE_KEY, JSON.stringify(coupon));
  } catch {
    /* ignore quota/private mode */
  }
}

export async function validateAndApplyCouponCode(args: {
  code: string;
  cartItems: CartCouponItem[];
  cartTotal: number;
}): Promise<{ coupon: AppliedCoupon | null; error: string | null }> {
  const code = args.code.trim().toUpperCase();
  if (!code) {
    return { coupon: null, error: "Please enter a coupon code" };
  }

  const cartItems = args.cartItems.map((item) => ({
    id: item.id,
    sku: item.sku || item.id,
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 0,
  }));
  const cartTotal = Math.max(Number(args.cartTotal) || 0, 0);

  try {
    const response = await fetch(`${cloudbaseApiBaseUrl}/campaigns/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getCloudBaseRequestHeaders(),
        ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
      },
      body: JSON.stringify({ code, cartTotal, cartItems }),
    });

    const data = await response.json();
    if (!data.valid) {
      return { coupon: null, error: data.error || "Invalid coupon code" };
    }

    let campaign: CouponCampaignRules = data.campaign || {};
    if (campaign.id) {
      try {
        const detailRes = await fetch(`${cloudbaseApiBaseUrl}/campaigns/${campaign.id}`, {
          headers: {
            ...getCloudBaseRequestHeaders(),
            ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
          },
        });
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          campaign = { ...campaign, ...(detailData.campaign || {}) };
        }
      } catch {
        /* use partial campaign rules if detail fetch fails */
      }
    }

    const eligibilityError = getCouponEligibilityError(campaign, cartItems, cartTotal);
    if (eligibilityError) {
      return { coupon: null, error: eligibilityError };
    }

    return {
      coupon: { ...data, campaign },
      error: null,
    };
  } catch {
    return { coupon: null, error: "Failed to apply coupon. Please try again." };
  }
}
