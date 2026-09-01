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

/**
 * Force Excel / WPS on Windows to keep phone numbers as text.
 * Bare values like +959679748413 become scientific notation (9.5968E+11).
 * CSV formula `="value"` displays the literal string.
 */
function excelTextField(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const inner = s.replace(/"/g, '""');
  return `"=""${inner}"""`;
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

function uniqueAddressParts(...parts: string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const part = String(raw || "").trim();
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    if (out.some((existing) => existing.includes(part))) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join(", ");
}

function resolveExportAddress(order: OrderExportInput): string {
  const street = String(order.address || "").trim();
  const township = String(order.city || "").trim();
  const region = String(order.state || "").trim();
  const structured = uniqueAddressParts(street, township, region);
  const combined = String(order.shippingAddress || "").trim();
  if (combined && (!structured || combined.length > structured.length)) {
    return combined;
  }
  return structured;
}

function resolveExportCity(order: OrderExportInput): string {
  return String(order.city || "").trim();
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
          excelTextField(order.phone),
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
