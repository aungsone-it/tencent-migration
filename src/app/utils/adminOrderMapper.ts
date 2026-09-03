import {
  derivePaymentStatusFromOrder,
  deriveShippingStatusFromOrder,
} from "./normalizeOrderBadgeStatus";
import { deriveOrderPaymentMethodKey } from "./orderPaymentMethod";
import { normalizeOrderLineParentProductId } from "./orderInventoryCacheSync";
import {
  buildOrderShippingAddressLine,
  extractOrderShippingFields,
  resolveOrderSellerId,
} from "./orderShippingAddress";

export type AdminOrderStatus =
  | "pending"
  | "processing"
  | "fulfilled"
  | "cancelled"
  | "ready-to-ship";
export type AdminPaymentStatus = "paid" | "unpaid" | "refunded" | "pending_refund";
export type AdminShippingStatus = "pending" | "shipped" | "delivered" | "cancelled";

export type AdminOrderProduct = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  image: string;
  sku: string;
};

export type AdminOrderItem = {
  id: string;
  orderNumber: string;
  date: string;
  createdAt?: string;
  updatedAt?: string;
  customer: string;
  email: string;
  phone: string;
  vendor: string;
  total: number;
  subtotal?: number;
  discount?: number;
  couponCode?: string;
  items: number;
  status: AdminOrderStatus;
  paymentStatus: AdminPaymentStatus;
  shippingStatus: AdminShippingStatus;
  products: AdminOrderProduct[];
  shippingAddress: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  sellerId?: string;
  country?: string;
  trackingNumber?: string;
  notes?: string;
  deliveryService?: string;
  deliveryServiceLogo?: string;
  deliveryPartnerId?: string;
  deliveryPartnerName?: string;
  shippingFee?: number;
  paymentMethod?: "credit-card" | "cod" | "bank-transfer" | "kbz-qr" | "kbz-pwa";
  timeline: Array<{ status: string; date: string; time: string }>;
  inventoryDeducted?: boolean;
  refundStatus?: "success" | "already_refunded" | "processing" | "failed" | "";
  refundRequestNo?: string;
  refundAmount?: number;
  refundedAt?: string;
  kpay?: unknown;
};

/** Map a single API order payload → admin Orders / OrderDetails row shape. */
export function mapApiOrderToOrderItem(order: Record<string, unknown>): AdminOrderItem {
  const shipping = extractOrderShippingFields(order);
  return {
    id: String(order.id || ""),
    orderNumber: String(order.orderNumber || order.id || ""),
    date: order.createdAt
      ? new Date(String(order.createdAt)).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
    createdAt: String(order.createdAt || new Date().toISOString()),
    updatedAt: String(order.updatedAt || order.createdAt || new Date().toISOString()),
    customer:
      (order.customer as { fullName?: string; name?: string })?.fullName ||
      (order.customer as { fullName?: string; name?: string })?.name ||
      String(order.customerName || "") ||
      (typeof order.customer === "string" ? order.customer : null) ||
      (() => {
        const c = order.customer as {
          firstName?: string;
          lastName?: string;
        } | null;
        if (c?.firstName && c?.lastName) return `${c.firstName} ${c.lastName}`;
        return c?.firstName || c?.lastName || "Guest Customer";
      })(),
    email: String(order.email || (order.customer as { email?: string })?.email || ""),
    phone: String(order.phone || (order.customer as { phone?: string })?.phone || ""),
    vendor:
      String(
        order.vendor ??
          order.vendorName ??
          order.storeName ??
          (typeof order.vendorId === "string" ? order.vendorId : "") ??
          "",
      ) || "",
    total: parseFloat(String(order.total)) || 0,
    subtotal:
      order.subtotal != null && order.subtotal !== ""
        ? parseFloat(String(order.subtotal))
        : undefined,
    discount:
      order.discount != null && order.discount !== ""
        ? parseFloat(String(order.discount))
        : undefined,
    couponCode: order.couponCode as string | undefined,
    items: Array.isArray(order.items) ? order.items.length : 0,
    status: (order.status as AdminOrderStatus) || "pending",
    paymentStatus: derivePaymentStatusFromOrder(order) as AdminPaymentStatus,
    shippingStatus: deriveShippingStatusFromOrder(order),
    products: (Array.isArray(order.items) ? order.items : []).map((item: Record<string, unknown>) => ({
      id: normalizeOrderLineParentProductId(item.productId ?? item.id),
      name: String(item.name || "Product"),
      quantity: Number(item.quantity) || 1,
      price:
        typeof item.price === "number"
          ? item.price
          : parseFloat(String(item.price || "0").replace(/[$,]/g, "")) || 0,
      image:
        String(item.image || "") ||
        "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=100&h=100&fit=crop",
      sku: String(item.sku || "N/A"),
    })),
    shippingAddress: buildOrderShippingAddressLine(shipping),
    address: shipping.address,
    city: shipping.city,
    state: shipping.state,
    zipCode: shipping.zipCode,
    sellerId: resolveOrderSellerId(order),
    country: shipping.country,
    trackingNumber: order.trackingNumber as string | undefined,
    notes: order.notes as string | undefined,
    deliveryService: String(order.deliveryService || order.deliveryPartnerName || ""),
    deliveryServiceLogo: order.deliveryServiceLogo as string | undefined,
    deliveryPartnerId: String(order.deliveryPartnerId || ""),
    deliveryPartnerName: String(order.deliveryPartnerName || order.deliveryService || ""),
    shippingFee:
      parseFloat(String(order.shippingFee ?? order.shippingCost ?? order.shipping ?? 0)) || 0,
    paymentMethod: deriveOrderPaymentMethodKey(order),
    kpay: order.kpay,
    timeline: [
      {
        status: "Order Placed",
        date: order.createdAt
          ? new Date(String(order.createdAt)).toISOString().split("T")[0]
          : "",
        time: order.createdAt ? new Date(String(order.createdAt)).toLocaleTimeString() : "",
      },
      ...(order.status !== "pending"
        ? [
            {
              status: "Processing",
              date: order.updatedAt
                ? new Date(String(order.updatedAt)).toISOString().split("T")[0]
                : "",
              time: order.updatedAt
                ? new Date(String(order.updatedAt)).toLocaleTimeString()
                : "",
            },
          ]
        : []),
    ],
    inventoryDeducted: order.inventoryDeducted as boolean | undefined,
    refundStatus:
      (String(order.refundStatus || (order.kpay as { refund?: { status?: string } })?.refund?.status || "")
        .trim()
        .toLowerCase() as AdminOrderItem["refundStatus"]) || "",
    refundRequestNo:
      String(
        order.refundRequestNo ||
          (order.kpay as { refund?: { refundRequestNo?: string } })?.refund?.refundRequestNo ||
          "",
      ) || undefined,
    refundAmount:
      Number(
        order.refundAmount ||
          (order.kpay as { refund?: { amount?: number } })?.refund?.amount ||
          0,
      ) || 0,
    refundedAt:
      String(
        order.refundedAt ||
          (order.kpay as { refund?: { refundedAt?: string; failedAt?: string } })?.refund
            ?.refundedAt ||
          (order.kpay as { refund?: { refundedAt?: string; failedAt?: string } })?.refund
            ?.failedAt ||
          "",
      ) || undefined,
  };
}

export function mapApiOrdersToOrderItems(apiOrders: unknown[]): AdminOrderItem[] {
  return (Array.isArray(apiOrders) ? apiOrders : []).map((order) =>
    mapApiOrderToOrderItem(order as Record<string, unknown>),
  );
}
