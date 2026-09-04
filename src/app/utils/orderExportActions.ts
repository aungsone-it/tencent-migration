import { format } from "date-fns";
import { ordersApi } from "../../utils/api";
import { mapApiOrderToOrderItem, mapApiOrdersToOrderItems } from "./adminOrderMapper";
import { getOrderListRowKey } from "./normalizeOrderBadgeStatus";
import {
  buildOrderExportSpreadsheetHtml,
  type OrderExportInput,
} from "./orderExportCsv";
import { fetchAdminOrdersPage, type AdminOrdersPageParams } from "./module-cache";
import { extractOrderShippingFields, resolveOrderSellerId } from "./orderShippingAddress";

const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_PAGES = 1000;

export type AdminOrdersExportFilters = Pick<
  AdminOrdersPageParams,
  "q" | "status" | "payment" | "vendor" | "dateFrom" | "dateTo" | "sort"
>;

async function fetchAdminOrdersForExport(
  filters: AdminOrdersExportFilters,
): Promise<OrderExportInput[]> {
  const allRaw: Record<string, unknown>[] = [];
  let page = 1;

  while (page <= MAX_EXPORT_PAGES) {
    const payload = await fetchAdminOrdersPage({
      page,
      pageSize: EXPORT_PAGE_SIZE,
      status: filters.status || "all",
      payment: filters.payment || "all",
      vendor: filters.vendor || "all",
      dateFrom: filters.dateFrom || "",
      dateTo: filters.dateTo || "",
      q: filters.q || "",
      sort: filters.sort || "newest",
      bustCache: true,
    });
    const batch = Array.isArray(payload.orders)
      ? (payload.orders as Record<string, unknown>[])
      : [];
    allRaw.push(...batch);
    if (!payload.hasMore || batch.length === 0) break;
    page += 1;
  }

  return mapApiOrdersToOrderItems(allRaw) as OrderExportInput[];
}

export async function fetchAllAdminOrdersForExport(): Promise<OrderExportInput[]> {
  return fetchAdminOrdersForExport({
    status: "all",
    payment: "all",
    vendor: "all",
    sort: "newest",
  });
}

export async function fetchFilteredAdminOrdersForExport(
  filters: AdminOrdersExportFilters,
): Promise<OrderExportInput[]> {
  return fetchAdminOrdersForExport(filters);
}

export async function enrichOrdersForExport<T extends OrderExportInput>(
  rows: T[],
): Promise<T[]> {
  const enriched = [...rows];
  const missingSellerId = enriched.filter(
    (order) => !resolveOrderSellerId(order as Record<string, unknown>),
  );

  if (missingSellerId.length === 0) return enriched;

  await Promise.all(
    missingSellerId.map(async (order) => {
      const lookup = String(
        order.orderNumber || (order as { id?: string }).id || "",
      ).trim();
      if (!lookup) return;
      try {
        const response = await ordersApi.getById(lookup);
        const full = response?.order as Record<string, unknown> | undefined;
        if (!full) return;
        const shipping = extractOrderShippingFields(full);
        const sellerId = resolveOrderSellerId(full);
        if (!sellerId) return;
        const rowKey = getOrderListRowKey(order as { id?: string; orderNumber?: string });
        const idx = enriched.findIndex(
          (row) =>
            getOrderListRowKey(row as { id?: string; orderNumber?: string }) === rowKey,
        );
        if (idx < 0) return;
        enriched[idx] = {
          ...enriched[idx],
          sellerId,
          zipCode: shipping.zipCode || enriched[idx].zipCode,
          address: enriched[idx].address || shipping.address,
          city: enriched[idx].city || shipping.city,
          state: enriched[idx].state || shipping.state,
        };
      } catch {
        /* keep row without seller ID */
      }
    }),
  );

  return enriched;
}

export async function resolveSelectedOrdersForExport<
  T extends OrderExportInput & { id?: string; orderNumber?: string },
>(selectedRowKeys: string[], loadedOrders: T[]): Promise<T[]> {
  const selectedKeys = new Set(selectedRowKeys.map((key) => String(key || "").trim()).filter(Boolean));
  if (selectedKeys.size === 0) return [];

  const byKey = new Map<string, T>();
  for (const order of loadedOrders) {
    byKey.set(getOrderListRowKey(order), order);
  }

  const resolved: T[] = [];
  for (const key of selectedKeys) {
    const cached = byKey.get(key);
    if (cached) {
      resolved.push(cached);
      continue;
    }
    try {
      const response = await ordersApi.getById(key);
      const full = response?.order as Record<string, unknown> | undefined;
      if (!full) continue;
      resolved.push(mapApiOrderToOrderItem(full) as T);
    } catch {
      /* skip missing order */
    }
  }

  return resolved;
}

export function downloadOrderExportSpreadsheet(
  orders: OrderExportInput[],
  filenamePrefix: string,
): void {
  const spreadsheetHtml = buildOrderExportSpreadsheetHtml(orders);
  const blob = new Blob([spreadsheetHtml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}_${format(new Date(), "yyyy-MM-dd")}.xls`;
  a.click();
  window.URL.revokeObjectURL(url);
}
