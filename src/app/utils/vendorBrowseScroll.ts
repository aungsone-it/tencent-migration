import type { SessionScrollPositionState } from "./persistedSessionCache";

export type VendorBrowseScrollLocationState = {
  vendorBrowseScroll?: SessionScrollPositionState;
  vendorBrowseScrollKey?: string;
};

export function readVendorBrowseScrollFromLocationState(
  state: unknown,
  expectedKey: string,
): SessionScrollPositionState | null {
  if (!state || typeof state !== "object") return null;
  const st = state as VendorBrowseScrollLocationState;
  if (st.vendorBrowseScrollKey !== expectedKey) return null;
  const top = st.vendorBrowseScroll?.scrollTop;
  if (typeof top !== "number" || top <= 0) return null;
  return st.vendorBrowseScroll ?? null;
}

/** Patch the current history entry so browser Back restores scroll via location.state. */
export function patchVendorBrowseScrollHistoryState(
  snapshot: SessionScrollPositionState,
  sliceKey: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.history.state;
    const base = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const usr =
      base.usr && typeof base.usr === "object"
        ? (base.usr as Record<string, unknown>)
        : {};
    window.history.replaceState(
      {
        ...base,
        usr: {
          ...usr,
          vendorBrowseScroll: snapshot,
          vendorBrowseScrollKey: sliceKey,
        },
      },
      "",
    );
  } catch {
    /* ignore */
  }
}

export function captureBrowseScrollTop(
  scrollEl: HTMLElement | null | undefined,
): number {
  if (typeof window === "undefined") return 0;
  const fromEl = scrollEl?.scrollTop ?? 0;
  const fromWindow = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  return Math.max(fromEl, fromWindow);
}

export function applyBrowseScrollTop(
  scrollEl: HTMLElement | null | undefined,
  targetTop: number,
): number {
  if (targetTop <= 0) return 0;
  if (scrollEl) scrollEl.scrollTop = targetTop;
  window.scrollTo(0, targetTop);
  document.documentElement.scrollTop = targetTop;
  document.body.scrollTop = targetTop;
  return scrollEl?.scrollTop ?? window.scrollY ?? targetTop;
}
