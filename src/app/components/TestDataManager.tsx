import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Trash2, RefreshCw, Eye } from "lucide-react";
import { cloudbaseApiBaseUrl, cloudbasePublishableKey, getCloudBaseRequestHeaders } from "../../../utils/supabase/info";
import { getAdminOperationHeaders } from "../../utils/api-client";

type SubscriptionResetCounts = Record<string, number>;

type ResetResponse = {
  success?: boolean;
  dryRun?: boolean;
  before?: SubscriptionResetCounts;
  after?: SubscriptionResetCounts;
  deletedByStep?: Record<string, number>;
  error?: string;
  message?: string;
};

function adminHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...getCloudBaseRequestHeaders(),
    ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
    ...getAdminOperationHeaders(),
  };
}

function formatCounts(counts: SubscriptionResetCounts | undefined): string {
  if (!counts) return "—";
  return Object.entries(counts)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

export function TestDataManager() {
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [counts, setCounts] = useState<SubscriptionResetCounts | null>(null);

  const callReset = useCallback(async (dryRun: boolean): Promise<ResetResponse> => {
    const response = await fetch(`${cloudbaseApiBaseUrl}/admin/reset-subscription-test-data`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(dryRun ? { dryRun: true } : { confirmDelete: true }),
    });
    const data = (await response.json().catch(() => ({}))) as ResetResponse;
    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (${response.status})`);
    }
    return data;
  }, []);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setMessage("");
    try {
      const data = await callReset(true);
      setCounts(data.before ?? null);
      setMessage("✅ Preflight loaded — no data deleted.");
    } catch (error) {
      setMessage(`❌ ${error instanceof Error ? error.message : "Preview failed"}`);
    } finally {
      setPreviewLoading(false);
    }
  }, [callReset]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const clearAllUsers = async () => {
    if (!confirm("⚠️ WARNING: This will delete ALL customer accounts. Are you sure?")) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${cloudbaseApiBaseUrl}/admin/clear-test-data`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ confirmDelete: true }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(`✅ Success: ${data.message || "All test data cleared"}`);
      } else {
        setMessage(`❌ Error: ${data.error || "Failed to clear data"}`);
      }
    } catch (error) {
      console.error("Error clearing test data:", error);
      setMessage(`❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const resetSubscriptionData = async () => {
    if (
      !confirm(
        "Delete ALL subscription payments, plans, customer subscriptions, and vendor withdrawal test KV rows?\n\nOrders, products, and vendors are NOT deleted.",
      )
    ) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = await callReset(false);
      setCounts(data.after ?? null);
      setMessage(
        `✅ Subscription + withdrawal test data cleared. After: ${formatCounts(data.after)}`,
      );
      try {
        localStorage.removeItem("migoo-ls-admin-finances-analytics-v1");
      } catch {
        // ignore
      }
    } catch (error) {
      setMessage(`❌ ${error instanceof Error ? error.message : "Reset failed"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 border border-slate-200 max-w-2xl">
      <h3 className="text-lg font-semibold text-slate-900 mb-1">Test data tools</h3>
      <p className="text-sm text-slate-600 mb-4">
        Super-admin only. Uses{" "}
        <code className="text-xs bg-slate-100 px-1 rounded">VITE_ADMIN_OPERATION_SECRET</code> and
        the deployed or local API (
        <code className="text-xs bg-slate-100 px-1 rounded">npm run dev:api</code> for localhost).
      </p>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 mb-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-900">Subscription + withdrawal KV (current)</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={previewLoading || loading}
            onClick={() => void loadPreview()}
          >
            {previewLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Eye className="w-4 h-4 mr-1" />
                Refresh counts
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-slate-600 break-words">{formatCounts(counts ?? undefined)}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Button
          onClick={() => void resetSubscriptionData()}
          disabled={loading || previewLoading}
          variant="destructive"
          className="sm:flex-1"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Resetting…
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4 mr-2" />
              Reset subscription + withdrawal data
            </>
          )}
        </Button>
        <Button
          onClick={() => void clearAllUsers()}
          disabled={loading || previewLoading}
          variant="outline"
          className="sm:flex-1"
        >
          Clear all customer accounts
        </Button>
      </div>

      {message && (
        <div
          className={`text-sm p-3 rounded border ${
            message.startsWith("✅")
              ? "bg-green-50 text-green-800 border-green-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          {message}
        </div>
      )}
    </Card>
  );
}
