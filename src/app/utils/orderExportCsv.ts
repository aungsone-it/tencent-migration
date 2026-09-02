import { formatOrderNumberDisplay } from "./orderNumber";
import { resolveOrderSellerId } from "./orderShippingAddress";

export type OrderExportInput = {
  orderNumber: string;
  date: string;
  createdAt?: string;
  customer: string;
  phone: string;
  sellerId?: string;
  zipCode?: string;
  address?: string;
  city?: string;
  state?: string;
  shippingAddress?: string;
  vendor: string;
  deliveryService?: string;
  deliveryPartnerName?: string;
  notes?: string;
  status: string;
  shippingStatus: string;
  total?: number;
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
  "Seller ID",
  "address",
  "city",
  "Region",
  "SKU",
  "Order qty",
  "Price",
  "Total",
  "Vendor",
  "Status",
  "logistic",
  "delivery date",
] as const;

function escapeCsvField(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Force Excel / WPS on Windows to keep phone numbers as text.
 * Bare values like +959679748413 become scientific notation (9.5968E+11).
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

function resolveExportRegion(order: OrderExportInput): string {
  return String(order.state || "").trim();
}

function buildExportLineItems(order: OrderExportInput) {
  const products = Array.isArray(order.products) ? order.products : [];
  if (products.length === 0) {
    return [{ name: "", sku: "", quantity: 0, price: 0 }];
  }
  return products;
}

function resolveExportLogistic(order: OrderExportInput): string {
  return String(order.deliveryService || order.deliveryPartnerName || "").trim();
}

function resolveExportOrderTotal(order: OrderExportInput): number {
  return Math.round(Number(order.total) || 0);
}

type PreparedOrderExport = {
  orderNo: number;
  orderDate: string;
  orderCode: string;
  customerName: string;
  phone: string;
  sellerId: string;
  address: string;
  city: string;
  region: string;
  vendorName: string;
  status: string;
  deliveryDate: string;
  logistic: string;
  orderTotal: number;
  lineItems: Array<{ sku: string; quantity: number; price: number }>;
};

function prepareOrderExports(orders: OrderExportInput[]): PreparedOrderExport[] {
  let orderNo = 0;
  return orders.map((order) => {
    orderNo += 1;
    const lineItems = buildExportLineItems(order).map((item) => ({
      sku: String(item.sku || ""),
      quantity: Number(item.quantity) || 0,
      price: Math.round(Number(item.price) || 0),
    }));
    return {
      orderNo,
      orderDate: formatExportOrderDate(order.date || order.createdAt || ""),
      orderCode: formatOrderNumberDisplay(order.orderNumber),
      customerName: String(order.customer || "").trim(),
      phone: String(order.phone || "").trim(),
      sellerId: resolveOrderSellerId(order as Record<string, unknown>),
      address: resolveExportAddress(order),
      city: resolveExportCity(order),
      region: resolveExportRegion(order),
      vendorName: String(order.vendor || "").trim(),
      status: mapExportStatus(order),
      deliveryDate: formatExportDeliveryDate(order),
      logistic: resolveExportLogistic(order),
      orderTotal: resolveExportOrderTotal(order),
      lineItems,
    };
  });
}

function rowspanCell(content: string, span: number, extraStyle = ""): string {
  const style = extraStyle ? ` style="${extraStyle}"` : "";
  if (span <= 1) return `<td${style}>${content}</td>`;
  return `<td rowspan="${span}"${style}>${content}</td>`;
}

/** Excel-compatible HTML with merged cells for multi-item order totals and header fields. */
export function buildOrderExportSpreadsheetHtml(orders: OrderExportInput[]): string {
  const prepared = prepareOrderExports(orders);
  const headerRow = EXPORT_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyRows: string[] = [];

  for (const order of prepared) {
    const span = order.lineItems.length;
    order.lineItems.forEach((item, itemIndex) => {
      const isFirstLine = itemIndex === 0;
      const cells: string[] = [];

      if (isFirstLine) {
        cells.push(rowspanCell(escapeHtml(order.orderNo), span));
        cells.push(rowspanCell(escapeHtml(order.orderDate), span));
        cells.push(rowspanCell(escapeHtml(order.orderCode), span));
      }

      if (isFirstLine) {
        cells.push(rowspanCell(escapeHtml(order.customerName), span));
        cells.push(
          rowspanCell(
            escapeHtml(order.phone),
            span,
            "mso-number-format:'\\@';",
          ),
        );
        cells.push(
          rowspanCell(
            escapeHtml(order.sellerId),
            span,
            "mso-number-format:'\\@';",
          ),
        );
        cells.push(rowspanCell(escapeHtml(order.address), span));
        cells.push(rowspanCell(escapeHtml(order.city), span));
        cells.push(rowspanCell(escapeHtml(order.region), span));
      }

      cells.push(`<td>${escapeHtml(item.sku)}</td>`);
      cells.push(`<td>${escapeHtml(item.quantity)}</td>`);
      cells.push(`<td>${escapeHtml(item.price)}</td>`);

      if (isFirstLine) {
        cells.push(rowspanCell(escapeHtml(order.orderTotal), span));
        cells.push(rowspanCell(escapeHtml(order.vendorName), span));
        cells.push(rowspanCell(escapeHtml(order.status), span));
        cells.push(rowspanCell(escapeHtml(order.logistic), span));
        cells.push(rowspanCell(escapeHtml(order.deliveryDate), span));
      }

      bodyRows.push(`<tr>${cells.join("")}</tr>`);
    });
  }

  return [
    "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\">",
    "<head><meta charset=\"utf-8\">",
    "<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>",
    "<x:Name>Orders</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>",
    "</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->",
    "<style>td,th{border:1px solid #ccc;padding:4px 6px;vertical-align:middle;}</style>",
    "</head><body><table border=\"1\" cellspacing=\"0\" cellpadding=\"0\">",
    `<thead><tr>${headerRow}</tr></thead>`,
    `<tbody>${bodyRows.join("")}</tbody>`,
    "</table></body></html>",
  ].join("");
}

/** Plain CSV fallback — Mi Code on every row; No is order index (blank on continuation rows). */
export function buildOrderExportCsv(orders: OrderExportInput[]): string {
  const lines: string[] = [EXPORT_HEADERS.join(",")];
  const prepared = prepareOrderExports(orders);

  for (const order of prepared) {
    order.lineItems.forEach((item, itemIndex) => {
      const isFirstLine = itemIndex === 0;
      lines.push(
        [
          isFirstLine ? escapeCsvField(order.orderNo) : "",
          isFirstLine ? escapeCsvField(order.orderDate) : "",
          isFirstLine ? escapeCsvField(order.orderCode) : "",
          isFirstLine ? escapeCsvField(order.customerName) : "",
          isFirstLine ? excelTextField(order.phone) : "",
          isFirstLine ? excelTextField(order.sellerId) : "",
          isFirstLine ? escapeCsvField(order.address) : "",
          isFirstLine ? escapeCsvField(order.city) : "",
          isFirstLine ? escapeCsvField(order.region) : "",
          escapeCsvField(item.sku),
          escapeCsvField(item.quantity),
          escapeCsvField(item.price),
          isFirstLine ? escapeCsvField(order.orderTotal) : "",
          isFirstLine ? escapeCsvField(order.vendorName) : "",
          isFirstLine ? escapeCsvField(order.status) : "",
          isFirstLine ? escapeCsvField(order.logistic) : "",
          isFirstLine ? escapeCsvField(order.deliveryDate) : "",
        ].join(","),
      );
    });
  }

  return `\uFEFF${lines.join("\n")}`;
}
