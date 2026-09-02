import type { InvoiceSheetOrder } from "../components/InvoiceSheet";
import { derivePaymentStatusFromOrder } from "./normalizeOrderBadgeStatus";

/** Map admin order detail / list row → printable invoice payload. */
export function toInvoiceSheetOrder(order: {
  orderNumber: string;
  date: string;
  customer: string | { fullName?: string; name?: string };
  phone?: string;
  sellerId?: string;
  zipCode?: string;
  shippingAddress?: string;
  products?: InvoiceSheetOrder["products"];
  items?: InvoiceSheetOrder["items"];
  total: number | string;
  subtotal?: number;
  discount?: number;
  shippingFee?: number | string;
  shippingCost?: number | string;
  shipping?: number | string;
  couponCode?: string;
  notes?: string;
  vendor?: string;
  vendorName?: string;
  storeName?: string;
  deliveryService?: string;
  deliveryPartnerName?: string;
  paymentStatus?: unknown;
  status?: string;
  paymentMethod?: unknown;
  kpay?: InvoiceSheetOrder["kpay"];
}): InvoiceSheetOrder {
  const vendorLabel = String(
    order.vendorName || order.vendor || order.storeName || ""
  ).trim();
  const deliveryService = String(
    order.deliveryService || order.deliveryPartnerName || ""
  ).trim();
  const shippingFee =
    order.shippingFee ?? order.shippingCost ?? order.shipping ?? 0;

  return {
    orderNumber: order.orderNumber,
    date: order.date,
    customer: order.customer,
    phone: order.phone,
    sellerId: String(order.sellerId || order.zipCode || "").trim() || undefined,
    shippingAddress: order.shippingAddress,
    products: order.products,
    items: order.items,
    total: order.total,
    subtotal: order.subtotal,
    discount: order.discount,
    shippingFee,
    couponCode: order.couponCode,
    notes: order.notes,
    vendor: vendorLabel || order.vendor,
    vendorName: order.vendorName,
    storeName: order.storeName,
    deliveryService: deliveryService || undefined,
    deliveryPartnerName: deliveryService || undefined,
    paymentStatus: order.paymentStatus ?? derivePaymentStatusFromOrder(order),
    status: order.status,
    paymentMethod: order.paymentMethod,
    kpay: order.kpay,
  };
}
