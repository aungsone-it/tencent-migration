import { useEffect, useRef } from "react";
import {
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
} from "../../../utils/supabase/info";
import { API_BASE_URL } from "../../utils/api-client";
import { notifyAdminOrdersUpdated } from "../utils/adminOrdersRealtime";
import {
  dispatchAdminProductsCachePatched,
  notifyAdminVendorApplicationsUpdated,
} from "../utils/module-cache";
import { notifyCustomerRealtimeLocal, type CustomerRealtimePayload } from "../utils/customersRealtime";
import { notifyAdminNotificationsUpdated } from "../utils/adminNotificationsRealtime";
import {
  notifyStaffSessionRevokedLocal,
  type StaffSessionRevokedPayload,
} from "../utils/staffSessionRealtime";

const PULSE_POLL_MS = 2_000;
const PULSE_DEBOUNCE_MS = 350;

type PulseCounter = {
  bump: number;
  updatedAt: string | null;
  detail?: CustomerRealtimePayload;
};

type PulseSnapshot = {
  orders: PulseCounter | null;
  vendorApplications: PulseCounter | null;
  domains: Record<string, PulseCounter>;
};

function counterChanged(previous: PulseCounter | null | undefined, next: PulseCounter | null | undefined) {
  return previous != null && next != null && previous.bump !== next.bump;
}

/**
 * CloudBase/TencentDB does not expose Supabase postgres_changes WebSockets.
 * Poll small, public-safe counters while an admin tab is visible, then fan out
 * the existing local events only when a server-side domain actually changed.
 */
export function OrderRealtimeBridge() {
  const previousRef = useRef<PulseSnapshot | null>(null);
  const ordersPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    const scheduleOrdersPulse = () => {
      if (ordersPulseTimerRef.current) clearTimeout(ordersPulseTimerRef.current);
      ordersPulseTimerRef.current = setTimeout(() => {
        ordersPulseTimerRef.current = null;
        if (!disposed) notifyAdminOrdersUpdated("realtime-order-pulse");
      }, PULSE_DEBOUNCE_MS);
    };

    const fanOutDomain = (domain: string, counter?: PulseCounter) => {
      if (domain === "products") {
        dispatchAdminProductsCachePatched();
      } else if (domain === "categories") {
        window.dispatchEvent(new CustomEvent("categoryDataUpdated"));
      } else if (domain === "customers") {
        notifyCustomerRealtimeLocal(counter?.detail ?? { event: "audience" });
      } else if (domain === "vendors") {
        window.dispatchEvent(new CustomEvent("vendorDataUpdated"));
      } else if (domain === "marketing") {
        window.dispatchEvent(new CustomEvent("marketingDataUpdated"));
      } else if (domain === "notifications") {
        notifyAdminNotificationsUpdated();
      } else if (domain === "staff_sessions") {
        const detail = counter?.detail as StaffSessionRevokedPayload | undefined;
        const userId = String(detail?.userId || "").trim();
        if (userId) {
          notifyStaffSessionRevokedLocal({
            userId,
            reason: detail?.reason === "deleted" ? "deleted" : "deactivated",
          });
        }
      }
    };

    const poll = async () => {
      if (
        disposed ||
        inFlight ||
        (typeof document !== "undefined" && document.visibilityState !== "visible")
      ) {
        return;
      }
      inFlight = true;
      try {
        const response = await fetch(`${API_BASE_URL}/realtime/pulses`, {
          headers: {
            ...getCloudBaseRequestHeaders(),
            ...(cloudbasePublishableKey
              ? { Authorization: `Bearer ${cloudbasePublishableKey}` }
              : {}),
          },
          cache: "no-store",
        });
        if (!response.ok) return;
        const next = (await response.json()) as PulseSnapshot & { success?: boolean };
        if (disposed || next.success === false) return;

        const previous = previousRef.current;
        previousRef.current = next;
        if (!previous) return;

        if (counterChanged(previous.orders, next.orders)) {
          scheduleOrdersPulse();
        }
        if (counterChanged(previous.vendorApplications, next.vendorApplications)) {
          window.dispatchEvent(new CustomEvent("vendorDataUpdated"));
          notifyAdminVendorApplicationsUpdated("realtime-vendor-app-pulse");
        }
        const domains = new Set([
          ...Object.keys(previous.domains || {}),
          ...Object.keys(next.domains || {}),
        ]);
        for (const domain of domains) {
          if (counterChanged(previous.domains?.[domain], next.domains?.[domain])) {
            fanOutDomain(domain, next.domains?.[domain]);
          }
        }
      } catch {
        // Keep the previous snapshot; the next successful poll catches every counter change.
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), PULSE_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (ordersPulseTimerRef.current) clearTimeout(ordersPulseTimerRef.current);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
