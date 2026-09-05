import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { logisticsApi, ordersApi, type DeliveryPartner } from "../../utils/api";
import { mapApiOrderToOrderItem, type AdminOrderItem } from "../utils/adminOrderMapper";
import { OrderDetails } from "./OrderDetails";
import { useLanguage } from "../contexts/LanguageContext";
import {
  adminOrdersUpdatedStorageKey,
  createAdminOrdersRealtimeRefetchScheduler,
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
  const loadRequestIdRef = useRef(0);
  const orderRef = useRef<AdminOrderItem | null>(null);
  orderRef.current = order;
  const loadOrderRef = useRef<(opts?: { silent?: boolean }) => Promise<void>>(async () => {});
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const tRef = useRef(t);
  tRef.current = t;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const loadOrder = useCallback(async (opts?: { silent?: boolean }) => {
    const currentLookup = lookupRef.current;
    if (!currentLookup) return;
    const requestId = ++loadRequestIdRef.current;
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const fetches: [
        ReturnType<typeof ordersApi.getById>,
        ...Array<ReturnType<typeof logisticsApi.getPartners>>,
      ] = [ordersApi.getById(currentLookup)];
      if (modeRef.current === "edit") {
        fetches.push(logisticsApi.getPartners());
      }
      const results = await Promise.all(fetches);
      if (requestId !== loadRequestIdRef.current || lookupRef.current !== currentLookup) {
        return;
      }

      const orderRes = results[0];
      const payload = orderRes?.order as Record<string, unknown> | undefined;
      if (!payload) throw new Error("Order not found");
      setOrder(mapApiOrderToOrderItem(payload));

      if (modeRef.current === "edit" && results[1]) {
        const partnersRes = results[1] as Awaited<ReturnType<typeof logisticsApi.getPartners>>;
        setPartners(Array.isArray(partnersRes?.partners) ? partnersRes.partners : []);
      }
    } catch {
      if (requestId !== loadRequestIdRef.current || lookupRef.current !== currentLookup) {
        return;
      }
      if (!silent) {
        toast.error(
          tRef.current(modeRef.current === "edit" ? "orders.editLoadError" : "orders.viewLoadError"),
        );
        navigateRef.current("/admin/orders");
      }
    } finally {
      if (requestId !== loadRequestIdRef.current) return;
      setLoading(false);
    }
  }, []);
  loadOrderRef.current = loadOrder;

  useEffect(() => {
    loadRequestIdRef.current += 1;
    const current = orderRef.current;
    const sameLookup =
      !!current &&
      (String(current.orderNumber || "") === lookup || String(current.id || "") === lookup);
    if (!sameLookup) {
      setOrder(null);
      setLoading(true);
    }
    void loadOrderRef.current(sameLookup ? { silent: true } : undefined);
  }, [lookup, mode]);

  useEffect(() => {
    const scheduler = createAdminOrdersRealtimeRefetchScheduler((_force, opts) =>
      loadOrderRef.current({ silent: opts?.silent !== false }),
    );
    const bump = (ev: Event) => {
      const reason = (ev as CustomEvent<{ reason?: string }>)?.detail?.reason;
      if (reason === "patch-admin-orders-status") return;
      scheduler.schedule(shouldRetryAdminOrdersRealtime(reason));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== adminOrdersUpdatedStorageKey()) return;
      const payload = readAdminOrdersUpdatedStorageEvent(e.newValue);
      if (payload?.reason === "patch-admin-orders-status") return;
      scheduler.schedule(shouldRetryAdminOrdersRealtime(payload?.reason));
    };
    window.addEventListener("adminOrdersUpdated", bump);
    window.addEventListener("storage", onStorage);
    const unsubscribeStatus = subscribeOrderStatusUpdates(({ orderId: changedId, status }) => {
      const current = orderRef.current;
      const currentKey = String(current?.orderNumber || current?.id || lookupRef.current).trim();
      if (!currentKey || (changedId !== currentKey && changedId !== current?.id)) return;
      setOrder((prev) => (prev ? { ...prev, status: status as AdminOrderItem["status"] } : prev));
      void loadOrderRef.current({ silent: true });
    });
    return () => {
      scheduler.cancel();
      window.removeEventListener("adminOrdersUpdated", bump);
      window.removeEventListener("storage", onStorage);
      unsubscribeStatus();
    };
  }, []);

  if (loading && !order) {
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
