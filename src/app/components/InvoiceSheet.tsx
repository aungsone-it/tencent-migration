import { Barcode } from "./BarcodeLazy";
import { BRANDING } from "../../constants";
import { formatInvoiceBarcodeValue } from "../utils/orderNumber";

export interface InvoiceLineItem {
  id?: string;
  name?: string;
  title?: string;
  quantity?: number;
  price?: number | string;
  sku?: string;
}

export interface InvoiceSheetOrder {
  orderNumber: string;
  date: string;
  customer: string | { fullName?: string; name?: string };
  phone?: string;
  shippingAddress?: string;
  products?: InvoiceLineItem[];
  items?: InvoiceLineItem[];
  total?: number | string;
  subtotal?: number;
  discount?: number;
  shippingFee?: number | string;
  couponCode?: string;
  notes?: string;
  vendor?: string;
  vendorName?: string;
  storeName?: string;
  deliveryService?: string;
  deliveryPartnerName?: string;
}

function resolveInvoiceBrandName(order: InvoiceSheetOrder): string {
  const name = String(order.vendorName || order.vendor || order.storeName || "").trim();
  return name || BRANDING.APP_NAME || "our store";
}

function formatCurrency(amount: number): string {
  return `K${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function parsePrice(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
  return 0;
}

function parseTotal(value: number | string | undefined): number {
  return parsePrice(value);
}

export function InvoiceSheet({ order }: { order: InvoiceSheetOrder }) {
  const lineItems = order.products || order.items || [];
  const productTotal = lineItems.reduce(
    (sum, item) => sum + parsePrice(item.price) * (item.quantity || 1),
    0
  );
  const shippingFeeRaw = parsePrice(order.shippingFee ?? 0);
  const deliveryCompany = String(
    order.deliveryService || order.deliveryPartnerName || ""
  ).trim();
  const subtotal = productTotal || parsePrice(order.subtotal) || 0;
  const total = parseTotal(order.total) || subtotal;
  const explicitDiscount =
    order.discount != null && order.discount !== ""
      ? parsePrice(order.discount)
      : null;
  const shippingFee =
    shippingFeeRaw > 0
      ? shippingFeeRaw
      : Math.max(0, total - subtotal + (explicitDiscount ?? 0));
  const actualDiscount =
    explicitDiscount ?? Math.max(0, subtotal + shippingFee - total);
  const hasDiscount = actualDiscount > 0;
  const discountPercentage =
    subtotal > 0 ? Math.round((actualDiscount / subtotal) * 100) : 0;

  const shippingLines = (order.shippingAddress || "No address provided")
    .split("\n")
    .filter((line) => line.trim());

  const customerName =
    typeof order.customer === "string"
      ? order.customer
      : order.customer?.fullName || order.customer?.name || "Guest Customer";

  const vendorName = resolveInvoiceBrandName(order);

  const barcodeProps = { width: 1, height: 35, fontSize: 14, margin: 6 };

  return (
    <div className="invoice-page">
      <div className="invoice-body">
      <div className="invoice-header">
        <div className="brand">
          <h1 className="brand-name">{vendorName}</h1>
          <p className="order-date">Date: {formatDate(order.date)}</p>
        </div>
        <div className="barcode-section">
          <Barcode
            value={formatInvoiceBarcodeValue(order.orderNumber)}
            width={barcodeProps.width}
            height={barcodeProps.height}
            fontSize={barcodeProps.fontSize}
            margin={barcodeProps.margin}
            displayValue={true}
          />
        </div>
      </div>

      <div className="shipping-section">
        <h2 className="section-title">Shipping</h2>
        <p className="customer-name">{customerName}</p>
        {shippingLines.map((line, idx) => (
          <p key={idx} className="address-line">
            {line}
          </p>
        ))}
        {order.phone && <p className="phone-line">Tel: {order.phone}</p>}
        {deliveryCompany && (
          <p className="delivery-line">Delivery: {deliveryCompany}</p>
        )}
      </div>

      <table className="items-table">
        <thead>
          <tr>
            <th className="col-qty">QTY</th>
            <th className="col-product">PRODUCT</th>
            <th className="col-sku">SKU</th>
            <th className="col-price">PRICE</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.length > 0 ? (
            lineItems.map((item, idx) => (
              <tr key={idx}>
                <td className="col-qty">{item.quantity || 1}</td>
                <td className="col-product">{item.name || item.title || "Product"}</td>
                <td className="col-sku">{item.sku || item.id || "-"}</td>
                <td className="col-price">{formatCurrency(parsePrice(item.price))}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="no-items">
                No items
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {order.notes && (
        <div className="notes-section">
          <p className="notes-label">Notes:</p>
          <p className="notes-text">{order.notes}</p>
        </div>
      )}

      {order.couponCode && (
        <div className="promo-section">
          <p className="promo-label">Promo Code Applied:</p>
          <p className="promo-code">{order.couponCode}</p>
        </div>
      )}

      <div className="total-section">
        {(subtotal > 0 || shippingFee > 0) && (
          <div className="subtotal-row">
            <span className="subtotal-label">Subtotal:</span>
            <span className="subtotal-amount">{formatCurrency(subtotal)}</span>
          </div>
        )}
        {shippingFee > 0 && (
          <>
            {deliveryCompany && (
              <div className="delivery-company-row">
                <span className="delivery-company-label">{deliveryCompany}</span>
              </div>
            )}
            <div className="subtotal-row">
              <span className="subtotal-label">Shipping fee:</span>
              <span className="subtotal-amount">{formatCurrency(shippingFee)}</span>
            </div>
          </>
        )}
        {hasDiscount && (
          <>
            <div className="discount-row">
              <span className="discount-label">
                Discount{order.couponCode ? ` (${order.couponCode})` : ""}:
              </span>
              <span className="discount-amount">
                -{formatCurrency(actualDiscount)} ({discountPercentage}%)
              </span>
            </div>
          </>
        )}
        <div className="total-row">
          <span className="total-label">TOTAL</span>
          <span className="total-amount">{formatCurrency(total)}</span>
        </div>
      </div>
      </div>

      <div className="footer-section">
        <p className="thank-you">Thanks for Purchasing from {vendorName}!</p>
      </div>
    </div>
  );
}
