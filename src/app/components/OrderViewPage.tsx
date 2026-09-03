import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { logisticsApi, ordersApi, type DeliveryPartner } from "../../utils/api";
import { mapApiOrderToOrderItem, type AdminOrderItem } from "../utils/adminOrderMapper";
import { OrderDetails } from "./OrderDetails";
import { useLanguage } from "../contexts/LanguageContext";
import {
  adminOrdersUpdatedStorageKey,
  readAdminOrdersUpdatedStorageEvent,
  shouldRetryAdminOrdersRealtime,
} from "../utils/adminOrdersRealtime";
import { subscribeOrderStatusUpdates } from "../utils/ordersRealtime";

type OrderViewPageProps = {
  orderId: string;
  mode?: "view" | "edit";
  canEdit?: boolean;
  onOrderUpdated?: () => void;
};

export function OrderViewPage({
  orderId,
  mode = "view",
  canEdit = false,
  onOrderUpdated,
}: OrderViewPageProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const lookup = String(orderId || "").trim();
  const [order, setOrder] = useState<AdminOrderItem | null>(null);
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrder = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!lookup) return;
      const silent = opts?.silent === true;
      if (!silent) setLoading(true);
      try {
        const fetches: [
          ReturnType<typeof ordersApi.getById>,
          ...Array<ReturnType<typeof logisticsApi.getPartners>>,
        ] = [ordersApi.getById(lookup)];
        if (mode === "edit") {
          fetches.push(logisticsApi.getPartners());
        }
        const results = await Promise.all(fetches);

        const orderRes = results[0];
        const payload = orderRes?.order as Record<string, unknown> | undefined;
        if (!payload) throw new Error("Order not found");
        setOrder(mapApiOrderToOrderItem(payload));

        if (mode === "edit" && results[1]) {
          const partnersRes = results[1] as Awaited<ReturnType<typeof logisticsApi.getPartners>>;
          setPartners(Array.isArray(partnersRes?.partners) ? partnersRes.partners : []);
        }
      } catch {
        if (!silent) {
          toast.error(t(mode === "edit" ? "orders.editLoadError" : "orders.viewLoadError"));
          navigate("/admin/orders");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [lookup, mode, navigate, t],
  );

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = (retry = false) => {
      void loadOrder({ silent: true });
      if (!retry) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void loadOrder({ silent: true });
      }, 2000);
    };
    const bump = (ev: Event) => {
      const reason = (ev as CustomEvent<{ reason?: string }>)?.detail?.reason;
      if (reason === "patch-admin-orders-status") return;
      refresh(shouldRetryAdminOrdersRealtime(reason));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== adminOrdersUpdatedStorageKey()) return;
      const payload = readAdminOrdersUpdatedStorageEvent(e.newValue);
      if (payload?.reason === "patch-admin-orders-status") return;
      refresh(shouldRetryAdminOrdersRealtime(payload?.reason));
    };
    window.addEventListener("adminOrdersUpdated", bump);
    window.addEventListener("storage", onStorage);
    const unsubscribeStatus = subscribeOrderStatusUpdates(({ orderId: changedId, status }) => {
      const currentKey = String(order?.orderNumber || order?.id || lookup).trim();
      if (!currentKey || (changedId !== currentKey && changedId !== order?.id)) return;
      setOrder((prev) => (prev ? { ...prev, status: status as AdminOrderItem["status"] } : prev));
      void loadOrder({ silent: true });
    });
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("adminOrdersUpdated", bump);
      window.removeEventListener("storage", onStorage);
      unsubscribeStatus();
    };
  }, [loadOrder, lookup, order?.id, order?.orderNumber]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!order) return null;

  const orderKey = encodeURIComponent(String(order.orderNumber || order.id || lookup));

  return (
    <OrderDetails
      order={order as Parameters<typeof OrderDetails>[0]["order"]}
      mode={mode}
      deliveryPartners={partners}
      onBack={() => navigate("/admin/orders")}
      onEdit={
        mode === "view" && canEdit
          ? () => navigate(`/admin/orders/${orderKey}/edit`)
          : undefined
      }
      onCancelEdit={
        mode === "edit"
          ? () => navigate(`/admin/orders/${orderKey}`)
          : undefined
      }
      onSaved={
        mode === "edit"
          ? () => {
              onOrderUpdated?.();
              navigate(`/admin/orders/${orderKey}`);
            }
          : undefined
      }
      onOrderUpdated={onOrderUpdated}
    />
  );
}
