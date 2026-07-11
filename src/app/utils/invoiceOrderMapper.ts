import type { InvoiceSheetOrder } from "../components/InvoiceSheet";

/** Map admin order detail / list row → printable invoice payload. */
export function toInvoiceSheetOrder(order: {
  orderNumber: string;
  date: string;
  customer: string | { fullName?: string; name?: string };
  phone?: string;
  shippingAddress?: string;
  products?: InvoiceSheetOrder["products"];
  items?: InvoiceSheetOrder["items"];
  total: number | string;
  subtotal?: number;
  discount?: number;
  couponCode?: string;
  notes?: string;
  vendor?: string;
  vendorName?: string;
  storeName?: string;
}): InvoiceSheetOrder {
  const vendorLabel = String(
    order.vendorName || order.vendor || order.storeName || ""
  ).trim();

  return {
    orderNumber: order.orderNumber,
    date: order.date,
    customer: order.customer,
    phone: order.phone,
    shippingAddress: order.shippingAddress,
    products: order.products,
    items: order.items,
    total: order.total,
    subtotal: order.subtotal,
    discount: order.discount,
    couponCode: order.couponCode,
    notes: order.notes,
    vendor: vendorLabel || order.vendor,
    vendorName: order.vendorName,
    storeName: order.storeName,
  };
}
