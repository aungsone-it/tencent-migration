// Dashboard Component - Main dashboard view
import { DollarSign, ShoppingCart, Users, Package, TrendingUp, Calendar } from "lucide-react";
import { StatCard } from "./StatCard";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { AdminDateRangeFilterPopover } from "./AdminDateRangeFilterPopover";
import { useLanguage } from "../contexts/LanguageContext";
import { devLog } from "../utils/devLog";
import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router";
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
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import {
  getCachedAdminDashboardStats,
  getCachedAdminOrdersPage,
  getCachedAdminCustomersPage,
  getCachedAdminProductsPage,
  invalidateAdminDashboardStatsCaches,
  moduleCache,
  adminDashboardStatsCacheKey,
  encodeAdminDashboardDateFilter,
  type AdminDashboardFilters,
} from "../utils/module-cache";
import { adminOrdersUpdatedStorageKey } from "../utils/adminOrdersRealtime";
import { CUSTOMERS_DATA_UPDATED_EVENT } from "../utils/customersRealtime";
const defaultStats = {
  totalRevenue: 0,
  totalOrders: 0,
  totalCustomers: 0,
  totalProducts: 0,
  revenueChange: 0,
  ordersChange: 0,
  customersChange: 0,
  productsChange: 0,
  salesTrend: [] as any[],
  topProducts: [] as any[],
  recentOrders: [] as any[],
};

function normalizeDashboardStatsPayload(data: Record<string, unknown>) {
  return {
    totalRevenue: (data.totalRevenue as number) || 0,
    totalOrders: (data.totalOrders as number) || 0,
    totalCustomers: (data.totalCustomers as number) || 0,
    totalProducts: (data.totalProducts as number) || 0,
    revenueChange: (data.revenueChange as number) || 0,
    ordersChange: (data.ordersChange as number) || 0,
    customersChange: (data.customersChange as number) || 0,
    productsChange: (data.productsChange as number) || 0,
    salesTrend: Array.isArray(data.salesTrend) ? data.salesTrend : [],
    topProducts: Array.isArray(data.topProducts) ? data.topProducts : [],
    recentOrders: Array.isArray(data.recentOrders) ? data.recentOrders : [],
  };
}

export function Dashboard() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const allTimeFilters = useMemo(
    (): AdminDashboardFilters => ({
      revenue: "All time",
      orders: "All time",
      customers: "All time",
      products: "All time",
      globalSection: "All time",
    }),
    []
  );
  const initialStatsPayload = useMemo(
    () => moduleCache.peek<Record<string, unknown>>(adminDashboardStatsCacheKey(allTimeFilters)),
    [allTimeFilters]
  );
  const [stats, setStats] = useState(() =>
    initialStatsPayload ? normalizeDashboardStatsPayload(initialStatsPayload) : defaultStats
  );
  const [loading, setLoading] = useState(
    () => !initialStatsPayload
  );
  const [pageDateRange, setPageDateRange] = useState<DateRange | undefined>(undefined);
  const [pageApiFilter, setPageApiFilter] = useState("All time");
  const [pageDatePickerOpen, setPageDatePickerOpen] = useState(false);

  useEffect(() => {
    if (!pageDateRange?.from) setPageApiFilter("All time");
    else if (pageDateRange.to) setPageApiFilter(encodeAdminDashboardDateFilter(pageDateRange));
  }, [pageDateRange]);

  const filterPayload = useMemo(
    (): AdminDashboardFilters => ({
      revenue: pageApiFilter,
      orders: pageApiFilter,
      customers: pageApiFilter,
      products: pageApiFilter,
      globalSection: pageApiFilter,
    }),
    [pageApiFilter]
  );

  const orderDateFromParam = pageDateRange?.from ? format(pageDateRange.from, "yyyy-MM-dd") : "";
  const orderDateToParam = pageDateRange?.to
    ? format(pageDateRange.to, "yyyy-MM-dd")
    : orderDateFromParam;

  const fetchDashboardStats = useCallback(
    async (forceRefresh = false) => {
      let showLoadingTimer: ReturnType<typeof setTimeout> | null = null;
      showLoadingTimer = setTimeout(() => {
        setLoading(true);
      }, 300);

      try {
        if (forceRefresh) {
          invalidateAdminDashboardStatsCaches();
        }

        const [dash, ordersPage, customersPage, productsPage] = await Promise.all([
          getCachedAdminDashboardStats(filterPayload, true),
          getCachedAdminOrdersPage(
            {
              page: 1,
              pageSize: 1,
              status: "all",
              payment: "all",
              vendor: "all",
              dateFrom: orderDateFromParam,
              dateTo: orderDateToParam,
              sort: "newest",
            },
            true
          ),
          getCachedAdminCustomersPage(
            { page: 1, pageSize: 1, status: "all", tier: "all", segment: "all" },
            true
          ),
          getCachedAdminProductsPage(
            { page: 1, pageSize: 1, tab: "all", status: "all", sort: "newest" },
            true
          ),
        ]);

        if (dash.cached) {
          devLog(
            `⚡ Dashboard charts loaded from SERVER CACHE (age: ${dash.cacheAge}s)`
          );
        }

        const chartStats = normalizeDashboardStatsPayload(dash);
        setStats({
          ...chartStats,
          totalRevenue: Number(ordersPage.aggregates?.filteredTotalRevenue ?? 0),
          totalOrders: Number(ordersPage.total ?? 0),
          totalCustomers: Number(customersPage.stats?.total ?? customersPage.total ?? 0),
          totalProducts: Number(productsPage.counts?.all ?? productsPage.total ?? 0),
        });
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
      } finally {
        if (showLoadingTimer) {
          clearTimeout(showLoadingTimer);
        }
        setLoading(false);
      }
    },
    [filterPayload, orderDateFromParam, orderDateToParam]
  );

  useEffect(() => {
    void fetchDashboardStats(true);
  }, [fetchDashboardStats]);

  useEffect(() => {
    const refresh = () => {
      void fetchDashboardStats(true);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== adminOrdersUpdatedStorageKey()) return;
      refresh();
    };
    window.addEventListener("adminOrdersUpdated", refresh);
    window.addEventListener(CUSTOMERS_DATA_UPDATED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("adminOrdersUpdated", refresh);
      window.removeEventListener(CUSTOMERS_DATA_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [fetchDashboardStats]);
  
  // Format number with commas
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(Math.round(num));
  };
  
  // Format currency - Myanmar Kyat (MMK)
  const formatCurrency = (num: number | null | undefined): ReactNode => {
    const amount = num === null || num === undefined || isNaN(num) ? 0 : num;
    return (
      <span className="inline-flex items-baseline gap-1">
        <span>{amount.toLocaleString()}</span>
        <span className="text-[0.4rem] font-semibold uppercase tracking-wide text-slate-500">MMK</span>
      </span>
    );
  };
  
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
    const rows = stats.salesTrend as { name: string; sales: number; orders: number }[];
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      month: row.name,
      revenue: Math.round(Number(row.sales) || 0),
      orders: Math.round(Number(row.orders) || 0),
    }));
  }, [stats.salesTrend]);

  const salesChartHasPoints = salesChartData.length > 0;
  const salesChartHasActivity = salesChartData.some((d) => d.revenue > 0 || d.orders > 0);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("dashboard.analytics")}</h1>
          <p className="text-slate-500 mt-1">{t('dashboard.welcome').replace('{name}', 'Aung Sone')}</p>
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatCard
          title={t('dashboard.totalRevenue')}
          value={loading ? "..." : formatCurrency(stats.totalRevenue)}
          change={loading ? "..." : formatChange(stats.revenueChange)}
          changeType={changeType(stats.revenueChange)}
          icon={DollarSign}
          iconBgColor="bg-gradient-to-br from-green-400 to-green-600"
          onClick={() => navigate("/admin/finances")}
        />
        <StatCard
          title={t('dashboard.orders')}
          value={loading ? "..." : formatNumber(stats.totalOrders)}
          change={loading ? "..." : formatChange(stats.ordersChange)}
          changeType={changeType(stats.ordersChange)}
          icon={ShoppingCart}
          iconBgColor="bg-gradient-to-br from-blue-400 to-blue-600"
          onClick={() => navigate("/admin/orders")}
        />
        <StatCard
          title={t('dashboard.customers')}
          value={loading ? "..." : formatNumber(stats.totalCustomers)}
          change={loading ? "..." : formatChange(stats.customersChange)}
          changeType={changeType(stats.customersChange)}
          icon={Users}
          iconBgColor="bg-gradient-to-br from-purple-400 to-purple-600"
          onClick={() => navigate("/admin/customers")}
        />
        <StatCard
          title={t('dashboard.products')}
          value={loading ? "..." : formatNumber(stats.totalProducts)}
          change={loading ? "..." : formatChange(stats.productsChange)}
          changeType={changeType(stats.productsChange)}
          icon={Package}
          iconBgColor="bg-gradient-to-br from-orange-400 to-orange-600"
          onClick={() => navigate("/admin/products")}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900">{t('dashboard.salesOverview')}</h3>
            <p className="text-sm text-slate-500">{t('dashboard.salesOverviewDesc')}</p>
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
                    <linearGradient id="dashRevenueFill" x1="0" y1="0" x2="0" y2="1">
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
                    fill="url(#dashRevenueFill)"
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

        {/* Top Products */}
        <Card className="p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900">{t('dashboard.topProducts')}</h3>
            <p className="text-sm text-slate-500">{t("dashboard.topProductsDescGlobal")}</p>
          </div>
          {loading || stats.topProducts.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              {loading ? "Loading..." : "No products data available"}
            </div>
          ) : (
            <div className="space-y-4">
              {stats.topProducts.map((product, index) => (
                <div key={index} className="flex items-center gap-4 p-3 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg flex items-center justify-center">
                    <Package className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">{product.name}</p>
                    <p className="text-sm text-slate-500">{product.sales} {t('dashboard.sales')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold text-slate-900">{formatCurrency(product.revenue)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent Orders */}
      <Card className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{t('dashboard.recentOrders')}</h3>
            <p className="text-sm text-slate-500">{t('dashboard.latestOrders')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/admin/orders")}
          >
            {t('dashboard.viewAll')}
          </Button>
        </div>
        {loading || stats.recentOrders.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            {loading ? "Loading..." : "No recent orders"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">{t('dashboard.orderId')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">{t('dashboard.customer')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">{t('dashboard.product')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">{t('dashboard.amount')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">{t('dashboard.status')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentOrders.map((order) => (
                  <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-4 text-sm font-medium text-slate-900">{order.id}</td>
                    <td className="py-4 px-4 text-sm text-slate-700">{typeof order.customer === 'string' ? order.customer : (order.customer?.fullName || order.customer?.name || 'Guest Customer')}</td>
                    <td className="py-4 px-4 text-sm text-slate-700">{order.product}</td>
                    <td className="py-4 px-4 text-sm font-semibold text-slate-900">{formatCurrency(order.amount)}</td>
                    <td className="py-4 px-4">
                      <Badge 
                        variant={
                          order.status === "completed" ? "default" : 
                          order.status === "processing" ? "secondary" : 
                          "outline"
                        }
                        className={
                          order.status === "completed" ? "bg-green-100 text-green-700 hover:bg-green-100" : 
                          order.status === "processing" ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : 
                          "bg-amber-100 text-amber-700 hover:bg-amber-100"
                        }
                      >
                        {order.status}
                      </Badge>
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