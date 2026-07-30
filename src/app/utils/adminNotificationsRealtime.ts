export const ADMIN_NOTIFICATIONS_UPDATED_EVENT = "adminNotificationsUpdated";

export type AdminInboxNotificationType =
  | "order"
  | "product"
  | "review"
  | "system"
  | "comment";

export type AdminInboxNotification = {
  id: string;
  type: AdminInboxNotificationType;
  title: string;
  message: string;
  timestamp: string;
  createdAt?: string;
  isRead: boolean;
};

/** Normalize KV/API notification payloads for admin inbox UIs. */
export function normalizeAdminInboxNotification(
  raw: Record<string, unknown>,
  previous?: AdminInboxNotification,
): AdminInboxNotification {
  const rawType = String(raw.type || "system").toLowerCase();
  const type: AdminInboxNotificationType =
    rawType === "order" ||
    rawType === "product" ||
    rawType === "review" ||
    rawType === "comment"
      ? rawType
      : "system";

  const serverRead = Boolean(raw.isRead ?? raw.read ?? false);
  const locallyRead = previous?.isRead === true;
  const timestamp = String(
    raw.timestamp || raw.createdAt || previous?.timestamp || new Date().toISOString(),
  );

  let title = String(raw.title || "").trim();
  let message = String(raw.message || "").trim();

  if (type === "comment") {
    if (!title) title = "New blog comment";
    if (!message) {
      const content = String(raw.content || "").trim();
      const author = String(raw.author || "Someone").trim();
      message = content || `${author} commented on a blog post`;
    }
  }

  if (!title) {
    title =
      type === "order"
        ? "Order update"
        : type === "product"
          ? "Product update"
          : type === "review"
            ? "New review"
            : "Notification";
  }
  if (!message) message = "Open to view details";

  return {
    id: String(raw.id || ""),
    type,
    title,
    message,
    timestamp,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    isRead: serverRead || locallyRead,
  };
}

/** Notify the active admin shell that the server-side notification inbox changed. */
export function notifyAdminNotificationsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ADMIN_NOTIFICATIONS_UPDATED_EVENT));
}
