const CUSTOMER_SESSION_STORAGE_KEY = "customerSessionToken";

export function storeCustomerSessionToken(token: string | null | undefined): void {
  const value = String(token || "").trim();
  if (!value) {
    localStorage.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
    return;
  }
  localStorage.setItem(CUSTOMER_SESSION_STORAGE_KEY, value);
}

export function readCustomerSessionToken(): string {
  try {
    return String(localStorage.getItem(CUSTOMER_SESSION_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function clearCustomerSessionToken(): void {
  try {
    localStorage.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getCustomerSessionHeaders(): Record<string, string> {
  const token = readCustomerSessionToken();
  return token ? { "x-customer-session": token } : {};
}
