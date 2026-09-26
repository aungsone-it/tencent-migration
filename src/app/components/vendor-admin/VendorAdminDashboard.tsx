import { useState, useEffect, useMemo, useCallback } from "react";
import { Package, DollarSign, Users, ShoppingCart, TrendingUp, Calendar } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { StatCard } from "../StatCard";
import { AdminMmkAmount } from "../AdminMmkAmount";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { AdminDateRangeFilterPopover } from "../AdminDateRangeFilterPopover";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  encodeAdminDashboardDateFilter,
  getCachedVendorProductsAdmin,
  getCachedVendorProductsAdminPage,
  getCachedVendorOrders,
  moduleCache,
  CACHE_KEYS,
  vendorProductsAdminPageCacheKey,
  ADMIN_PRODUCTS_INITIAL_PAGE_SIZE,
} from "../../utils/module-cache";
import {
  vendorOrderDisplayTotal,
  isVendorOrderActive,
  pctChangePriorWindow,
  uniqueCustomerEmails,
  topProductsFromOrders,
  recentOrdersFromList,
  buildVendorSalesTrend,
  filterOrdersForDashboardPeriod,
  filterOrdersForDashboardComparePeriod,
  countProductsLikelyAddedInWindow,
  vendorDashboardDateRange,
  type TopProductRow,
  type RecentOrderRow,
} from "../../utils/vendorAdminAnalytics";
import { useLanguage } from "../../contexts/LanguageContext";

interface DashboardStats {
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  revenueChange: number;
  ordersChange: number;
  customersChange: number;
  productsChange: number;
}

interface VendorAdminDashboardProps {
  vendorId: string;
  vendorName: string;
  onNavigate: (page: string) => void;
  onPreviewStore?: (vendorId: string, storeSlug: string) => void;
}

function peekCachedVendorDashboardData(vendorId: string): { orders: any[]; productTotal: number } | null {
  const oPeek = moduleCache.peek<any[]>(CACHE_KEYS.vendorOrders(vendorId));
  const pPage = moduleCache.peek<{ total?: number }>(
    vendorProductsAdminPageCacheKey(vendorId, {
      page: 1,
      pageSize: ADMIN_PRODUCTS_INITIAL_PAGE_SIZE,
      q: "",
      status: "all",
      sort: "newest",
    })
  );
  if (oPeek != null && Array.isArray(oPeek)) {
    return {
      orders: oPeek,
      productTotal: typeof pPage?.total === "number" ? pPage.total : 0,
    };
  }
  return null;
}

function sumRevenue(orders: any[]): number {
  return orders.reduce((s, o) => s + vendorOrderDisplayTotal(o), 0);
}

export function VendorAdminDashboard({
  vendorId,
  vendorName,
  onNavigate,
}: VendorAdminDashboardProps) {
  const { t } = useLanguage();
  const cachedInit = peekCachedVendorDashboardData(vendorId);
  const [rawOrders, setRawOrders] = useState<any[]>(() => cachedInit?.orders ?? []);
  const [productTotal, setProductTotal] = useState(() => cachedInit?.productTotal ?? 0);
  const [rawProductsMeta, setRawProductsMeta] = useState<any[]>([]);
  const [loading, setLoading] = useState(() => cachedInit == null);

  const [pageDateRange, setPageDateRange] = useState<DateRange | undefined>(undefined);
  const [pageApiFilter, setPageApiFilter] = useState("All time");
  const [pageDatePickerOpen, setPageDatePickerOpen] = useState(false);

  useEffect(() => {
    if (!pageDateRange?.from) setPageApiFilter("All time");
    else if (pageDateRange.to) setPageApiFilter(encodeAdminDashboardDateFilter(pageDateRange));
  }, [pageDateRange]);

  const derived = useMemo(() => {
    const endMs = Date.now();
    const filter = pageApiFilter;
    const periodOrders = filterOrdersForDashboardPeriod(rawOrders, filter, endMs);
    const compareOrders = filterOrdersForDashboardComparePeriod(rawOrders, filter, endMs);

    const totalRevenue = sumRevenue(periodOrders);
    const totalOrders = periodOrders.length;
    const totalCustomers = uniqueCustomerEmails(periodOrders);

    const range = vendorDashboardDateRange(filter, endMs);
    const productsAddedCurrent = range.isAllTime
      ? productTotal
      : countProductsLikelyAddedInWindow(rawProductsMeta, range.startMs, range.endMs);
    const productsAddedPrev = range.isAllTime
      ? 0
      : countProductsLikelyAddedInWindow(
          rawProductsMeta,
          range.compareStartMs,
          range.compareEndMs
        );

    const stats: DashboardStats = {
      totalProducts: productTotal,
      totalOrders,
      totalRevenue,
      totalCustomers,
      revenueChange: pctChangePriorWindow(totalRevenue, sumRevenue(compareOrders)),
      ordersChange: pctChangePriorWindow(periodOrders.length, compareOrders.length),
      customersChange: pctChangePriorWindow(
        uniqueCustomerEmails(periodOrders),
        uniqueCustomerEmails(compareOrders)
      ),
      productsChange: range.isAllTime
        ? 0
        : pctChangePriorWindow(productsAddedCurrent, productsAddedPrev),
    };

    const sectionOrders = filterOrdersForDashboardPeriod(rawOrders, filter, endMs);
    const topProducts: TopProductRow[] = topProductsFromOrders(sectionOrders, 4);
    const recentOrders: RecentOrderRow[] = recentOrdersFromList(
      rawOrders.filter(isVendorOrderActive),
      5
    );
    const chartSeries = buildVendorSalesTrend(rawOrders, filter);

    return { stats, topProducts, recentOrders, chartSeries };
  }, [rawOrders, rawProductsMeta, productTotal, pageApiFilter]);

  const { stats, topProducts, recentOrders, chartSeries } = derived;

  const loadDashboardData = useCallback(
    async (forceRefresh = false) => {
      let showLoadingTimer: ReturnType<typeof setTimeout> | null = null;
      if (!forceRefresh && rawOrders.length === 0) {
        showLoadingTimer = setTimeout(() => setLoading(true), 300);
      } else if (forceRefresh) {
        showLoadingTimer = setTimeout(() => setLoading(true), 300);
      }

      try {
        const [orders, productsPage, productsMeta] = await Promise.all([
          getCachedVendorOrders(vendorId, forceRefresh).catch(() => [] as any[]),
          getCachedVendorProductsAdminPage(
            vendorId,
            { page: 1, pageSize: 1, status: "all", sort: "newest" },
            forceRefresh
          ).catch(() => ({ total: 0, products: [] as any[] })),
          getCachedVendorProductsAdmin(vendorId, forceRefresh).catch(() => ({
            products: [] as any[],
          })),
        ]);
        setRawOrders(Array.isArray(orders) ? orders : []);
        setProductTotal(Number(productsPage.total ?? 0));
        setRawProductsMeta(productsMeta.products || []);
      } catch (error) {
        console.error("Failed to load dashboard data:", error);
      } finally {
        if (showLoadingTimer) clearTimeout(showLoadingTimer);
        setLoading(false);
      }
    },
    [vendorId]
  );

  useEffect(() => {
    void loadDashboardData(true);
  }, [loadDashboardData]);

  useEffect(() => {
    const onOrdersUpdated = () => {
      void loadDashboardData(true);
    };
    window.addEventListener("adminOrdersUpdated", onOrdersUpdated);
    return () => window.removeEventListener("adminOrdersUpdated", onOrdersUpdated);
  }, [loadDashboardData]);

  const formatNumber = (num: number) => new Intl.NumberFormat().format(Math.round(num));

  const isAllTime = pageApiFilter === "All time";
  const formatChange = (change: number) => {
    if (isAllTime) return t("dashboard.changeAllTime");
    const sign = change >= 0 ? "+" : "";
    return `${sign}${change.toFixed(1)}% ${t("dashboard.vsPreviousPeriod")}`;
  };
  const changeType = (change: number): "positive" | "negative" | "neutral" => {
    if (isAllTime || change === 0) return "neutral";
    return change > 0 ? "positive" : "negative";
  };

  const salesChartData = useMemo(() => {
    return chartSeries.map((row) => ({
      month: row.month,
      revenue: Math.round(Number(row.revenue) || 0),
      orders: Math.round(Number(row.orders) || 0),
    }));
  }, [chartSeries]);

  const salesChartHasPoints = salesChartData.length > 0;
  const salesChartHasActivity = salesChartData.some((d) => d.revenue > 0 || d.orders > 0);

  if (loading && rawOrders.length === 0) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
            {t("vendorAdmin.dashboard.title")}
          </h1>
          <p className="text-slate-500 mt-1">
            {t("vendorAdmin.dashboard.subtitle").replace("{name}", vendorName)}
          </p>
        </div>
        <AdminDateRangeFilterPopover
          value={pageDateRange}
          onChange={setPageDateRange}
          hintText={t("dashboard.globalDateFilterHint")}
          titleText={t("dashboard.globalDateFilterTitle")}
          open={pageDatePickerOpen}
          onOpenChange={setPageDatePickerOpen}
          align="end"
          presentation="section-modal"
          showPresets
        >
          <Button
            variant="outline"
            size="sm"
            className="max-w-full border-slate-300 self-start font-normal sm:self-auto"
            disabled={loading}
            type="button"
          >
            <Calendar className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate text-left">
              {!pageDateRange?.from
                ? t("finances.allTime")
                : !pageDateRange.to
                  ? t("finances.selectEndDate")
                  : `${format(pageDateRange.from, "MMM d, yyyy")} – ${format(pageDateRange.to, "MMM d, yyyy")}`}
            </span>
          </Button>
        </AdminDateRangeFilterPopover>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatCard
          title={t("vendorAdmin.dashboard.totalRevenue")}
          value={loading ? "..." : <AdminMmkAmount value={stats.totalRevenue} />}
          change={loading ? "..." : formatChange(stats.revenueChange)}
          changeType={changeType(stats.revenueChange)}
          icon={DollarSign}
          iconBgColor="bg-gradient-to-br from-green-400 to-green-600"
          onClick={() => onNavigate("finances")}
        />
        <StatCard
          title={t("vendorAdmin.dashboard.orders")}
          value={loading ? "..." : formatNumber(stats.totalOrders)}
          change={loading ? "..." : formatChange(stats.ordersChange)}
          changeType={changeType(stats.ordersChange)}
          icon={ShoppingCart}
          iconBgColor="bg-gradient-to-br from-blue-400 to-blue-600"
          onClick={() => onNavigate("orders")}
        />
        <StatCard
          title={t("vendorAdmin.dashboard.customers")}
          value={loading ? "..." : formatNumber(stats.totalCustomers)}
          change={loading ? "..." : formatChange(stats.customersChange)}
          changeType={changeType(stats.customersChange)}
          icon={Users}
          iconBgColor="bg-gradient-to-br from-purple-400 to-purple-600"
          onClick={() => onNavigate("customers")}
        />
        <StatCard
          title={t("vendorAdmin.dashboard.products")}
          value={loading ? "..." : formatNumber(stats.totalProducts)}
          change={loading ? "..." : formatChange(stats.productsChange)}
          changeType={changeType(stats.productsChange)}
          icon={Package}
          iconBgColor="bg-gradient-to-br from-orange-400 to-orange-600"
          onClick={() => onNavigate("products")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900">{t("dashboard.salesOverview")}</h3>
            <p className="text-sm text-slate-500">{t("dashboard.salesOverviewDesc")}</p>
          </div>
          {loading && !salesChartHasPoints ? (
            <div className="h-[300px] flex items-center justify-center bg-slate-50 rounded-lg border border-slate-100">
              <p className="text-sm text-slate-400">{t("dashboard.loadingChart")}</p>
            </div>
          ) : !salesChartHasPoints ? (
            <div className="h-[300px] flex items-center justify-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
              <div className="text-center px-4">
                <TrendingUp className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">{t("dashboard.noSalesChartData")}</p>
              </div>
            </div>
          ) : (
            <div className="h-[300px] w-full min-h-[280px]">
              {!salesChartHasActivity && (
                <p className="text-xs text-slate-400 mb-2">{t("dashboard.salesChartFlatHint")}</p>
              )}
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={salesChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="vendorDashRevenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="month"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                  />
                  <YAxis
                    yAxisId="rev"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickFormatter={(v) => {
                      const n = Number(v);
                      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                      if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
                      return String(Math.round(n));
                    }}
                  />
                  <YAxis
                    yAxisId="ord"
                    orientation="right"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value: number | string, _name: string, item: { dataKey?: string }) => {
                      if (item?.dataKey === "revenue") {
                        return [
                          `${Math.round(Number(value)).toLocaleString()} MMK`,
                          t("dashboard.chartRevenueSeries"),
                        ];
                      }
                      if (item?.dataKey === "orders") {
                        return [Math.round(Number(value)), t("dashboard.chartOrdersSeries")];
                      }
                      return [String(value), _name];
                    }}
                    labelFormatter={(label) => String(label)}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Area
                    yAxisId="rev"
                    type="monotone"
                    dataKey="revenue"
                    name={t("dashboard.chartRevenueSeries")}
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="url(#vendorDashRevenueFill)"
                    dot={{ fill: "#2563eb", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="ord"
                    type="monotone"
                    dataKey="orders"
                    name={t("dashboard.chartOrdersSeries")}
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={{ fill: "#16a34a", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900">{t("dashboard.topProducts")}</h3>
            <p className="text-sm text-slate-500">{t("dashboard.topProductsDescGlobal")}</p>
          </div>
          {loading || topProducts.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              {loading ? t("dashboard.loadingChart") : t("vendorAdmin.dashboard.noData")}
            </div>
          ) : (
            <div className="space-y-4">
              {topProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center gap-4 p-3 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg flex items-center justify-center">
                    <Package className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">{product.name}</p>
                    <p className="text-sm text-slate-500">
                      {product.sales} {t("dashboard.sales")}
                    </p>
                  </div>
                  <div className="text-right">
                    <AdminMmkAmount value={product.revenue} size="md" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{t("vendorAdmin.dashboard.recentOrders")}</h3>
            <p className="text-sm text-slate-500">{t("dashboard.latestOrders")}</p>
          </div>
          <Button variant="outline" size="sm" type="button" onClick={() => onNavigate("orders")}>
            {t("dashboard.viewAll")}
          </Button>
        </div>
        {loading || recentOrders.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            {loading ? t("dashboard.loadingChart") : t("vendorAdmin.dashboard.noData")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">
                    {t("orders.order")}
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">
                    {t("vendorAdmin.users.customer")}
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">
                    {t("orders.items")}
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">
                    {t("orders.total")}
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">
                    {t("vendorAdmin.users.status")}
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">
                    {t("orders.date")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-4 px-4 text-sm font-medium text-slate-900">
                      #{order.id.slice(0, 8)}
                    </td>
                    <td className="py-4 px-4 text-sm text-slate-700">{order.customerName}</td>
                    <td className="py-4 px-4 text-sm text-slate-700">{order.items}</td>
                    <td className="py-4 px-4">
                      <AdminMmkAmount value={order.total} size="sm" />
                    </td>
                    <td className="py-4 px-4">
                      <Badge
                        variant="outline"
                        className={
                          order.status === "fulfilled" || order.status === "completed"
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : order.status === "pending"
                              ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                              : "bg-blue-100 text-blue-700 hover:bg-blue-100"
                        }
                      >
                        {order.status}
                      </Badge>
                    </td>
                    <td className="py-4 px-4 text-sm text-slate-600">
                      {new Date(order.date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
