const VENDOR_SESSION_STORAGE_KEY = "vendorSessionToken";

export function storeVendorSessionToken(token: string | null | undefined): void {
  const value = String(token || "").trim();
  if (!value) {
    localStorage.removeItem(VENDOR_SESSION_STORAGE_KEY);
    return;
  }
  localStorage.setItem(VENDOR_SESSION_STORAGE_KEY, value);
}

export function readVendorSessionToken(): string {
  try {
    return String(localStorage.getItem(VENDOR_SESSION_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function clearVendorSessionToken(): void {
  try {
    localStorage.removeItem(VENDOR_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Headers required for vendor-authenticated payout routes. */
export function getVendorSessionHeaders(): Record<string, string> {
  const token = readVendorSessionToken();
  return token ? { "x-vendor-session": token } : {};
}
