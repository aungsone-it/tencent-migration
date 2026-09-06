import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  fetchOrphanedPwaDrafts,
  finalizePwaCheckoutOrderApi,
  hydrateOrphanedPwaDrafts,
  invalidateOrphanedPwaDraftsCache,
  keepPaidOrphanedPwaDrafts,
  mergeOrphanedPwaDraftRows,
  probeRecentOrphanedPwaDrafts,
  type OrphanedPwaDraftRow,
} from "../utils/kpayClient";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { normalizeOrderNumberSearch, formatOrderNumberDisplay } from "../utils/orderNumber";

function formatDraftOrderDate(savedAt?: string): string {
  if (!savedAt) return "—";
  const ms = Date.parse(savedAt);
  if (!Number.isFinite(ms)) return savedAt;
  return new Date(ms).toISOString().split("T")[0];
}

type PwaOrphanedOrdersRecoveryProps = {
  /** Limit list to one vendor (vendor admin). */
  vendorId?: string;
  /** Super-admin: query each store the same way vendor admin does. */
  vendorIds?: string[];
  /** Latest storefront order numbers so super-admin can probe nearby NOS- drafts. */
  anchorOrderNumbers?: string[];
  /** When user searches an order id, surface a matching draft if the list is empty. */
  searchQuery?: string;
  /** Called after an order was recovered so parent lists can refresh. */
  onRecovered?: (order?: Record<string, unknown>) => void;
  compact?: boolean;
};

export function PwaOrphanedOrdersRecovery({
  vendorId,
  vendorIds = [],
  anchorOrderNumbers = [],
  searchQuery = "",
  onRecovered,
  compact = false,
}: PwaOrphanedOrdersRecoveryProps) {
  const [drafts, setDrafts] = useState<OrphanedPwaDraftRow[]>([]);
  const [checked, setChecked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const hasLoadedOnceRef = useRef(false);

  const searchOrderId = useMemo(
    () => normalizeOrderNumberSearch(searchQuery),
    [searchQuery],
  );

  const anchorKey = anchorOrderNumbers
    .map((id) => String(id || "").trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 8)
    .join("|");
  const scopedAnchors = useMemo(
    () => (anchorKey ? anchorKey.split("|") : []),
    [anchorKey],
  );

  const loadDrafts = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) {
      setRefreshing(true);
    }
    try {
      const request = {
        minAgeMinutes: 0,
        limit: 50,
        merchantOrderId: searchOrderId || undefined,
        skipCache: true as const,
      };
      let rows: OrphanedPwaDraftRow[] = [];
      if (vendorId) {
        const [fromVendor, fromProbe] = await Promise.all([
          fetchOrphanedPwaDrafts({ ...request, vendorId, timeoutMs: 25_000 }),
          scopedAnchors.length > 0 || searchOrderId
            ? probeRecentOrphanedPwaDrafts(
                searchOrderId
                  ? scopedAnchors.length > 0
                    ? [searchOrderId, ...scopedAnchors]
                    : [searchOrderId]
                  : scopedAnchors,
              )
            : Promise.resolve([]),
        ]);
        rows = mergeOrphanedPwaDraftRows([...fromVendor, ...fromProbe]);
      } else {
        const [fromGlobal, fromProbe] = await Promise.all([
          fetchOrphanedPwaDrafts({ ...request, timeoutMs: 25_000 }),
          scopedAnchors.length > 0 || searchOrderId
            ? probeRecentOrphanedPwaDrafts(
                searchOrderId
                  ? scopedAnchors.length > 0
                    ? [searchOrderId, ...scopedAnchors]
                    : [searchOrderId]
                  : scopedAnchors,
              )
            : Promise.resolve([]),
        ]);
        rows = mergeOrphanedPwaDraftRows([...fromGlobal, ...fromProbe]);
      }
      const visible = await hydrateOrphanedPwaDrafts(
        await keepPaidOrphanedPwaDrafts(rows),
      );
      setDrafts(visible);
      setLoadError(null);
      if (visible.length > 0) setExpanded(true);
    } catch (error) {
      console.warn("[PwaOrphanedOrdersRecovery] load failed", error);
      setDrafts([]);
      setLoadError(
        error instanceof Error ? error.message : "Failed to load paid KBZPay drafts",
      );
    } finally {
      setChecked(true);
      setRefreshing(false);
    }
  }, [vendorId, scopedAnchors, searchOrderId]);

  useEffect(() => {
    void loadDrafts({ silent: hasLoadedOnceRef.current });
    hasLoadedOnceRef.current = true;
  }, [loadDrafts]);

  const handleRecover = async (merchantOrderId: string) => {
    setRecoveringId(merchantOrderId);
    try {
      const result = await finalizePwaCheckoutOrderApi({
        projectId,
        publicAnonKey,
        merchantOrderId,
        adminRecover: true,
      });
      if (!result.ok) {
        const detail = [result.error, result.message].filter(Boolean).join(": ");
        toast.error(
          result.error === "payment_not_confirmed"
            ? "KBZPay has not confirmed this payment. It is not a recoverable draft."
            : detail || "Could not create order from the paid KBZPay draft",
        );
        return;
      }
      toast.success(`Order ${merchantOrderId} registered successfully`);
      invalidateOrphanedPwaDraftsCache();
      setDrafts((prev) => prev.filter((d) => d.merchantOrderId !== merchantOrderId));
      onRecovered?.(result.order);
      void loadDrafts({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recovery failed");
    } finally {
      setRecoveringId(null);
    }
  };

  const title = vendorId ? "Paid KBZPay drafts (your store)" : "Paid KBZPay drafts (QR + PWA)";
  const hasDrafts = drafts.length > 0;
  const loading = !checked && !loadError;

  if (!hasDrafts && !loadError && !loading && (vendorId || checked)) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold text-amber-950">{title}</p>
            <p className="text-sm text-amber-900/80 mt-0.5">
              {loadError
                ? loadError
                : loading
                  ? "Loading paid KBZPay checkouts (QR or PWA) that never became an order…"
                : hasDrafts
                  ? `${drafts.length} paid KBZPay checkout${drafts.length === 1 ? "" : "s"} never became an order. Recover registers ${drafts.length === 1 ? "it" : "them"}.`
                  : "No paid KBZPay checkouts waiting to be registered."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-amber-300 bg-white"
            onClick={() => void loadDrafts({ silent: true })}
            disabled={refreshing || loading}
          >
            {refreshing || loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
          {compact ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : "Show"}
            </Button>
          ) : null}
        </div>
      </div>

      {expanded && hasDrafts ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-amber-900/70 border-b border-amber-200">
                  <th className="py-2 pr-3 font-medium">Order ID</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Vendor</th>
                  <th className="py-2 pr-3 font-medium">Total</th>
                  <th className="py-2 pr-3 font-medium">Payment</th>
                  <th className="py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => (
                  <tr key={draft.merchantOrderId} className="border-b border-amber-100/80">
                    <td className="py-2 pr-3">
                      <p className="font-mono text-xs font-medium text-amber-950">
                        {formatOrderNumberDisplay(draft.merchantOrderId)}
                      </p>
                      {draft.itemCount ? (
                        <p className="text-xs text-amber-900/70">
                          {draft.itemCount} {draft.itemCount === 1 ? "item" : "items"}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-amber-950">
                      {formatDraftOrderDate(draft.savedAt)}
                    </td>
                    <td className="py-2 pr-3">
                      <p className="text-amber-950">{draft.customer || "—"}</p>
                      {draft.email ? (
                        <p className="text-xs text-amber-900/70">{draft.email}</p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{draft.vendor || draft.vendorId || "—"}</td>
                    <td className="py-2 pr-3 tabular-nums font-semibold text-amber-950">
                      {draft.total != null
                        ? `${Math.round(draft.total).toLocaleString()} MMK`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge
                        variant="outline"
                        className={
                          draft.txnStatus === "paid"
                            ? "border-emerald-300 text-emerald-800 bg-emerald-50"
                            : "border-amber-300 text-amber-900 bg-white"
                        }
                      >
                        {draft.txnStatus || "unknown"}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        className="bg-amber-800 hover:bg-amber-900 text-white disabled:opacity-50"
                        disabled={recoveringId === draft.merchantOrderId || draft.canRecover === false}
                        title={
                          draft.canRecover === false
                            ? "Checkout cart snapshot is incomplete — cannot safely recover this order"
                            : undefined
                        }
                        onClick={() => void handleRecover(draft.merchantOrderId)}
                      >
                        {recoveringId === draft.merchantOrderId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Recover order"
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      ) : null}
    </div>
  );
}
