import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import {
  DollarSign,
  ShoppingCart,
  Download,
  CreditCard,
  BadgePercent,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Loader2,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { publicAnonKey, cloudbaseApiBaseUrl, cloudbasePublishableKey, getCloudBaseRequestHeaders } from "../../../../utils/supabase/info";
import { API_BASE_URL } from "../../../utils/api-client";
import {
  getCachedVendorOrders,
  getCachedVendorProductsAdmin,
  ADMIN_PRODUCTS_INITIAL_PAGE_SIZE,
  moduleCache,
} from "../../utils/module-cache";
import { VendorAdminListingPagination } from "./VendorAdminListingPagination";
import {
  isVendorOrderActive,
  isVendorOrderFinanciallyAccrued,
  vendorOrderDisplayTotal,
  vendorOrderTimeMs,
  buildMonthlySeries,
  daysForVendorDashboardLabel,
  filterOrdersInRollingWindow,
  filterOrdersInPriorWindow,
  pctChangePriorWindow,
} from "../../utils/vendorAdminAnalytics";
import { computeVendorPayoutEarned } from "../../utils/vendorCommissionEarned";
import { formatOrderNumberDisplay } from "../../utils/orderNumber";
import { toast } from "sonner";

type FinancesDateFilterKey = "revenue" | "commission" | "orders" | "avgOrder";

function sumRevenueForOrders(orders: any[]): number {
  return orders.reduce((s, o) => s + vendorOrderDisplayTotal(o), 0);
}

interface VendorAdminFinancesProps {
  vendorId: string;
  vendorName: string;
  /** Used to load contract commission % from `vendors/by-slug`; falls back to `vendorId`. */
  vendorStoreSlug?: string;
}

interface Transaction {
  id: string;
  date: string;
  orderNumber: string;
  amount: number;
  status: "paid" | "pending" | "failed";
  paymentMethod: string;
}

interface VendorCommissionWallet {
  availableBalance: number;
  totalEarned: number;
  totalWithdrawn: number;
  minWithdrawAmount: number;
  kpayPhone: string;
  withdrawals: Array<{
    id: string;
    amount: number;
    kpayPhone: string;
    merchOrderId?: string;
    status: string;
    createdAt: string;
    paidAt?: string;
    errorMessage?: string;
  }>;
}

/** Tooltips / table: compact single-line label */
function mmkAmountString(n: number): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return `${Math.round(v).toLocaleString()} MMK`;
}

/** KPI cards: large number + visually small MMK */
function vendorFinancesStatMmk(n: number): ReactNode {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5">
      <span className="min-w-0 font-bold tabular-nums text-slate-900 [font-size:clamp(1rem,5cqi,1.25rem)]">
        {Math.round(v).toLocaleString()}
      </span>
      <span className="shrink-0 text-[0.5rem] font-normal uppercase tracking-wider text-slate-500 leading-none">
        MMK
      </span>
    </span>
  );
}

function transactionStatusFromOrder(order: any): "paid" | "pending" | "failed" {
  const s = String(order?.status ?? "").toLowerCase();
  if (s === "cancelled") return "failed";
  if (isVendorOrderFinanciallyAccrued(order)) return "paid";
  return "pending";
}

async function fetchVendorContractCommissionPercent(slugOrId: string | undefined): Promise<number> {
  const key = slugOrId?.trim();
  if (!key) return 15;
  try {
    const res = await fetch(
      `${API_BASE_URL}/vendors/by-slug/${encodeURIComponent(key)}`,
      { headers: { ...getCloudBaseRequestHeaders(),
 ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}) } }
    );
    if (!res.ok) return 15;
    const data = (await res.json()) as { vendor?: { commission?: unknown } };
    const c = data.vendor?.commission;
    if (c == null || c === "") return 15;
    const n = typeof c === "number" ? c : parseFloat(String(c));
    return Number.isFinite(n) && n >= 0 ? n : 15;
  } catch {
    return 15;
  }
}

export function VendorAdminFinances({
  vendorId,
  vendorName,
  vendorStoreSlug,
}: VendorAdminFinancesProps) {
  const ordersCacheKey = `vendor-orders-${vendorId}`;
  const productsCacheKey = `vendor-products-admin-${vendorId}`;
  const slugKey = (vendorStoreSlug && vendorStoreSlug.trim()) || vendorId;
  const contractPctCacheKey = `vendor-contract-commission-${slugKey}`;

  const cachedOrders = moduleCache.peek<any[]>(ordersCacheKey) ?? [];
  const cachedProductsPayload =
    moduleCache.peek<{ products?: any[] }>(productsCacheKey) ?? null;
  const cachedProducts = cachedProductsPayload?.products ?? [];
  const cachedContractPct = moduleCache.peek<number>(contractPctCacheKey);
  const hasWarmCache =
    moduleCache.has(ordersCacheKey) ||
    moduleCache.has(productsCacheKey) ||
    moduleCache.has(contractPctCacheKey);

  const [loading, setLoading] = useState(!hasWarmCache);
  const [timeFilter, setTimeFilter] = useState<"3months" | "6months" | "12months">("6months");
  const [rawOrders, setRawOrders] = useState<any[]>(cachedOrders);
  const [rawProducts, setRawProducts] = useState<any[]>(cachedProducts);
  const [vendorContractCommissionPct, setVendorContractCommissionPct] = useState(
    typeof cachedContractPct === "number" ? cachedContractPct : 15
  );
  const [txPage, setTxPage] = useState(1);
  const [txPageSize, setTxPageSize] = useState(ADMIN_PRODUCTS_INITIAL_PAGE_SIZE);
  const [withdrawHistoryPage, setWithdrawHistoryPage] = useState(1);
  const [withdrawHistoryPageSize, setWithdrawHistoryPageSize] = useState(10);
  const [dateFilter, setDateFilter] = useState({
    revenue: "Last 30 days",
    commission: "Last 30 days",
    orders: "Last 30 days",
    avgOrder: "Last 30 days",
  });
  const [wallet, setWallet] = useState<VendorCommissionWallet | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [kpayPhoneInput, setKpayPhoneInput] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

  const loadCommissionWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/vendor/commission-wallet/${encodeURIComponent(vendorId)}`,
        {
          headers: {
            ...getCloudBaseRequestHeaders(),
            ...(cloudbasePublishableKey
              ? { Authorization: `Bearer ${cloudbasePublishableKey}` }
              : {}),
          },
        },
      );
      if (!res.ok) throw new Error("Failed to load wallet");
      const data = (await res.json()) as { wallet?: VendorCommissionWallet };
      const next = data.wallet ?? null;
      setWallet(next);
      if (next?.kpayPhone) setKpayPhoneInput(next.kpayPhone);
    } catch (error) {
      console.error("Failed to load commission wallet:", error);
    } finally {
      setWalletLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void loadFinancialData(false);
    void loadCommissionWallet();
  }, [vendorId, vendorStoreSlug]);

  useEffect(() => {
    const onOrdersUpdated = () => {
      void loadFinancialData(true);
      void loadCommissionWallet();
    };
    window.addEventListener("adminOrdersUpdated", onOrdersUpdated);
    return () => window.removeEventListener("adminOrdersUpdated", onOrdersUpdated);
  }, [vendorId, vendorStoreSlug]);

  const loadFinancialData = async (forceRefresh = false) => {
    const hasWarmData = rawOrders.length > 0 || rawProducts.length > 0;
    if (!hasWarmData) setLoading(true);
    try {
      const [vendorOrders, productsPayload, contractPct] = await Promise.all([
        getCachedVendorOrders(vendorId, forceRefresh).catch(() => [] as any[]),
        getCachedVendorProductsAdmin(vendorId, forceRefresh).catch(() => ({ products: [] as any[] })),
        moduleCache.get(
          contractPctCacheKey,
          () => fetchVendorContractCommissionPercent(slugKey),
          forceRefresh
        ),
      ]);
      setRawOrders(Array.isArray(vendorOrders) ? vendorOrders : []);
      setRawProducts(productsPayload.products || []);
      setVendorContractCommissionPct(contractPct);
    } catch (error) {
      console.error("Failed to load financial data:", error);
      if (!hasWarmData) {
        setRawOrders([]);
        setRawProducts([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const { stats, revenueData, transactions } = useMemo(() => {
    const endMs = Date.now();
    const activePool = rawOrders.filter(isVendorOrderActive);

    const revDays = daysForVendorDashboardLabel(dateFilter.revenue);
    const commDays = daysForVendorDashboardLabel(dateFilter.commission);
    const ordDays = daysForVendorDashboardLabel(dateFilter.orders);
    const avgDays = daysForVendorDashboardLabel(dateFilter.avgOrder);

    const revCurrent = filterOrdersInRollingWindow(activePool, revDays, endMs);
    const revPrev = filterOrdersInPriorWindow(activePool, revDays, endMs - revDays * 86400000);
    const totalRevenue = sumRevenueForOrders(revCurrent);
    const revenueChange = pctChangePriorWindow(
      sumRevenueForOrders(revCurrent),
      sumRevenueForOrders(revPrev)
    );

    const commOrdersCurrent = filterOrdersInRollingWindow(rawOrders, commDays, endMs);
    const commOrdersPrev = filterOrdersInPriorWindow(rawOrders, commDays, endMs - commDays * 86400000);
    const commissionEarned = computeVendorPayoutEarned(
      commOrdersCurrent,
      rawProducts,
      vendorId,
      vendorContractCommissionPct
    );
    const commissionPrev = computeVendorPayoutEarned(
      commOrdersPrev,
      rawProducts,
      vendorId,
      vendorContractCommissionPct
    );
    const commissionChange = pctChangePriorWindow(commissionEarned, commissionPrev);

    const ordCurrent = filterOrdersInRollingWindow(activePool, ordDays, endMs);
    const ordPrev = filterOrdersInPriorWindow(activePool, ordDays, endMs - ordDays * 86400000);
    const ordersChange = pctChangePriorWindow(ordCurrent.length, ordPrev.length);

    const avgCurrent = filterOrdersInRollingWindow(activePool, avgDays, endMs);
    const avgPrev = filterOrdersInPriorWindow(activePool, avgDays, endMs - avgDays * 86400000);
    const averageOrderValue =
      avgCurrent.length > 0 ? sumRevenueForOrders(avgCurrent) / avgCurrent.length : 0;
    const averageOrderValuePrev =
      avgPrev.length > 0 ? sumRevenueForOrders(avgPrev) / avgPrev.length : 0;
    const avgOrderChange = pctChangePriorWindow(averageOrderValue, averageOrderValuePrev);

    const fullSeries = buildMonthlySeries(activePool, 12);
    const sliceN = timeFilter === "3months" ? 3 : timeFilter === "6months" ? 6 : 12;
    const chartSlice = fullSeries.slice(-sliceN);

    const trans: Transaction[] = [...activePool]
      .sort((a, b) => vendorOrderTimeMs(b) - vendorOrderTimeMs(a))
      .map((order: any) => ({
        id: order.id,
        date: new Date(vendorOrderTimeMs(order)).toLocaleDateString(),
        orderNumber: order.orderNumber || order.id,
        amount: vendorOrderDisplayTotal(order),
        status: transactionStatusFromOrder(order),
        paymentMethod: order.paymentMethod || "—",
      }));

    return {
      stats: {
        totalRevenue,
        revenueChange,
        commissionEarned,
        commissionChange,
        totalOrders: ordCurrent.length,
        ordersChange,
        averageOrderValue,
        avgOrderChange,
      },
      revenueData: chartSlice,
      transactions: trans,
    };
  }, [
    rawOrders,
    rawProducts,
    vendorId,
    vendorContractCommissionPct,
    timeFilter,
    dateFilter,
  ]);

  const chartRangeMonths =
    timeFilter === "3months" ? 3 : timeFilter === "6months" ? 6 : 12;

  const withdrawalRows = wallet?.withdrawals ?? [];

  const pagedWithdrawals = useMemo(() => {
    const start = (withdrawHistoryPage - 1) * withdrawHistoryPageSize;
    return withdrawalRows.slice(start, start + withdrawHistoryPageSize);
  }, [withdrawalRows, withdrawHistoryPage, withdrawHistoryPageSize]);

  useEffect(() => {
    setWithdrawHistoryPage(1);
  }, [withdrawalRows.length]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(withdrawalRows.length / withdrawHistoryPageSize) || 1);
    setWithdrawHistoryPage((p) => Math.min(p, tp));
  }, [withdrawalRows.length, withdrawHistoryPageSize]);

  useEffect(() => {
    setTxPage(1);
  }, [rawOrders.length, timeFilter, dateFilter]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(transactions.length / txPageSize) || 1);
    setTxPage((p) => Math.min(p, tp));
  }, [transactions.length, txPageSize]);

  const pagedTransactions = useMemo(() => {
    const start = (txPage - 1) * txPageSize;
    return transactions.slice(start, start + txPageSize);
  }, [transactions, txPage, txPageSize]);

  const handleWithdraw = async () => {
    const phone = kpayPhoneInput.trim();
    if (!phone) {
      toast.error("Enter your KBZPay phone number");
      return;
    }
    const available = wallet?.availableBalance ?? 0;
    const min = wallet?.minWithdrawAmount ?? 1;
    if (available < min) {
      toast.error(`Minimum withdrawable balance is ${min.toLocaleString()} MMK`);
      return;
    }

    setWithdrawing(true);
    try {
      const withdrawRes = await fetch(
        `${API_BASE_URL}/vendor/commission-withdraw/${encodeURIComponent(vendorId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getCloudBaseRequestHeaders(),
            ...(cloudbasePublishableKey
              ? { Authorization: `Bearer ${cloudbasePublishableKey}` }
              : {}),
          },
          body: JSON.stringify({ kpayPhone: phone }),
        },
      );
      const rawText = await withdrawRes.text().catch(() => "");
      let payload = {} as {
        success?: boolean;
        pending?: boolean;
        error?: string;
        message?: string;
        wallet?: VendorCommissionWallet;
        withdrawal?: VendorCommissionWallet["withdrawals"][number];
      };
      if (rawText) {
        try {
          payload = JSON.parse(rawText) as typeof payload;
        } catch {
          // ignore malformed body
        }
      }

      if (payload.wallet) {
        setWallet(payload.wallet);
      } else {
        await loadCommissionWallet();
      }

      if (!withdrawRes.ok || payload.success === false) {
        const serverMsg =
          payload.error ||
          payload.message ||
          (withdrawRes.status === 502
            ? "Payout server returned 502 — redeploy make-server-16010b6f with the latest code."
            : withdrawRes.statusText || "Withdrawal failed");
        throw new Error(serverMsg);
      }

      if (payload.pending) {
        toast.success(payload.message || "Payout submitted — KBZPay is processing");
      } else {
        toast.success(payload.message || "Commission sent to your KBZPay wallet");
      }
      setWithdrawOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Withdrawal failed";
      if (/failed to fetch|fetch failed|networkerror|load failed/i.test(msg)) {
        toast.error(
          "Could not reach the payout server. Redeploy make-server-16010b6f with the latest code, then try again.",
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setWithdrawing(false);
    }
  };

  const StatCard = ({
    title,
    value,
    change,
    icon: Icon,
    iconBg,
    iconColor,
    filterKey,
  }: {
    title: string;
    value: ReactNode;
    change: number;
    icon: typeof DollarSign;
    iconBg: string;
    iconColor: string;
    filterKey: FinancesDateFilterKey;
  }) => (
    <Card className="@container p-5 border-slate-200 bg-white hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-slate-600 font-medium mb-1">{title}</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors mb-4"
              >
                {dateFilter[filterKey]} <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => setDateFilter({ ...dateFilter, [filterKey]: "Last 7 days" })}
              >
                Last 7 days
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDateFilter({ ...dateFilter, [filterKey]: "Last 30 days" })}
              >
                Last 30 days
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDateFilter({ ...dateFilter, [filterKey]: "Last 90 days" })}
              >
                Last 90 days
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDateFilter({ ...dateFilter, [filterKey]: "Last year" })}
              >
                Last year
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="mb-2 min-w-0">{value}</div>
          <div className="flex items-center gap-1">
            {change === 0 ? (
              <span className="text-xs font-medium text-slate-500">No change vs prior period</span>
            ) : (
              <>
                {change > 0 ? (
                  <ArrowUpRight className="w-3.5 h-3.5 text-green-600 shrink-0" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5 text-red-600 shrink-0" />
                )}
                <span
                  className={`text-xs font-medium ${change > 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {change > 0 ? "+" : ""}
                  {change}% vs prior period
                </span>
              </>
            )}
          </div>
        </div>
        <div className={`${iconBg} p-2 rounded-full ml-4 flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      </div>
    </Card>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-40" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-6 w-28" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <Skeleton className="h-9 w-9 rounded-full" />
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-6 border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-72" />
            </div>
            <div className="flex gap-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-12" />
              ))}
            </div>
          </div>
          <Skeleton className="h-[300px] w-full rounded-lg" />
        </Card>

        <Card className="p-6 border-slate-200">
          <Skeleton className="h-6 w-40 mb-2" />
          <Skeleton className="h-4 w-56 mb-6" />
          <Skeleton className="h-[300px] w-full rounded-lg" />
        </Card>

        <Card className="p-6 border-slate-200">
          <Skeleton className="h-6 w-48 mb-4" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Finances</h1>
          <p className="text-slate-600">
            Track revenue and transactions for {vendorName}
          </p>
        </div>
        <Button variant="outline" disabled className="opacity-50 cursor-not-allowed">
          <Download className="w-4 h-4 mr-2" />
          Export Report (Disabled)
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Revenue"
          value={vendorFinancesStatMmk(stats.totalRevenue)}
          change={stats.revenueChange}
          icon={DollarSign}
          iconBg="bg-green-100"
          iconColor="text-green-600"
          filterKey="revenue"
        />
        <Card className="@container p-5 border-slate-200 bg-white hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-600 font-medium mb-1">Commission Earned</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors mb-4"
                  >
                    {dateFilter.commission} <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => setDateFilter({ ...dateFilter, commission: "Last 7 days" })}
                  >
                    Last 7 days
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDateFilter({ ...dateFilter, commission: "Last 30 days" })}
                  >
                    Last 30 days
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDateFilter({ ...dateFilter, commission: "Last 90 days" })}
                  >
                    Last 90 days
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDateFilter({ ...dateFilter, commission: "Last year" })}
                  >
                    Last year
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="mb-2 min-w-0">{vendorFinancesStatMmk(stats.commissionEarned)}</div>
              <div className="flex items-center gap-1 mb-3">
                {stats.commissionChange === 0 ? (
                  <span className="text-xs font-medium text-slate-500">No change vs prior period</span>
                ) : (
                  <>
                    {stats.commissionChange > 0 ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-green-600 shrink-0" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    )}
                    <span
                      className={`text-xs font-medium ${stats.commissionChange > 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {stats.commissionChange > 0 ? "+" : ""}
                      {stats.commissionChange}% vs prior period
                    </span>
                  </>
                )}
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600">Available to withdraw</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {walletLoading
                      ? "…"
                      : `${Math.round(wallet?.availableBalance ?? 0).toLocaleString()} MMK`}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={withdrawing}
                  onClick={() => {
                    if (wallet?.kpayPhone) setKpayPhoneInput(wallet.kpayPhone);
                    setWithdrawOpen(true);
                  }}
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Withdraw to KBZPay
                </Button>
                {!walletLoading && (wallet?.availableBalance ?? 0) <= 0 && (
                    <p className="text-[11px] text-amber-700 leading-snug">
                      Withdrawals use ready-to-ship &amp; fulfilled order earnings (minimum{" "}
                      {(wallet?.minWithdrawAmount ?? 1).toLocaleString()} MMK).
                    </p>
                  )}
              </div>
            </div>
            <div className="bg-blue-100 p-2 rounded-full ml-4 flex-shrink-0">
              <BadgePercent className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </Card>
        <StatCard
          title="Total Orders"
          value={stats.totalOrders}
          change={stats.ordersChange}
          icon={ShoppingCart}
          iconBg="bg-purple-100"
          iconColor="text-purple-600"
          filterKey="orders"
        />
        <StatCard
          title="Avg Order Value"
          value={vendorFinancesStatMmk(stats.averageOrderValue)}
          change={stats.avgOrderChange}
          icon={CreditCard}
          iconBg="bg-orange-100"
          iconColor="text-orange-600"
          filterKey="avgOrder"
        />
      </div>

      <Card className="p-6 border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Revenue Overview</h3>
            <p className="text-sm text-slate-600">
              Monthly revenue (each KPI card uses its own period above; chart shows last{" "}
              {chartRangeMonths} months)
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant={timeFilter === "3months" ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeFilter("3months")}
              className={timeFilter === "3months" ? "bg-slate-900 hover:bg-black text-white" : ""}
            >
              3M
            </Button>
            <Button
              variant={timeFilter === "6months" ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeFilter("6months")}
              className={timeFilter === "6months" ? "bg-slate-900 hover:bg-black text-white" : ""}
            >
              6M
            </Button>
            <Button
              variant={timeFilter === "12months" ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeFilter("12months")}
              className={timeFilter === "12months" ? "bg-slate-900 hover:bg-black text-white" : ""}
            >
              12M
            </Button>
          </div>
        </div>

        {revenueData.length > 0 && revenueData.some((d) => d.revenue > 0) ? (
          <div className="h-64 w-full min-h-[256px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  tickFormatter={(v) => {
                    const n = Number(v);
                    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                    if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
                    return String(Math.round(n));
                  }}
                />
                <Tooltip
                  formatter={(value: number | string) => [
                    mmkAmountString(Number(value)),
                    "Revenue",
                  ]}
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue (MMK)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ fill: "#3b82f6", r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-64 flex items-center justify-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 text-slate-500 text-sm">
            No revenue in this chart range
          </div>
        )}
      </Card>

      <Card className="p-6 border-slate-200">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Orders by Month</h3>
          <p className="text-sm text-slate-600">
            Order count per month (same {chartRangeMonths}-month window as revenue chart)
          </p>
        </div>
        {revenueData.length > 0 && revenueData.some((d) => d.orders > 0) ? (
          <div className="h-64 w-full min-h-[256px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="orders" fill="#8b5cf6" radius={[8, 8, 0, 0]} name="Orders" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-64 flex items-center justify-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 text-slate-500 text-sm">
            No orders in this chart range
          </div>
        )}
      </Card>

      <Card className="p-6 border-slate-200">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Withdrawal history</h3>
          <p className="text-sm text-slate-600">
            Permanent record of every KBZPay commission payout ({withdrawalRows.length} total)
          </p>
        </div>
        {withdrawalRows.length > 0 ? (
          <>
            <div className="space-y-2">
              {pagedWithdrawals.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-3 p-3 border border-slate-200 rounded-lg"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 tabular-nums">
                      {Math.round(row.amount).toLocaleString()} MMK → {row.kpayPhone}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(row.createdAt).toLocaleString()}
                      {row.paidAt ? ` · Paid ${new Date(row.paidAt).toLocaleString()}` : ""}
                    </p>
                    {row.merchOrderId ? (
                      <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">
                        Ref: {row.merchOrderId}
                      </p>
                    ) : null}
                    {row.errorMessage ? (
                      <p className="text-xs text-red-600 mt-1">{row.errorMessage}</p>
                    ) : null}
                  </div>
                  <Badge
                    className={
                      row.status === "paid"
                        ? "bg-green-100 text-green-700 border-green-200 shrink-0"
                        : row.status === "failed"
                          ? "bg-red-100 text-red-700 border-red-200 shrink-0"
                          : "bg-yellow-100 text-yellow-700 border-yellow-200 shrink-0"
                    }
                  >
                    {row.status}
                  </Badge>
                </div>
              ))}
            </div>
            <VendorAdminListingPagination
              variant="cardFooter"
              page={withdrawHistoryPage}
              pageSize={withdrawHistoryPageSize}
              totalCount={withdrawalRows.length}
              onPageChange={setWithdrawHistoryPage}
              onPageSizeChange={setWithdrawHistoryPageSize}
              itemLabel="withdrawals"
              loading={walletLoading}
            />
          </>
        ) : (
          <div className="text-center py-10 text-slate-500 text-sm border border-dashed border-slate-200 rounded-lg bg-slate-50">
            No withdrawals yet. Each payout you make will appear here permanently.
          </div>
        )}
      </Card>

      <Card className="border-slate-200 overflow-hidden p-0 shadow-sm">
        <div className="px-6 pt-6 pb-2">
          <h3 className="text-lg font-semibold text-slate-900">Recent Transactions</h3>
        </div>
        <div className="px-6 space-y-3 pb-2">
          {transactions.length > 0 ? (
            pagedTransactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                    <CreditCard className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{formatOrderNumberDisplay(transaction.orderNumber)}</p>
                    <p className="text-sm text-slate-600 truncate">
                      {transaction.date} • {transaction.paymentMethod}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <Badge
                    className={
                      transaction.status === "paid"
                        ? "bg-green-100 text-green-700 border-green-200"
                        : transaction.status === "pending"
                          ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                          : "bg-red-100 text-red-700 border-red-200"
                    }
                  >
                    {transaction.status}
                  </Badge>
                  <div className="flex min-w-[100px] items-baseline justify-end gap-1 tabular-nums">
                    <span className="font-semibold text-slate-900">
                      {Math.round(transaction.amount).toLocaleString()}
                    </span>
                    <span className="text-[0.5rem] font-normal uppercase tracking-wider text-slate-500">
                      MMK
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-slate-500">No transactions yet</div>
          )}
        </div>
        {transactions.length > 0 && (
          <VendorAdminListingPagination
            variant="cardFooter"
            page={txPage}
            pageSize={txPageSize}
            totalCount={transactions.length}
            onPageChange={setTxPage}
            onPageSizeChange={setTxPageSize}
            itemLabel="transactions"
            loading={loading}
          />
        )}
      </Card>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw commission to KBZPay</DialogTitle>
            <DialogDescription>
              Enter your KBZPay wallet phone number. Eligible earnings include ready-to-ship and
              fulfilled orders. Payout is sent automatically via KBZ Enterprise Payment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
              <p className="text-slate-600">Available balance</p>
              <p className="text-xl font-semibold text-slate-900 tabular-nums">
                {Math.round(wallet?.availableBalance ?? 0).toLocaleString()} MMK
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Minimum withdrawal: {(wallet?.minWithdrawAmount ?? 1).toLocaleString()} MMK
              </p>
            </div>
            <div>
              <Label htmlFor="kpay-phone">KBZPay phone number</Label>
              <Input
                id="kpay-phone"
                placeholder="09xxxxxxxxx"
                value={kpayPhoneInput}
                onChange={(e) => setKpayPhoneInput(e.target.value)}
                className="mt-1.5"
                disabled={withdrawing}
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Myanmar mobile number linked to the vendor&apos;s KBZPay wallet.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawOpen(false)} disabled={withdrawing}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleWithdraw()}
              disabled={
                withdrawing ||
                (wallet?.availableBalance ?? 0) < (wallet?.minWithdrawAmount ?? 1)
              }
            >
              {withdrawing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Wallet className="w-4 h-4 mr-2" />
                  Withdraw now
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
