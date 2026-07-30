import { describe, expect, it } from "vitest";
import { normalizeAdminInboxNotification } from "./adminNotificationsRealtime";
import { isPendingOrderForBadge } from "./normalizeOrderBadgeStatus";

describe("isPendingOrderForBadge", () => {
  it("counts only brand-new pending orders", () => {
    expect(isPendingOrderForBadge("pending")).toBe(true);
    expect(isPendingOrderForBadge("pending-payment")).toBe(true);
    expect(isPendingOrderForBadge("processing")).toBe(false);
    expect(isPendingOrderForBadge("confirmed")).toBe(false);
    expect(isPendingOrderForBadge("")).toBe(false);
  });
});

describe("normalizeAdminInboxNotification", () => {
  it("maps blog comment payloads to readable inbox rows", () => {
    const row = normalizeAdminInboxNotification({
      id: "n1",
      type: "comment",
      content: "Nice post!",
      author: "Alice",
      read: false,
      createdAt: "2026-07-30T12:00:00.000Z",
    });
    expect(row.title).toBe("New blog comment");
    expect(row.message).toBe("Nice post!");
    expect(row.isRead).toBe(false);
  });

  it("preserves local read state during stale polls", () => {
    const previous = normalizeAdminInboxNotification({
      id: "n2",
      type: "order",
      title: "Order",
      message: "Updated",
      isRead: true,
      timestamp: "2026-07-30T12:00:00.000Z",
    });
    const row = normalizeAdminInboxNotification(
      {
        id: "n2",
        type: "order",
        title: "Order",
        message: "Updated",
        read: false,
        timestamp: "2026-07-30T12:00:00.000Z",
      },
      previous,
    );
    expect(row.isRead).toBe(true);
  });
});
