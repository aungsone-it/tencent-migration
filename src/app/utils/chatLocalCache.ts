/** Local chat cache helpers — instant UI from localStorage; server/DB wins on merge. */

export type ChatMessageLike = {
  id: string;
  timestamp: string;
  text?: string;
  sender?: string;
  imageUrl?: string;
  [key: string]: unknown;
};

export function mergeChatMessageLists<T extends ChatMessageLike>(
  local: T[],
  server: T[]
): T[] {
  const map = new Map<string, T>();
  for (const m of local) {
    const id = String(m?.id || "").trim();
    if (!id || id === "welcome-1") continue;
    map.set(id, m);
  }
  for (const m of server) {
    const id = String(m?.id || "").trim();
    if (!id) continue;
    map.set(id, m);
  }
  return [...map.values()].sort(
    (a, b) =>
      new Date(String(a.timestamp || 0)).getTime() -
      new Date(String(b.timestamp || 0)).getTime()
  );
}

export function chatMessagesStorageKey(vendorId?: string, email?: string): string {
  const scope = vendorId ? `vendor-${String(vendorId).trim()}` : "secure";
  const who = email?.trim()
    ? email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "guest";
  return `migoo-chat-messages-${scope}-${who}`;
}

export function chatSyncedEmailKey(vendorId?: string): string {
  return vendorId
    ? `migoo-chat-synced-email-vendor-${String(vendorId).trim()}`
    : "migoo-chat-synced-email";
}

export function readSyncedChatEmail(vendorId?: string): string {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(chatSyncedEmailKey(vendorId)) || "")
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

export function writeSyncedChatEmail(vendorId: string | undefined, email: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      chatSyncedEmailKey(vendorId),
      String(email || "").trim().toLowerCase()
    );
  } catch {
    /* ignore */
  }
}

export function clearSyncedChatEmail(vendorId?: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(chatSyncedEmailKey(vendorId));
  } catch {
    /* ignore */
  }
}

export function readLocalChatMessages<T extends ChatMessageLike>(
  storageKey: string
): T[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as T[];
  } catch {
    return null;
  }
}

export function writeLocalChatMessages(
  storageKey: string,
  messages: ChatMessageLike[]
): void {
  if (typeof window === "undefined") return;
  try {
    const toSave = messages.filter((m) => m?.id && m.id !== "welcome-1");
    if (toSave.length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(toSave));
  } catch {
    /* quota / private mode */
  }
}

const ADMIN_INBOX_KEY = "migoo-admin-chat-inbox";
const ADMIN_STAFF_KEY = "migoo-admin-chat-staff-id";
const ADMIN_THREAD_PREFIX = "migoo-admin-chat-thread-";

export function readAdminStaffIdLocal(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(ADMIN_STAFF_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeAdminStaffIdLocal(staffId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ADMIN_STAFF_KEY, String(staffId || "").trim());
  } catch {
    /* ignore */
  }
}

export function readAdminInboxLocal<T>(): T[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ADMIN_INBOX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export function writeAdminInboxLocal<T>(conversations: T[]): void {
  if (typeof window === "undefined") return;
  try {
    if (!conversations.length) {
      localStorage.removeItem(ADMIN_INBOX_KEY);
      return;
    }
    localStorage.setItem(ADMIN_INBOX_KEY, JSON.stringify(conversations));
  } catch {
    /* ignore */
  }
}

export function readAdminThreadLocal<T>(conversationId: string): T[] | null {
  if (typeof window === "undefined" || !conversationId) return null;
  try {
    const raw = localStorage.getItem(`${ADMIN_THREAD_PREFIX}${conversationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export function writeAdminThreadLocal(
  conversationId: string,
  messages: ChatMessageLike[]
): void {
  if (typeof window === "undefined" || !conversationId) return;
  try {
    const key = `${ADMIN_THREAD_PREFIX}${conversationId}`;
    if (!messages.length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(messages));
  } catch {
    /* ignore */
  }
}

export function clearAdminThreadLocal(conversationId: string): void {
  if (typeof window === "undefined" || !conversationId) return;
  try {
    localStorage.removeItem(`${ADMIN_THREAD_PREFIX}${conversationId}`);
  } catch {
    /* ignore */
  }
}

export function clearAdminChatLocalCaches(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ADMIN_INBOX_KEY);
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(ADMIN_THREAD_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

function emailTokenForChatCache(email: string): string {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

/** Wipe floating-chat local caches for a guest/customer email (messages, thread ids, sync markers). */
export function clearFloatingChatCachesForEmail(customerEmail: string): void {
  if (typeof window === "undefined") return;
  const token = emailTokenForChatCache(customerEmail);
  if (!token) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("migoo-chat-messages-") && k.endsWith(`-${token}`)) {
        keys.push(k);
      }
      if (k === "migoo-chat-conversationId" || k.startsWith("migoo-chat-conversationId-")) {
        keys.push(k);
      }
      if (k === "migoo-chat-synced-email" || k.startsWith("migoo-chat-synced-email-")) {
        keys.push(k);
      }
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
