import { createTencentCloudBaseCompatClient } from "../../utils/tencentCloudbaseClient";

export const STAFF_SESSION_REVOKED_EVENT = "staffSessionRevoked";

const STAFF_SESSION_BC_NAME = "migoo-staff-session-realtime";
const STAFF_SESSION_BROADCAST_CHANNEL = "sec-staff-session-v1";
const STAFF_SESSION_STORAGE_KEY = "migoo-staff-session-revoked";

const realtimeClient = createTencentCloudBaseCompatClient();

export type StaffSessionRevokedPayload = {
  userId: string;
  reason: "deactivated" | "deleted";
};

async function waitSubscribed(
  ch: ReturnType<typeof realtimeClient.channel>,
  ms = 8000
): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(t);
        resolve(true);
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(t);
        resolve(false);
      }
    });
  });
}

/** Same-tab + cross-tab (BroadcastChannel + storage) fan-out. */
export function notifyStaffSessionRevokedLocal(payload: StaffSessionRevokedPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(STAFF_SESSION_REVOKED_EVENT, { detail: payload })
    );
  } catch {
    /* ignore */
  }
  try {
    const bc = new BroadcastChannel(STAFF_SESSION_BC_NAME);
    bc.postMessage(payload);
    bc.close();
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(STAFF_SESSION_STORAGE_KEY, JSON.stringify(payload));
    window.localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Cross-tab broadcast when a super admin deactivates or deletes a staff account. */
export async function broadcastStaffSessionRevoked(
  payload: StaffSessionRevokedPayload
): Promise<void> {
  notifyStaffSessionRevokedLocal(payload);
  if (typeof window === "undefined") return;
  const ch = realtimeClient.channel(STAFF_SESSION_BROADCAST_CHANNEL, {
    config: { broadcast: { ack: false } },
  });
  const ok = await waitSubscribed(ch);
  if (!ok) {
    try {
      await realtimeClient.removeChannel(ch);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    await ch.send({
      type: "broadcast",
      event: "staff-session-revoked",
      payload,
    });
  } finally {
    try {
      await realtimeClient.removeChannel(ch);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeStaffSessionRevoked(
  onRevoked: (payload: StaffSessionRevokedPayload) => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handlePayload = (payload: StaffSessionRevokedPayload | undefined) => {
    const userId = String(payload?.userId || "").trim();
    if (!userId) return;
    onRevoked({
      userId,
      reason: payload?.reason === "deleted" ? "deleted" : "deactivated",
    });
  };

  const onWindow = (e: Event) => {
    handlePayload((e as CustomEvent<StaffSessionRevokedPayload>).detail);
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STAFF_SESSION_STORAGE_KEY || !e.newValue) return;
    try {
      handlePayload(JSON.parse(e.newValue) as StaffSessionRevokedPayload);
    } catch {
      /* ignore malformed payloads */
    }
  };

  window.addEventListener(STAFF_SESSION_REVOKED_EVENT, onWindow);
  window.addEventListener("storage", onStorage);

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(STAFF_SESSION_BC_NAME);
    bc.onmessage = (ev: MessageEvent<StaffSessionRevokedPayload>) => {
      handlePayload(ev.data);
    };
  } catch {
    /* ignore */
  }

  const ch = realtimeClient
    .channel(STAFF_SESSION_BROADCAST_CHANNEL, { config: { broadcast: { ack: false } } })
    .on(
      "broadcast",
      { event: "staff-session-revoked" },
      (ctx: { payload?: StaffSessionRevokedPayload }) => {
        handlePayload(ctx?.payload);
      }
    );
  ch.subscribe();

  return () => {
    window.removeEventListener(STAFF_SESSION_REVOKED_EVENT, onWindow);
    window.removeEventListener("storage", onStorage);
    bc?.close();
    try {
      void realtimeClient.removeChannel(ch);
    } catch {
      /* ignore */
    }
  };
}
