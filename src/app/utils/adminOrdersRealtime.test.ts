import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ORDERS_REALTIME_DEBOUNCE_MS,
  ADMIN_ORDERS_REALTIME_RETRY_MS,
  createAdminOrdersRealtimeRefetchScheduler,
  shouldRetryAdminOrdersRealtime,
} from "./adminOrdersRealtime";

describe("createAdminOrdersRealtimeRefetchScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid schedule calls into one silent force refresh", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const scheduler = createAdminOrdersRealtimeRefetchScheduler(load);
    scheduler.schedule(false);
    scheduler.schedule(false);
    scheduler.schedule(false);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ADMIN_ORDERS_REALTIME_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(true, { silent: true });
    scheduler.cancel();
  });

  it("queues a single follow-up when pulses arrive during an in-flight load", async () => {
    let resolveLoad: () => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const scheduler = createAdminOrdersRealtimeRefetchScheduler(load);
    scheduler.schedule(false);
    await vi.advanceTimersByTimeAsync(ADMIN_ORDERS_REALTIME_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledTimes(1);
    scheduler.schedule(false);
    scheduler.schedule(false);
    await vi.advanceTimersByTimeAsync(ADMIN_ORDERS_REALTIME_DEBOUNCE_MS);
    resolveLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    scheduler.cancel();
  });

  it("keeps retry when a later schedule(false) follows schedule(true)", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const scheduler = createAdminOrdersRealtimeRefetchScheduler(load);
    scheduler.schedule(true);
    scheduler.schedule(false);
    await vi.advanceTimersByTimeAsync(ADMIN_ORDERS_REALTIME_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ADMIN_ORDERS_REALTIME_RETRY_MS);
    expect(load).toHaveBeenCalledTimes(2);
    scheduler.cancel();
  });

  it("does not run after cancel", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const scheduler = createAdminOrdersRealtimeRefetchScheduler(load);
    scheduler.schedule(true);
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(
      ADMIN_ORDERS_REALTIME_DEBOUNCE_MS + ADMIN_ORDERS_REALTIME_RETRY_MS,
    );
    expect(load).not.toHaveBeenCalled();
  });
});

describe("shouldRetryAdminOrdersRealtime", () => {
  it("retries checkout and pulse reasons, not optimistic patches", () => {
    expect(shouldRetryAdminOrdersRealtime("realtime-order-pulse")).toBe(true);
    expect(shouldRetryAdminOrdersRealtime("storefront-checkout-order-created")).toBe(true);
    expect(shouldRetryAdminOrdersRealtime("patch-admin-orders-status")).toBe(false);
    expect(shouldRetryAdminOrdersRealtime("kpay-refund-payment-updated")).toBe(false);
  });
});
