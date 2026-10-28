const STAFF_SESSION_STORAGE_KEY = "staffSessionToken";

export function storeStaffSessionToken(token: string | null | undefined): void {
  const value = String(token || "").trim();
  try {
    if (!value) {
      localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(STAFF_SESSION_STORAGE_KEY, value);
  } catch {
    /* private mode / quota */
  }
}

export function readStaffSessionToken(): string {
  try {
    return String(localStorage.getItem(STAFF_SESSION_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function clearStaffSessionToken(): void {
  try {
    localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getStaffSessionHeaders(): Record<string, string> {
  const token = readStaffSessionToken();
  return token ? { "x-staff-session": token } : {};
}
