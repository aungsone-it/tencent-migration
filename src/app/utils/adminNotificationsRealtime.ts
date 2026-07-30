export const ADMIN_NOTIFICATIONS_UPDATED_EVENT = "adminNotificationsUpdated";

/** Notify the active admin shell that the server-side notification inbox changed. */
export function notifyAdminNotificationsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ADMIN_NOTIFICATIONS_UPDATED_EVENT));
}
