/**
 * Main storefront chat IDs (see FloatingChat). Must match server fallback
 * `conv-${sanitizedEmail}` when sending the first message.
 */
export function mainStoreConversationIdFromEmail(email: string): string {
  return `conv-${email.trim().replace(/[^a-zA-Z0-9]/g, "-")}`;
}

/** Must match Edge `normalizeChatEmail` — placeholders and non-emails are empty. */
export function normalizeChatEmailClient(email: unknown): string {
  const s = String(email || "").trim().toLowerCase();
  if (!s || s === "—" || s === "-" || s === "n/a" || s === "na") return "";
  if (!s.includes("@")) return "";
  return s;
}

export function sanitizeChatTokenClient(input: unknown): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function normalizeChatVendorThreadTokenClient(vendorId: unknown, vendorSource?: unknown): string {
  const rawId = String(vendorId || "").trim();
  const lowerId = rawId.toLowerCase();
  const looksTechnical =
    /^vendor[_-]vendor_/i.test(rawId) ||
    /^vendor-vendor_/i.test(rawId) ||
    /^vendor_\d/i.test(rawId);

  const sourceToken = sanitizeChatTokenClient(vendorSource);
  const idToken = sanitizeChatTokenClient(rawId);

  if (rawId && !looksTechnical && idToken) return idToken;
  if (sourceToken && sourceToken !== "secure") return sourceToken;
  if (lowerId === "secure" || sourceToken === "secure") return "secure";
  return idToken || sourceToken || "secure";
}

/** Same thread key as Edge `canonicalConversationIdFor` (FloatingChat + admin must use this when email is known). */
export function canonicalChatThreadId(
  customerEmail: unknown,
  vendorId?: unknown,
  vendorSource?: unknown
): string | null {
  const normalizedEmail = normalizeChatEmailClient(customerEmail);
  if (!normalizedEmail) return null;
  const emailToken = sanitizeChatTokenClient(normalizedEmail);
  if (!emailToken) return null;
  const vendorToken = normalizeChatVendorThreadTokenClient(vendorId, vendorSource);
  if (!vendorToken || vendorToken === "secure") return `conv-${emailToken}`;
  return `conv-vendor-${vendorToken}-${emailToken}`;
}

/** Same bucket as Edge `conversationBucketKeyFor` (admin inbox merge when Realtime id ≠ row id). */
export function conversationBucketKeyClient(conv: {
  customerEmail?: unknown;
  customerName?: unknown;
  vendorId?: unknown;
  vendorSource?: unknown;
  id?: unknown;
}): string {
  const vendorToken = normalizeChatVendorThreadTokenClient(conv?.vendorId, conv?.vendorSource);
  const normalizedEmail = normalizeChatEmailClient(conv?.customerEmail);
  const nameToken = sanitizeChatTokenClient(conv?.customerName);
  // Vendor storefront: one row per display name (email may be missing on older threads).
  if (nameToken && vendorToken && vendorToken !== "secure") {
    return `name:${nameToken}::${vendorToken}`;
  }
  if (normalizedEmail) return `${normalizedEmail}::${vendorToken || "secure"}`;
  if (nameToken && vendorToken) return `name:${nameToken}::${vendorToken}`;
  return `conv-id:${String(conv?.id || "")}`;
}

export type ConversationMergeRow = {
  id: string;
  customerName?: string;
  customerEmail?: string;
  customerProfileImage?: string;
  lastMessage?: string;
  timestamp?: string;
  unread?: number;
  status?: string;
  starred?: boolean;
  vendorId?: string;
  vendorSource?: string;
  aliasConversationIds?: string[];
};

/** Merge duplicate inbox rows for the same customer + vendor (matches server GET /chat/conversations). */
export function mergeConversationsByCustomerVendorClient<T extends ConversationMergeRow>(
  conversations: T[]
): T[] {
  const grouped = new Map<string, T & { __ts?: number; __ids?: string[] }>();

  for (const conv of conversations || []) {
    const key = conversationBucketKeyClient(conv);
    const current = grouped.get(key);
    const ts = Date.parse(String(conv?.timestamp || "")) || 0;
    const unread = Number(conv?.unread) || 0;

    if (!current) {
      grouped.set(key, {
        ...conv,
        unread,
        __ts: ts,
        __ids: [String(conv?.id || "")],
      });
      continue;
    }

    const currentTs = Number(current.__ts) || 0;
    const nextIds = Array.from(new Set([...(current.__ids || []), String(conv?.id || "")]));
    const merged =
      ts >= currentTs
        ? ({ ...current, ...conv } as T & { __ts?: number; __ids?: string[] })
        : ({ ...conv, ...current } as T & { __ts?: number; __ids?: string[] });
    const email =
      normalizeChatEmailClient(conv?.customerEmail) ||
      normalizeChatEmailClient(current?.customerEmail);
    if (email) merged.customerEmail = email;
    merged.unread = (Number(current.unread) || 0) + unread;
    merged.starred = Boolean(current?.starred) || Boolean(conv?.starred);
    merged.__ts = Math.max(currentTs, ts);
    merged.__ids = nextIds;
    if (ts >= currentTs && conv?.id) merged.id = conv.id;
    grouped.set(key, merged);
  }

  return Array.from(grouped.values())
    .sort((a, b) => (Number(b.__ts) || 0) - (Number(a.__ts) || 0))
    .map(({ __ts, __ids, ...rest }) => ({
      ...(rest as T),
      aliasConversationIds: Array.isArray(__ids) ? __ids.filter(Boolean) : undefined,
    }));
}
