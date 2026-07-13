import { formatOrderNumberDisplay } from "./orderNumber";

export type OrderExportInput = {
  orderNumber: string;
  date: string;
  createdAt?: string;
  customer: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  shippingAddress?: string;
  vendor: string;
  deliveryService?: string;
  notes?: string;
  status: string;
  shippingStatus: string;
  timeline?: Array<{ status: string; date: string }>;
  products: Array<{
    name: string;
    sku: string;
    quantity: number;
    price: number;
  }>;
};

const EXPORT_HEADERS = [
  "No",
  "Order date",
  "Mi Code",
  "Name",
  "Phone",
  "address",
  "city",
  "SKU",
  "Order qty",
  "Price",
  "Vendor",
  "Status",
  "delivery date",
];

function escapeCsvField(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatExportOrderDate(dateStr: string): string {
  const raw = String(dateStr || "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatExportDeliveryDate(order: OrderExportInput): string {
  const shippedEntry = (order.timeline || []).find((entry) =>
    /ship/i.test(String(entry.status || ""))
  );
  const raw = shippedEntry?.date || "";
  if (!raw) {
    if (order.shippingStatus === "shipped" || order.shippingStatus === "delivered") {
      const d = new Date(order.date || order.createdAt || "");
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      }
    }
    return "";
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function mapExportStatus(order: OrderExportInput): string {
  const status = String(order.status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (status === "ready-to-ship" || status === "processing" || status === "pending") {
    return "instock";
  }
  if (status === "fulfilled") return "fulfilled";
  if (status === "cancelled") return "cancelled";
  return status || "instock";
}

function resolveExportAddress(order: OrderExportInput): string {
  const street = String(order.address || "").trim();
  if (street) return street;
  const combined = String(order.shippingAddress || "").trim();
  if (!combined) return "";
  const city = String(order.city || "").trim();
  if (city && combined.includes(city)) {
    return combined.replace(city, "").replace(/,\s*$/, "").trim();
  }
  return combined.split(",")[0]?.trim() || combined;
}

function resolveExportCity(order: OrderExportInput): string {
  const city = String(order.city || "").trim();
  if (city) return city;
  const state = String(order.state || "").trim();
  if (state) return state;
  return "";
}

function buildExportLineItems(order: OrderExportInput) {
  const products = Array.isArray(order.products) ? order.products : [];
  if (products.length === 0) {
    return [{ name: "", sku: "", quantity: 0, price: 0 }];
  }
  return products;
}

/** Fulfillment-style CSV: one row per order line, matching ops spreadsheet layout. */
export function buildOrderExportCsv(orders: OrderExportInput[]): string {
  const lines: string[] = [EXPORT_HEADERS.join(",")];
  let rowNo = 1;

  for (const order of orders) {
    const address = resolveExportAddress(order);
    const city = resolveExportCity(order);
    const vendorName = String(order.vendor || "").trim();
    const orderDate = formatExportOrderDate(order.date || order.createdAt || "");
    const deliveryDate = formatExportDeliveryDate(order);
    const status = mapExportStatus(order);
    const customerName = String(order.customer || "").trim();

    for (const item of buildExportLineItems(order)) {
      lines.push(
        [
          escapeCsvField(rowNo++),
          escapeCsvField(orderDate),
          escapeCsvField(formatOrderNumberDisplay(order.orderNumber)),
          escapeCsvField(customerName),
          escapeCsvField(order.phone),
          escapeCsvField(address),
          escapeCsvField(city),
          escapeCsvField(item.sku),
          escapeCsvField(item.quantity),
          escapeCsvField(Math.round(Number(item.price) || 0)),
          escapeCsvField(vendorName),
          escapeCsvField(status),
          escapeCsvField(deliveryDate),
        ].join(",")
      );
    }
  }

  return `\uFEFF${lines.join("\n")}`;
}
