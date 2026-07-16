import { formatCustomerPhoneDisplay, normalizeMyanmarPhone } from "./customerAuthIdentity";
import { chatApi } from "../../utils/api";
import { clearFloatingChatCachesForEmail } from "./chatLocalCache";

/** Synthetic guest identity for floating chat (no sign-in required). */
export const GUEST_CHAT_EMAIL_DOMAIN = "guest.migoo.store";

const GUEST_CHAT_SESSION_KEY = "migoo-guest-chat-session";
const GUEST_DISPLAY_CODE_MIN = 1;

type GuestChatSession = {
  /** Stable internal token — used for guest email / thread identity. */
  id: string;
  displayCode?: string;
  phone?: string;
  phoneCollected?: boolean;
};

function randomInternalGuestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Pad to 6 digits when ≤6 figures; expand naturally beyond 999999. */
export function formatGuestDisplayCode(code: string | number | undefined | null): string {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (!digits) return "000001";
  let num = Number(digits);
  if (!Number.isFinite(num) || num < GUEST_DISPLAY_CODE_MIN) num = GUEST_DISPLAY_CODE_MIN;
  const str = String(Math.trunc(num));
  return str.length <= 6 ? str.padStart(6, "0") : str;
}

function readGuestChatSession(): GuestChatSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GUEST_CHAT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestChatSession | null;
    const id = String(parsed?.id || "").trim();
    if (!id) return null;
    return {
      id,
      displayCode: String(parsed?.displayCode || "").trim() || undefined,
      phone: String(parsed?.phone || "").trim() || undefined,
      phoneCollected: Boolean(parsed?.phoneCollected),
    };
  } catch {
    return null;
  }
}

function writeGuestChatSession(session: GuestChatSession): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GUEST_CHAT_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

function mergeGuestSession(patch: Partial<GuestChatSession> & { id: string }): GuestChatSession {
  const prev = readGuestChatSession();
  const next: GuestChatSession = {
    id: patch.id,
    displayCode: patch.displayCode ?? prev?.displayCode,
    phone: patch.phone ?? prev?.phone,
    phoneCollected: patch.phoneCollected ?? prev?.phoneCollected,
  };
  writeGuestChatSession(next);
  return next;
}

export function getOrCreateGuestChatId(): string {
  const existing = readGuestChatSession();
  if (existing?.id) return existing.id;
  const id = randomInternalGuestId();
  writeGuestChatSession({ id });
  return id;
}

export function guestEmailFromId(guestId: string): string {
  const token = String(guestId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${token || "guest"}@${GUEST_CHAT_EMAIL_DOMAIN}`;
}

export function isGuestChatEmail(email: unknown): boolean {
  return String(email || "")
    .trim()
    .toLowerCase()
    .endsWith(`@${GUEST_CHAT_EMAIL_DOMAIN}`);
}

export function readGuestChatPhone(): string {
  return String(readGuestChatSession()?.phone || "").trim();
}

export function hasGuestPhoneSaved(): boolean {
  const session = readGuestChatSession();
  if (session?.phoneCollected) return true;
  return Boolean(normalizeMyanmarPhone(readGuestChatPhone()));
}

export function guestNeedsPhoneCollection(): boolean {
  return !hasGuestPhoneSaved();
}

export function clearGuestChatSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(GUEST_CHAT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Remove guest identity, phone, and all floating-chat caches for this browser session. */
export function purgeGuestChatClientData(customerEmail: string): void {
  clearGuestChatSession();
  clearFloatingChatCachesForEmail(customerEmail);
}

export function writeGuestChatPhone(phone: string): void {
  const id = getOrCreateGuestChatId();
  const normalized = normalizeMyanmarPhone(phone) || String(phone || "").trim();
  mergeGuestSession({
    id,
    phone: normalized || undefined,
    phoneCollected: Boolean(normalized),
  });
}

/** Fetch sequential guest id (#000001, #000002, …) from server and cache locally. */
export async function ensureGuestDisplayCodeAllocated(guestEmail?: string): Promise<string | null> {
  const email = String(guestEmail || guestEmailFromId(getOrCreateGuestChatId())).trim();
  if (!isGuestChatEmail(email)) return null;

  const session = readGuestChatSession();
  if (session?.displayCode) return formatGuestDisplayCode(session.displayCode);

  try {
    const response = (await chatApi.allocateGuestDisplayId({ guestEmail: email })) as {
      displayCode?: number;
      displayName?: string;
      success?: boolean;
    };
    const code = response?.displayCode;
    if (!code || !response?.success) return null;
    const formatted = formatGuestDisplayCode(code);
    mergeGuestSession({
      id: session?.id || getOrCreateGuestChatId(),
      displayCode: formatted,
    });
    return formatted;
  } catch {
    return null;
  }
}

/** Public label for guest threads — `#000001` (no "Guest" prefix). */
export function formatGuestCustomerIdLabel(code: string | number | undefined | null): string {
  return `#${formatGuestDisplayCode(code)}`;
}

function guestChatProfileHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Prefer #000001 display id for stable pixel-art; fall back to guest email. */
export function guestChatAvatarSeed(customerEmail: string, customerName?: unknown): string {
  const code = parseGuestIdFromCustomerName(customerName);
  if (code) return `#${code}`;
  return String(customerEmail || "guest").trim().toLowerCase();
}

/** Same Dicebear pixel-art avatars used across Migoo (staff, customers, guests). */
export function guestChatFlatAvatarUrl(customerEmail: string, customerName?: unknown): string {
  const seed = guestChatAvatarSeed(customerEmail, customerName);
  return `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(seed)}`;
}

export function guestChatFlatAvatarFallbackUrl(customerEmail: string): string {
  return guestChatFlatAvatarUrl(customerEmail);
}

export function guestChatAvatarUrl(customerEmail: string): string {
  return guestChatFlatAvatarUrl(customerEmail);
}

/** @deprecated Emoji avatars — use guestChatFlatAvatarUrl instead. */
export function guestChatEmojiProfile(customerEmail: string): {
  emoji: string;
  backgroundClass: string;
} {
  const seed = String(customerEmail || "guest").trim().toLowerCase();
  const hash = guestChatProfileHash(seed);
  const emojis = ["😊", "🙂", "😄", "🥰", "✨", "🌸", "💛", "🩷", "⭐", "🍀"] as const;
  const backgrounds = [
    "bg-rose-100",
    "bg-amber-100",
    "bg-green-100",
    "bg-sky-100",
    "bg-violet-100",
    "bg-pink-100",
  ] as const;
  return {
    emoji: emojis[hash % emojis.length],
    backgroundClass: backgrounds[(hash >> 4) % backgrounds.length],
  };
}

/** Inline initials when Dicebear cannot load. */
export function guestChatLocalAvatarDataUri(customerEmail: string): string {
  const seed = String(customerEmail || "guest").trim().toLowerCase();
  const label = seed.includes("@") ? seed.split("@")[0].slice(0, 2).toUpperCase() : "GU";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">` +
    `<rect fill="#b6e3f4" width="80" height="80"/>` +
    `<text x="40" y="48" font-family="sans-serif" font-size="28" font-weight="600" text-anchor="middle" fill="#1e3a5f">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function parseGuestIdFromCustomerName(customerName: unknown): string | null {
  const raw = String(customerName || "").trim();
  const direct = raw.match(/^#\s*(\d+)/);
  if (direct) return formatGuestDisplayCode(direct[1]);
  const legacy = raw.match(/guest\s*#\s*(\d+)/i);
  if (legacy) return formatGuestDisplayCode(legacy[1]);
  return null;
}

/** Apply #000001 from server conversation row to local guest session. */
export function syncGuestDisplayCodeFromCustomerName(customerName: unknown): boolean {
  const formatted = parseGuestIdFromCustomerName(customerName);
  if (!formatted) return false;
  mergeGuestSession({
    id: getOrCreateGuestChatId(),
    displayCode: formatted,
  });
  return true;
}

/** Admin inbox: ensure every guest row has #000001 style label from server. */
export async function enrichGuestConversationsWithDisplayIds<
  T extends { customerEmail?: unknown; customerName?: unknown },
>(conversations: T[]): Promise<T[]> {
  const emails = [
    ...new Set(
      conversations
        .filter((c) => {
          const email = String(c.customerEmail || "").trim();
          return isGuestChatEmail(email) && !guestCustomerNameHasDisplayId(c.customerName);
        })
        .map((c) => String(c.customerEmail || "").trim()),
    ),
  ];
  if (emails.length === 0) return conversations;

  const nameByEmail = new Map<string, string>();
  await Promise.all(
    emails.map(async (email) => {
      try {
        const response = (await chatApi.allocateGuestDisplayId({ guestEmail: email })) as {
          displayName?: string;
          success?: boolean;
        };
        const name = String(response?.displayName || "").trim();
        if (response?.success && name) {
          nameByEmail.set(email.toLowerCase(), name);
        }
      } catch {
        /* guest-id endpoint may be unavailable until functions are deployed */
      }
    }),
  );

  if (nameByEmail.size === 0) return conversations;

  return conversations.map((conv) => {
    const email = String(conv.customerEmail || "").trim().toLowerCase();
    const nextName = nameByEmail.get(email);
    if (!nextName) return conv;
    return { ...conv, customerName: nextName };
  });
}

export function guestDisplayName(guestId?: string): string {
  const session = readGuestChatSession();
  if (session?.displayCode) {
    return formatGuestCustomerIdLabel(session.displayCode);
  }
  const id = String(guestId || getOrCreateGuestChatId()).trim();
  if (/^\d+$/.test(id)) return formatGuestCustomerIdLabel(id);
  return "#······";
}

/** Prefer `#000001` label for guest threads. */
export function normalizeGuestChatCustomerLabel(
  customerName: unknown,
  customerEmail?: unknown,
): string {
  const parsed = parseGuestIdFromCustomerName(customerName);
  if (parsed) return formatGuestCustomerIdLabel(parsed);

  const raw = String(customerName || "").trim();
  if (isGuestChatEmail(customerEmail)) {
    if (/^guest$/i.test(raw) || !raw) return "#······";
    if (raw.startsWith("#")) return raw;
    return raw;
  }

  return raw || "Customer";
}

/** Admin inbox / thread header — never show bare "Guest" when an id is available. */
export function resolveGuestChatCustomerLabel(conv: {
  customerName?: unknown;
  customerEmail?: unknown;
}): string {
  return normalizeGuestChatCustomerLabel(conv.customerName, conv.customerEmail);
}

export function guestCustomerNameHasDisplayId(name: unknown): boolean {
  return /#\s*\d+/.test(String(name || ""));
}

export function pickGuestCustomerNameForInbox(
  incoming: string,
  existing: string,
  customerEmail: string,
): string {
  if (!isGuestChatEmail(customerEmail)) {
    return incoming || existing || "Customer";
  }
  const inc = normalizeGuestChatCustomerLabel(incoming, customerEmail);
  const prev = normalizeGuestChatCustomerLabel(existing, customerEmail);
  if (guestCustomerNameHasDisplayId(inc)) return inc;
  if (guestCustomerNameHasDisplayId(prev)) return prev;
  return inc || prev || "#······";
}

/** Resolve avatar URL — Dicebear pixel-art for guests (same as staff/customer profiles). */
export function resolveGuestChatAvatarUrl(conv: {
  customerEmail?: unknown;
  customerProfileImage?: unknown;
  customerName?: unknown;
}): string {
  const email = String(conv.customerEmail || "").trim();
  if (isGuestChatEmail(email)) return guestChatFlatAvatarUrl(email, conv.customerName);
  const stored = String(conv.customerProfileImage || "").trim();
  if (stored && !stored.startsWith("data:")) return stored;
  const seed = String(conv.customerName || email || "customer").trim();
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=3b82f6`;
}

/** Admin/sales-facing label — never show staff or stale personal emails for guest threads. */
export function adminChatContactLabel(conv: {
  customerName?: unknown;
  customerEmail?: unknown;
  customerPhone?: unknown;
}): string {
  const email = String(conv.customerEmail || "").trim();
  const phone = String(conv.customerPhone || "").trim();
  const name = String(conv.customerName || "").trim().toLowerCase();
  const isGuestThread =
    isGuestChatEmail(email) ||
    name === "guest" ||
    name.startsWith("guest #") ||
    /^#\s*\d+/.test(String(conv.customerName || "").trim());

  if (isGuestThread) {
    return phone ? formatCustomerPhoneDisplay(phone) : "No phone yet";
  }

  return email || "—";
}
