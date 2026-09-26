import { vendorOrderGrandTotalDisplay } from "./vendorOrderTotals";
import { isVendorOrderAccrued } from "./vendorCommissionEarned";

/** Parse order timestamp for sorting / windows (ms). */
export function vendorOrderTimeMs(order: any): number {
  const t = order?.createdAt ?? order?.date;
  if (t == null || t === "") return 0;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Grand total for display — matches vendor orders list logic. */
export function vendorOrderDisplayTotal(order: any): number {
  const total =
    typeof order?.total === "number"
      ? order.total
      : parseFloat(String(order?.total ?? 0).replace(/[$,]/g, "")) || 0;
  const sub =
    order?.subtotal != null && order.subtotal !== ""
      ? parseFloat(String(order.subtotal).replace(/[$,]/g, ""))
      : undefined;
  const disc =
    order?.discount != null && order.discount !== ""
      ? parseFloat(String(order.discount).replace(/[$,]/g, ""))
      : undefined;
  return vendorOrderGrandTotalDisplay({ total, subtotal: sub, discount: disc });
}

export function isVendorOrderActive(order: any): boolean {
  const s = String(order?.status ?? "").toLowerCase();
  return s !== "cancelled";
}

/**
 * Revenue/commission accrue only after fulfillment pipeline reaches shippable/done states.
 * `inventoryDeducted === false` is set on every new order until the server successfully commits
 * stock at ready-to-ship/fulfilled — blocks stale/wrong statuses that never completed that commit.
 * Legacy rows may omit the field (`undefined`) and still accrue when status is accrued.
 */
export function isVendorOrderFinanciallyAccrued(order: any): boolean {
  return isVendorOrderAccrued(order);
}

export function daysForVendorDashboardLabel(label: string): number {
  switch (label) {
    case "Last 7 days":
      return 7;
    case "Last 30 days":
      return 30;
    case "Last 90 days":
      return 90;
    case "Last year":
      return 365;
    case "All time":
      return 36500;
    default:
      return 30;
  }
}

/** Same date windows as super-admin `dashboard/stats` (incl. custom `DashboardRange:…`). */
export function vendorDashboardDateRange(
  filter: string,
  endMs: number = Date.now()
): {
  startMs: number;
  endMs: number;
  compareStartMs: number;
  compareEndMs: number;
  isAllTime: boolean;
} {
  const custom = filter.match(/^DashboardRange:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (custom) {
    const [, ymdFrom, ymdTo] = custom;
    const startDate = new Date(`${ymdFrom}T00:00:00`);
    const endDate = new Date(`${ymdTo}T23:59:59.999`);
    const periodMs = Math.max(86400000, endDate.getTime() - startDate.getTime() + 1);
    const compareEnd = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate()
    );
    const compareStart = new Date(compareEnd.getTime() - periodMs);
    return {
      startMs: startDate.getTime(),
      endMs: endDate.getTime(),
      compareStartMs: compareStart.getTime(),
      compareEndMs: compareEnd.getTime(),
      isAllTime: false,
    };
  }

  const now = endMs;
  switch (filter) {
    case "Last 7 days":
      return {
        startMs: now - 7 * 86400000,
        endMs: now,
        compareStartMs: now - 14 * 86400000,
        compareEndMs: now - 7 * 86400000,
        isAllTime: false,
      };
    case "Last 90 days":
      return {
        startMs: now - 90 * 86400000,
        endMs: now,
        compareStartMs: now - 180 * 86400000,
        compareEndMs: now - 90 * 86400000,
        isAllTime: false,
      };
    case "Last year":
      return {
        startMs: now - 365 * 86400000,
        endMs: now,
        compareStartMs: now - 730 * 86400000,
        compareEndMs: now - 365 * 86400000,
        isAllTime: false,
      };
    case "All time":
      return { startMs: 0, endMs: now, compareStartMs: 0, compareEndMs: 0, isAllTime: true };
    case "Last 30 days":
    default:
      return {
        startMs: now - 30 * 86400000,
        endMs: now,
        compareStartMs: now - 60 * 86400000,
        compareEndMs: now - 30 * 86400000,
        isAllTime: false,
      };
  }
}

export function filterOrdersForDashboardPeriod(
  orders: any[],
  filter: string,
  endMs?: number
): any[] {
  const { startMs, endMs: end } = vendorDashboardDateRange(filter, endMs ?? Date.now());
  return orders.filter((o) => {
    if (!isVendorOrderActive(o)) return false;
    const ms = vendorOrderTimeMs(o);
    return ms >= startMs && ms <= end;
  });
}

export function filterOrdersForDashboardComparePeriod(
  orders: any[],
  filter: string,
  endMs?: number
): any[] {
  const range = vendorDashboardDateRange(filter, endMs ?? Date.now());
  if (range.isAllTime) return [];
  return orders.filter((o) => {
    if (!isVendorOrderActive(o)) return false;
    const ms = vendorOrderTimeMs(o);
    return ms >= range.compareStartMs && ms < range.compareEndMs;
  });
}

const SALES_TREND_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Mirrors super-admin home sales trend bucketing for vendor order lists. */
export function buildVendorSalesTrend(orders: any[], globalFilter: string): MonthlyPoint[] {
  const active = orders.filter(isVendorOrderActive);
  const range = vendorDashboardDateRange(globalFilter);

  if (globalFilter === "All time" || range.isAllTime) {
    const now = new Date();
    const series: MonthlyPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getTime();
      const monthEnd = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      ).getTime();
      let revenue = 0;
      let orderCount = 0;
      for (const o of active) {
        const ms = vendorOrderTimeMs(o);
        if (ms >= monthStart && ms <= monthEnd) {
          revenue += vendorOrderDisplayTotal(o);
          orderCount += 1;
        }
      }
      series.push({
        month: SALES_TREND_MONTH_NAMES[monthDate.getMonth()],
        revenue,
        orders: orderCount,
      });
    }
    return series;
  }

  const series: MonthlyPoint[] = [];
  const startDate = new Date(range.startMs);
  const endDate = new Date(range.endMs);
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  let n = 0;
  while (cursor.getTime() <= endDate.getTime() && n < 36) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    const sliceStart =
      monthStart.getTime() < range.startMs ? new Date(range.startMs) : monthStart;
    const sliceEnd = monthEnd.getTime() > range.endMs ? new Date(range.endMs) : monthEnd;
    let revenue = 0;
    let orderCount = 0;
    for (const o of active) {
      const ms = vendorOrderTimeMs(o);
      if (ms >= sliceStart.getTime() && ms <= sliceEnd.getTime()) {
        revenue += vendorOrderDisplayTotal(o);
        orderCount += 1;
      }
    }
    series.push({
      month: `${SALES_TREND_MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`,
      revenue,
      orders: orderCount,
    });
    cursor.setMonth(cursor.getMonth() + 1);
    n += 1;
  }
  return series;
}

/** Orders with order time in (endMs - days, endMs]. */
export function filterOrdersInRollingWindow(
  orders: any[],
  days: number,
  endMs: number
): any[] {
  const start = endMs - days * 24 * 60 * 60 * 1000;
  return orders.filter((o) => {
    const ms = vendorOrderTimeMs(o);
    return ms >= start && ms <= endMs;
  });
}

/** Previous window of same length immediately before `currentStart`. */
export function filterOrdersInPriorWindow(
  orders: any[],
  days: number,
  currentStartMs: number
): any[] {
  const end = currentStartMs;
  const start = currentStartMs - days * 24 * 60 * 60 * 1000;
  return orders.filter((o) => {
    const ms = vendorOrderTimeMs(o);
    return ms >= start && ms <= end;
  });
}

export function pctChangePriorWindow(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function sumOrderRevenue(orders: any[]): number {
  return orders.filter(isVendorOrderActive).reduce((s, o) => s + vendorOrderDisplayTotal(o), 0);
}

export function countActiveOrders(orders: any[]): number {
  return orders.filter(isVendorOrderActive).length;
}

export function uniqueCustomerEmails(orders: any[]): number {
  const set = new Set<string>();
  for (const o of orders) {
    if (!isVendorOrderActive(o)) continue;
    const e = String(o?.email ?? o?.customerEmail ?? "")
      .trim()
      .toLowerCase();
    if (e) set.add(e);
  }
  return set.size;
}

/** Line item product id for aggregation. */
function lineProductId(item: any): string {
  const id = item?.productId ?? item?.id;
  return id != null ? String(id) : "";
}

function lineProductName(item: any): string {
  return String(item?.productName ?? item?.name ?? "Product");
}

function linePrice(item: any): number {
  if (typeof item?.price === "number") return item.price;
  return parseFloat(String(item?.price ?? 0).replace(/[$,]/g, "")) || 0;
}

function lineQty(item: any): number {
  const q = item?.quantity ?? 1;
  const n = typeof q === "number" ? q : parseInt(String(q), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export type TopProductRow = { id: string; name: string; sales: number; revenue: number };

export function topProductsFromOrders(orders: any[], limit: number): TopProductRow[] {
  const map = new Map<string, { name: string; sales: number; revenue: number }>();
  for (const order of orders) {
    if (!isVendorOrderActive(order) || !Array.isArray(order.items)) continue;
    for (const item of order.items) {
      const pid = lineProductId(item);
      if (!pid) continue;
      const name = lineProductName(item);
      const qty = lineQty(item);
      const rev = linePrice(item) * qty;
      const cur = map.get(pid) || { name, sales: 0, revenue: 0 };
      cur.sales += qty;
      cur.revenue += rev;
      if (name && name !== "Product") cur.name = name;
      map.set(pid, cur);
    }
  }
  return Array.from(map.entries())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit);
}

export type RecentOrderRow = {
  id: string;
  customerName: string;
  items: number;
  total: number;
  status: string;
  date: string;
};

export function recentOrdersFromList(orders: any[], limit: number): RecentOrderRow[] {
  return [...orders]
    .sort((a, b) => vendorOrderTimeMs(b) - vendorOrderTimeMs(a))
    .slice(0, limit)
    .map((order: any) => ({
      id: order.id,
      customerName:
        order.customerName ||
        (typeof order.customer === "string" ? order.customer : "") ||
        order.name ||
        "Guest",
      items: Array.isArray(order.items) ? order.items.length : order.items ?? 0,
      total: vendorOrderDisplayTotal(order),
      status: order.status || "pending",
      date: order.createdAt || order.date || new Date().toISOString(),
    }));
}

export type MonthlyPoint = { month: string; revenue: number; orders: number };

/** Last `monthsBack` calendar months including current; buckets by YYYY-MM. */
export function buildMonthlySeries(orders: any[], monthsBack: number): MonthlyPoint[] {
  const active = orders.filter(isVendorOrderActive);
  const now = new Date();
  const series: { ym: number; month: string; revenue: number; orders: number }[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.getFullYear() * 100 + (d.getMonth() + 1);
    series.push({
      ym,
      month: d.toLocaleString("default", { month: "short", year: "numeric" }),
      revenue: 0,
      orders: 0,
    });
  }
  for (const o of active) {
    const dt = new Date(vendorOrderTimeMs(o));
    if (!Number.isFinite(dt.getTime())) continue;
    const ym = dt.getFullYear() * 100 + (dt.getMonth() + 1);
    const bucket = series.find((b) => b.ym === ym);
    if (bucket) {
      bucket.revenue += vendorOrderDisplayTotal(o);
      bucket.orders += 1;
    }
  }
  return series.map(({ month, revenue, orders: oc }) => ({ month, revenue, orders: oc }));
}

export function countProductsLikelyAddedInWindow(
  products: any[],
  startMs: number,
  endMs: number
): number {
  return products.filter((p) => {
    const t = p?.createdAt ?? p?.created_at ?? p?.updatedAt ?? p?.updated_at;
    if (!t) return false;
    const ms = new Date(t).getTime();
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  }).length;
}
