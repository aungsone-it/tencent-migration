import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X, Send, Image as ImageIcon, Loader2, MessageCircleMore, Phone } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { toast } from "sonner";
import { chatApi } from "../../utils/api";
import { ApiError } from "../../utils/api-client";
import {
  CHAT_LOCAL_STORAGE_DEBOUNCE_MS,
  CHAT_SCROLL_DEBOUNCE_MS,
  MIGOO_CHAT_DISMISS_UNREAD_EVENT,
  MIGOO_USER_SESSION_CHANGED_EVENT,
  MIGOO_VENDOR_STOREFRONT_BRANDING_EVENT,
  POLLING_INTERVALS_MS,
} from "../../constants";
import {
  broadcastConversationMessage,
  broadcastCustomerChatMessage,
  broadcastInboxPing,
  subscribeConversationBroadcastMulti,
  subscribeCustomerChatBroadcast,
  subscribeGuestChatReset,
} from "../utils/chatRealtime";
import imageCompression from "browser-image-compression";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { useDocumentVisible } from "../hooks/useDocumentVisible";
import { canonicalChatThreadId } from "../../utils/chatConversation";
import {
  chatMessagesStorageKey,
  mergeChatMessageLists,
  readLocalChatMessages,
  readSyncedChatEmail,
  writeLocalChatMessages,
  writeSyncedChatEmail,
} from "../utils/chatLocalCache";
import { useChatNotification } from "../contexts/ChatNotificationContext";
import { useLanguage } from "../contexts/LanguageContext";
import {
  getOrCreateGuestChatId,
  guestDisplayName,
  guestEmailFromId,
  guestNeedsPhoneCollection,
  ensureGuestDisplayCodeAllocated,
  writeGuestChatPhone,
  isGuestChatEmail,
  readGuestChatPhone,
  hasGuestPhoneSaved,
  purgeGuestChatClientData,
  guestChatFlatAvatarUrl,
  syncGuestDisplayCodeFromCustomerName,
} from "../utils/guestChatIdentity";
import {
  formatCustomerPhoneDisplay,
  isStorefrontCustomerSession,
  normalizeMyanmarPhone,
  resolveCustomerPhone,
} from "../utils/customerAuthIdentity";
import { readVendorStorefrontDisplayName } from "../utils/vendorStorefrontBrandingCache";

const MIGOO_USER_STORAGE_KEY = "migoo-user";

type ChatParticipant = {
  name: string;
  email: string;
  phone: string;
  isGuest: boolean;
  profileImage: string;
};

function readMigooUser(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MIGOO_USER_STORAGE_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as Record<string, unknown> | null;
    return u && typeof u === "object" && !Array.isArray(u) ? u : null;
  } catch {
    return null;
  }
}

/** Storefront customer session only — never use CloudBase staff/admin AuthContext email. */
function resolveChatParticipant(): ChatParticipant {
  const user = readMigooUser();

  if (isStorefrontCustomerSession(user)) {
    const storedEmail = String(user?.email || "").trim();
    const storedName = String(
      user?.fullName || user?.firstName || user?.name || "Customer"
    ).trim();
    const profileImage =
      String(
        user?.profileImageUrl ||
          user?.avatarUrl ||
          user?.avatar ||
          (typeof user?.profileImage === "string" && user.profileImage.startsWith("http")
            ? user.profileImage
            : "") ||
          ""
      ).trim() || "";

    if (storedEmail && !isGuestChatEmail(storedEmail)) {
      return {
        name: storedName || "Customer",
        email: storedEmail,
        phone: resolveCustomerPhone(user) || "",
        isGuest: false,
        profileImage,
      };
    }
  }

  const guestId = getOrCreateGuestChatId();
  const guestEmail = guestEmailFromId(guestId);
  return {
    name: guestDisplayName(guestId),
    email: guestEmail,
    phone: readGuestChatPhone(),
    isGuest: true,
    profileImage: guestChatFlatAvatarUrl(guestEmail),
  };
}

function createWelcomeMessage(vendorId?: string, storeName?: string): Message {
  const resolvedStoreName = vendorId
    ? String(storeName || vendorId).trim() || vendorId
    : "SECURE Store";
  return {
    id: "welcome-1",
    text: `Hello! Welcome to ${resolvedStoreName}. How can we help you today?`,
    timestamp: new Date().toISOString(),
    sender: "admin",
    senderName: vendorId ? `${resolvedStoreName} Support` : "Admin",
    status: "read",
  };
}

interface Message {
  id: string;
  text: string;
  timestamp: string;
  sender: "customer" | "admin";
  senderName: string;
  status?: "sent" | "delivered" | "read";
  imageUrl?: string;
}

interface FloatingChatProps {
  customerName?: string;
  customerEmail?: string;
  onUnreadCountChange?: (count: number) => void;
  forceOpen?: boolean;
  onOpen?: () => void;
  vendorId?: string; // Vendor ID if chatting on a vendor storefront
  isAuthenticated?: boolean; // NEW: Check if user is logged in
  /** Lift chat bubble above vendor mobile sticky purchase bar (product detail). */
  aboveStickyPurchaseBar?: boolean;
  /** Reserve vertical space for the back-to-top button below the chat FAB. */
  reserveBackToTopStack?: boolean;
}

function sanitizeChatEmailToken(email: string): string {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-");
}

function createConversationIdForParticipant(participantEmail: string, vendorId?: string): string {
  const emailToken = sanitizeChatEmailToken(participantEmail);
  if (vendorId) {
    return `conv-vendor-${String(vendorId).trim().toLowerCase()}-${emailToken}`;
  }
  return `conv-${emailToken}`;
}

export function FloatingChat({ customerName = "Guest", customerEmail = "", onUnreadCountChange, forceOpen, onOpen, vendorId, isAuthenticated = false, aboveStickyPurchaseBar = false, reserveBackToTopStack = true }: FloatingChatProps) {
  const { setFloatingChatOpen } = useChatNotification();
  const { t } = useLanguage();
  const docVisible = useDocumentVisible();

  const [vendorDisplayName, setVendorDisplayName] = useState(() =>
    vendorId ? readVendorStorefrontDisplayName(vendorId) : ""
  );

  useEffect(() => {
    if (!vendorId) {
      setVendorDisplayName("");
      return;
    }
    const refresh = () => {
      setVendorDisplayName(readVendorStorefrontDisplayName(vendorId));
    };
    refresh();
    const onBranding = (e: Event) => {
      const detail = (e as CustomEvent<{ slug?: string; storeName?: string }>).detail;
      const slug = String(detail?.slug || "").trim().toLowerCase();
      if (!slug || slug !== String(vendorId).trim().toLowerCase()) return;
      const name = String(detail?.storeName || "").trim();
      if (name) setVendorDisplayName(name);
      else refresh();
    };
    window.addEventListener("vendorDataUpdated", refresh);
    window.addEventListener(MIGOO_VENDOR_STOREFRONT_BRANDING_EVENT, onBranding);
    return () => {
      window.removeEventListener("vendorDataUpdated", refresh);
      window.removeEventListener(MIGOO_VENDOR_STOREFRONT_BRANDING_EVENT, onBranding);
    };
  }, [vendorId]);

  const chatSupportTitle = vendorId
    ? `${vendorDisplayName || vendorId} Support`
    : "SECURE Support";

  const [chatParticipant, setChatParticipant] = useState<ChatParticipant>(() =>
    resolveChatParticipant()
  );

  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);

  const guestNeedsPhone = useCallback(() => {
    const p = resolveChatParticipant();
    return p.isGuest && guestNeedsPhoneCollection();
  }, []);

  // Load persisted state from localStorage
  const [isOpen, setIsOpen] = useState(() => {
    try {
      const saved = localStorage.getItem("migoo-chat-isOpen");
      return Boolean(saved && JSON.parse(saved));
    } catch {
      return false;
    }
  });

  // Animation trigger state for first load
  const [isMounted, setIsMounted] = useState(false);

  const conversationStorageKey = vendorId
    ? `migoo-chat-conversationId-vendor-${vendorId}`
    : "migoo-chat-conversationId";

  const [conversationId, setConversationId] = useState(() => {
    const savedConvId = localStorage.getItem(conversationStorageKey);
    if (savedConvId) {
      return savedConvId;
    }

    const participant = resolveChatParticipant();
    const emailToken = sanitizeChatEmailToken(participant.email);
    let newConvId;
    if (vendorId) {
      newConvId = `conv-vendor-${String(vendorId).trim().toLowerCase()}-${emailToken}`;
    } else {
      newConvId = `conv-${emailToken}`;
    }

    localStorage.setItem(conversationStorageKey, newConvId);
    return newConvId;
  });

  const adoptConversationId = (nextId: unknown) => {
    const normalized = String(nextId || "").trim();
    if (!normalized) return;
    setConversationId((prev) => {
      if (prev === normalized) return prev;
      try {
        localStorage.setItem(conversationStorageKey, normalized);
      } catch {
        /* ignore storage failures */
      }
      return normalized;
    });
  };

  const applyFreshGuestChatSession = useCallback(() => {
    const current = resolveChatParticipant();
    if (current.isGuest && current.email) {
      purgeGuestChatClientData(current.email);
    }
    try {
      localStorage.removeItem(conversationStorageKey);
    } catch {
      /* ignore */
    }

    const participant = resolveChatParticipant();
    setChatParticipant(participant);
    const newConvId = createConversationIdForParticipant(participant.email, vendorId);
    try {
      localStorage.setItem(conversationStorageKey, newConvId);
    } catch {
      /* ignore */
    }
    setConversationId(newConvId);
    const welcome = [createWelcomeMessage(vendorId, vendorDisplayName || undefined)];
    setMessages(welcome);
    writeLocalChatMessages(chatMessagesStorageKey(vendorId, participant.email), welcome);
    writeSyncedChatEmail(vendorId, participant.email);
    lastMessageIdRef.current = null;
    setShowPhoneDialog(false);
    setPhoneInput("");
    setUnreadCount(0);
    setMessageInput("");
    setSelectedImage(null);
    void ensureGuestDisplayCodeAllocated(participant.email).then(() => {
      setChatParticipant(resolveChatParticipant());
    });
  }, [vendorId, vendorDisplayName, conversationStorageKey]);
  
  const [messages, setMessages] = useState<Message[]>(() => {
    const participant = resolveChatParticipant();
    const cached = readLocalChatMessages<Message>(
      chatMessagesStorageKey(vendorId, participant.email || undefined)
    );
    if (cached && cached.length > 0) return cached;
    const brandingName = vendorId ? readVendorStorefrontDisplayName(vendorId) : undefined;
    return [createWelcomeMessage(vendorId, brandingName)];
  });
  
  const [messageInput, setMessageInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Align thread id with Edge canonical keys (slug vs internal id — fixes history + admin realtime).
  useEffect(() => {
    const participant = resolveChatParticipant();
    setChatParticipant(participant);
    const canonical = canonicalChatThreadId(
      participant.email,
      vendorId ? String(vendorId).trim() : undefined
    );
    if (canonical) adoptConversationId(canonical);
  }, [customerEmail, customerName, vendorId, isAuthenticated]);

  useEffect(() => {
    const participant = resolveChatParticipant();
    if (!participant.isGuest) return;
    let cancelled = false;
    void (async () => {
      const code = await ensureGuestDisplayCodeAllocated(participant.email);
      if (cancelled) return;
      if (code) {
        setChatParticipant(resolveChatParticipant());
        setMessages((prev) => {
          const welcomeOnly = prev.length === 1 && prev[0]?.id === "welcome-1";
          if (!welcomeOnly) return prev;
          return [
            {
              ...prev[0],
              senderName: resolveChatParticipant().name,
            },
          ];
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerEmail, customerName, vendorId, isAuthenticated]);

  useEffect(() => {
    const storeName = vendorId ? vendorDisplayName || vendorId : "SECURE Store";
    const welcomeText = t("floatingChat.welcome").replace("{storeName}", storeName);
    setMessages((prev) => {
      const welcomeOnly = prev.length === 1 && prev[0]?.id === "welcome-1";
      if (!welcomeOnly) return prev;
      return [
        {
          ...prev[0],
          text: welcomeText,
          senderName: chatSupportTitle,
        },
      ];
    });
  }, [vendorId, vendorDisplayName, t, chatSupportTitle]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const pollingIntervalRef = useRef<number | null>(null);
  const lsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const appendRealtimeMessage = useCallback((msg: Record<string, unknown>) => {
    const id = String(msg.id ?? "");
    if (!id) return;
    const isAdmin = String(msg.sender) === "admin";
    setMessages((prev) => {
      if (prev.some((m) => m.id === id)) return prev;
      const withoutWelcome =
        prev.length === 1 && prev[0]?.id === "welcome-1" ? [] : prev;
      const merged = mergeChatMessageLists(withoutWelcome, [msg as unknown as Message]);
      lastMessageIdRef.current = merged[merged.length - 1]?.id || null;
      return merged;
    });
    if (isAdmin && !isOpenRef.current) {
      setUnreadCount((c) => c + 1);
    }
  }, []);

  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (scrollDebounceRef.current) window.clearTimeout(scrollDebounceRef.current);
    scrollDebounceRef.current = window.setTimeout(() => {
      scrollDebounceRef.current = null;
      const el = messagesEndRef.current;
      if (!el) return;
      const behavior = messages.length > 36 ? ("auto" as const) : ("smooth" as const);
      el.scrollIntoView({ behavior, block: "end" });
    }, CHAT_SCROLL_DEBOUNCE_MS);
    return () => {
      if (scrollDebounceRef.current) window.clearTimeout(scrollDebounceRef.current);
    };
  }, [messages]);

  // Trigger mount animation on first load
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMounted(true);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Merge DB history with local cache (local = instant UI; server wins on conflicts).
  const syncFromServer = async (opts: { silent?: boolean; force?: boolean } = {}) => {
    const silent = opts.silent ?? false;
    const participant = resolveChatParticipant();
    const email = participant.email;
    if (!email) return;

    const storageKey = chatMessagesStorageKey(vendorId, email);
    const emailNorm = email.toLowerCase();
    const prevSynced = readSyncedChatEmail(vendorId);
    const accountSwitched = Boolean(prevSynced && prevSynced !== emailNorm);
    const force = opts.force || accountSwitched;

    if (!silent) setLoading(true);
    try {
      const response = (await chatApi.getHistory({
        customerEmail: email,
        vendorId: vendorId ? String(vendorId).trim() : undefined,
      })) as {
        conversationId?: string;
        messages?: Message[];
        conversation?: { customerPhone?: string; customerName?: string };
      };

      if (response.conversationId) {
        adoptConversationId(response.conversationId);
      }

      const serverPhone = String(response.conversation?.customerPhone || "").trim();
      if (participant.isGuest && serverPhone && !hasGuestPhoneSaved()) {
        writeGuestChatPhone(serverPhone);
        setChatParticipant(resolveChatParticipant());
      }

      if (participant.isGuest && response.conversation?.customerName) {
        if (syncGuestDisplayCodeFromCustomerName(response.conversation.customerName)) {
          setChatParticipant(resolveChatParticipant());
        } else {
          void ensureGuestDisplayCodeAllocated(email).then(() => {
            setChatParticipant(resolveChatParticipant());
          });
        }
      }

      const serverMessages = (response.messages || []).sort(
        (a: Message, b: Message) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const localBase = force
        ? []
        : messagesRef.current.filter((m) => m.id !== "welcome-1");

      if (
        participant.isGuest &&
        !response.conversation &&
        serverMessages.length === 0 &&
        localBase.length > 0
      ) {
        applyFreshGuestChatSession();
        return;
      }

      const merged =
        serverMessages.length > 0
          ? mergeChatMessageLists(localBase, serverMessages)
          : localBase.length > 0
            ? localBase
            : [createWelcomeMessage(vendorId, vendorDisplayName || undefined)];

      setMessages(merged);
      writeLocalChatMessages(storageKey, merged);
      writeSyncedChatEmail(vendorId, email);
      lastMessageIdRef.current = merged[merged.length - 1]?.id || null;
    } catch (error) {
      console.error("Failed to sync chat from server:", error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadMessages = async (silent = false) => {
    await syncFromServer({ silent, force: false });
  };

  const pollForNewMessages = async () => {
    await syncFromServer({ silent: true, force: false });
  };

  // Signed-in: reconcile with DB when thread/session changes (not on every open/close — avoids
  // overwriting realtime messages with a stale localStorage snapshot before debounce flushes).
  useEffect(() => {
    const participant = resolveChatParticipant();
    if (!participant.email) return;
    void syncFromServer({ silent: true, force: false });
  }, [conversationId, isAuthenticated, customerEmail, customerName, vendorId]);

  // Full refresh when the panel opens so the thread matches the server.
  useEffect(() => {
    if (!isOpen) return;
    const participant = resolveChatParticipant();
    if (!participant.email || !conversationId) return;
    void syncFromServer({ silent: false, force: false });
  }, [isOpen, isAuthenticated, vendorId, conversationId, customerEmail, customerName]);

  // Realtime is primary; reconcile with server when tab becomes visible (missed deltas / offline).
  useEffect(() => {
    if (typeof document === "undefined") return;
    let visTimer: ReturnType<typeof setTimeout> | null = null;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (visTimer) clearTimeout(visTimer);
      visTimer = window.setTimeout(() => {
        visTimer = null;
        if (isOpenRef.current) {
          void loadMessages(true);
        } else {
          void pollForNewMessages();
        }
      }, 800);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (visTimer) clearTimeout(visTimer);
    };
  }, [conversationId]);

  // HTTP fallback: slow poll while chat is expanded; faster poll while closed/minimized (Realtime can still miss).
  useEffect(() => {
    if (!conversationId || !docVisible) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void pollForNewMessages();
    };

    const intervalMs = !isOpen
        ? POLLING_INTERVALS_MS.CHAT_HTTP_FALLBACK_DOCKET
        : POLLING_INTERVALS_MS.CHAT_ACTIVE_THREAD_POLL;

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    pollingIntervalRef.current = window.setInterval(tick, intervalMs);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isOpen, conversationId, docVisible, isAuthenticated]);

  // Header “Mark all read” clears widget unread without opening the panel.
  useEffect(() => {
    const onDismiss = () => {
      setUnreadCount(0);
      if (onUnreadCountChange) onUnreadCountChange(0);
    };
    window.addEventListener(MIGOO_CHAT_DISMISS_UNREAD_EVENT, onDismiss);
    return () => window.removeEventListener(MIGOO_CHAT_DISMISS_UNREAD_EVENT, onDismiss);
  }, [onUnreadCountChange]);

  // Realtime: admin replies on this thread id + account-wide channel (all vendor tabs).
  useEffect(() => {
    if (!conversationId) return;
    const unsubs: Array<() => void> = [];
    const threadIds = new Set<string>([conversationId]);

    const participant = resolveChatParticipant();
    const email = participant.email;
    if (email) {
      const mainThreadId = canonicalChatThreadId(email, vendorId);
      if (mainThreadId) threadIds.add(mainThreadId);
    }

    unsubs.push(
      subscribeConversationBroadcastMulti([...threadIds], appendRealtimeMessage)
    );

    if (email) {
      unsubs.push(subscribeCustomerChatBroadcast(email, appendRealtimeMessage));
      if (isGuestChatEmail(email)) {
        unsubs.push(
          subscribeGuestChatReset(email, (payload) => {
            const target = String(payload.customerEmail || "").trim().toLowerCase();
            if (target && target === email.trim().toLowerCase()) {
              applyFreshGuestChatSession();
            }
          }),
        );
      }
    }

    return () => {
      for (const off of unsubs) off();
    };
  }, [conversationId, customerEmail, customerName, appendRealtimeMessage, applyFreshGuestChatSession]);

  // Reset unread count when chat is opened
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
    }
  }, [isOpen]);

  // Handle forceOpen prop
  useEffect(() => {
    if (!forceOpen) return;
    setIsOpen(true);
    onOpen?.();
  }, [forceOpen, onOpen]);

  // Notify parent of unread count changes
  useEffect(() => {
    if (onUnreadCountChange) {
      onUnreadCountChange(unreadCount);
    }
  }, [unreadCount, onUnreadCountChange]);

  // Account switch: force DB sync so other devices match this account.
  useEffect(() => {
    const syncSessionAndHistory = () => {
      const participant = resolveChatParticipant();
      setChatParticipant(participant);
      const email = participant.email;
      if (!email) return;
      const canonical = canonicalChatThreadId(
        email,
        vendorId ? String(vendorId).trim() : undefined
      );
      if (canonical) adoptConversationId(canonical);
      const prevSynced = readSyncedChatEmail(vendorId);
      const forceDb =
        !prevSynced || prevSynced !== email.trim().toLowerCase();
      const storageKey = chatMessagesStorageKey(vendorId, email);
      if (!forceDb) {
        const cached = readLocalChatMessages<Message>(storageKey);
        if (cached?.length) setMessages(cached);
      }
      void syncFromServer({ silent: true, force: forceDb });
    };

    syncSessionAndHistory();
    window.addEventListener("storage", syncSessionAndHistory);
    window.addEventListener("focus", syncSessionAndHistory);
    window.addEventListener(MIGOO_USER_SESSION_CHANGED_EVENT, syncSessionAndHistory);

    return () => {
      window.removeEventListener("storage", syncSessionAndHistory);
      window.removeEventListener("focus", syncSessionAndHistory);
      window.removeEventListener(MIGOO_USER_SESSION_CHANGED_EVENT, syncSessionAndHistory);
    };
  }, [isAuthenticated, customerEmail, customerName, vendorId]);

  // Persist messages to localStorage for fast reopen (realtime + sends update state too).
  useEffect(() => {
    const participant = resolveChatParticipant();
    const email = participant.email;
    if (!email) return;
    const storageKey = chatMessagesStorageKey(vendorId, email);
    if (lsDebounceRef.current) window.clearTimeout(lsDebounceRef.current);
    lsDebounceRef.current = window.setTimeout(() => {
      lsDebounceRef.current = null;
      writeLocalChatMessages(storageKey, messages);
    }, CHAT_LOCAL_STORAGE_DEBOUNCE_MS);
    return () => {
      if (lsDebounceRef.current) window.clearTimeout(lsDebounceRef.current);
    };
  }, [messages, vendorId, customerEmail, customerName]);

  useEffect(() => {
    return () => {
      if (lsDebounceRef.current) {
        window.clearTimeout(lsDebounceRef.current);
        lsDebounceRef.current = null;
      }
      const participant = resolveChatParticipant();
      const email = participant.email;
      if (!email) return;
      writeLocalChatMessages(
        chatMessagesStorageKey(vendorId, email),
        messagesRef.current
      );
    };
  }, [vendorId, customerEmail, customerName]);

  useEffect(() => {
    localStorage.setItem("migoo-chat-isOpen", JSON.stringify(isOpen));
  }, [isOpen]);

  useEffect(() => {
    setFloatingChatOpen(isOpen);
    return () => setFloatingChatOpen(false);
  }, [isOpen, setFloatingChatOpen]);

  const saveGuestPhone = async (rawPhone: string) => {
    const normalized = normalizeMyanmarPhone(rawPhone);
    if (!normalized) {
      toast.error("Enter a valid Myanmar phone number", {
        description: "Use +959XXXXXXXXX or 09XXXXXXXXX",
      });
      return false;
    }

    setSavingPhone(true);
    writeGuestChatPhone(normalized);
    const participant = { ...resolveChatParticipant(), phone: normalized };
    setChatParticipant(participant);

    const notifyAdmin = () => {
      void broadcastInboxPing({
        t: Date.now(),
        conversationId,
        customerEmail: participant.email,
        customerName: participant.name,
        customerPhone: normalized,
      });
    };

    try {
      await chatApi.updateConversationContact({
        conversationId,
        customerPhone: normalized,
      });
      notifyAdmin();
      setShowPhoneDialog(false);
      setPhoneInput("");
      toast.success("Phone number saved", {
        description: "Our sales team can reach you on this number.",
      });
      return true;
    } catch (updateError) {
      console.warn("Contact endpoint unavailable, falling back to chat message:", updateError);
      try {
        const phoneLabel = formatCustomerPhoneDisplay(normalized);
        const response = (await chatApi.sendMessage({
          text: `Phone number: ${phoneLabel}`,
          sender: "customer",
          senderName: participant.name,
          customerEmail: participant.email,
          customerPhone: normalized,
          conversationId,
          vendorId,
        })) as { success?: boolean; message?: Message };

        if (response?.message) {
          setMessages((prev) => {
            const merged = mergeChatMessageLists(prev, [response.message!]);
            return merged.sort(
              (a, b) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          });
          notifyAdmin();
          setShowPhoneDialog(false);
          setPhoneInput("");
          toast.success("Phone number saved", {
            description: "Our sales team can reach you on this number.",
          });
          return true;
        }
      } catch (fallbackError) {
        console.error("Failed to save phone via fallback message:", fallbackError);
      }

      setShowPhoneDialog(false);
      setPhoneInput("");
      toast.success("Phone number saved on this device", {
        description: "It will be shared with our sales team when you send your next message.",
      });
      return true;
    } finally {
      setSavingPhone(false);
    }
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() && !selectedImage) return;

    let participant = resolveChatParticipant();
    if (participant.isGuest) {
      await ensureGuestDisplayCodeAllocated(participant.email);
      participant = resolveChatParticipant();
      setChatParticipant(participant);
    }
    const actualCustomerName = participant.name;
    const actualCustomerEmail = participant.email;
    const customerProfileImage = participant.profileImage;
    const customerPhone = participant.phone;

    const messageText = messageInput;
    const imageUrl = selectedImage || undefined;

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      text: messageText,
      timestamp: new Date().toISOString(),
      sender: "customer",
      senderName: actualCustomerName,
      status: "sent",
      imageUrl: imageUrl
    };

    // Add to UI immediately
    setMessages(prev => [...prev, newMessage]);

    // Send to server
    try {
      const response = (await chatApi.sendMessage({
        text: messageText,
        sender: "customer",
        senderName: actualCustomerName,
        customerEmail: actualCustomerEmail,
        customerPhone: customerPhone || undefined,
        conversationId: conversationId,
        imageUrl: imageUrl,
        vendorId: vendorId,
        customerProfileImage: customerProfileImage
      })) as { success?: boolean; message?: Message };

      if (response?.message) {
        setMessageInput("");
        setSelectedImage(null);
        const canonicalId = String(
          (response.message as { conversationId?: unknown }).conversationId || ""
        ).trim();
        adoptConversationId(canonicalId || conversationId);
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== newMessage.id);
          const merged = [...without, response.message!];
          return merged.sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        });
        const broadcastId = canonicalId || conversationId;
        void broadcastConversationMessage(broadcastId, response.message);
        const preview =
          messageText.trim() ||
          (imageUrl ? "Image" : "—");
        const msgVendorSource = String(
          (response.message as { vendorSource?: unknown }).vendorSource || ""
        ).trim();
        void broadcastInboxPing({
          t: Date.now(),
          conversationId: broadcastId,
          lastMessage: preview,
          timestamp: response.message.timestamp,
          customerEmail: actualCustomerEmail,
          customerName: resolveChatParticipant().name,
          customerPhone: customerPhone || undefined,
          customerProfileImage: customerProfileImage || undefined,
          vendorId: vendorId ? String(vendorId) : undefined,
          vendorSource: msgVendorSource || undefined,
          unreadBump: true,
          message: response.message,
        });

        if (guestNeedsPhone()) {
          setShowPhoneDialog(true);
        }
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== newMessage.id));
        toast.error("Failed to send message");
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== newMessage.id));
      const description =
        error instanceof ApiError && error.message
          ? error.message
          : "Check your connection and try again.";
      toast.error("Failed to send message", { description });
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please select a valid image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image size should be less than 10MB");
      return;
    }

    setUploadingImage(true);
    try {
      const options = {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        fileType: 'image/jpeg' as const,
      };

      const compressedFile = await imageCompression(file, options);

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = reader.result as string;
        
        try {
          const uploadResponse = await chatApi.uploadImage(
            base64Data,
            compressedFile.name || 'image.jpg',
            conversationId
          );

          if (uploadResponse.success && uploadResponse.imageUrl) {
            setSelectedImage(uploadResponse.imageUrl);
          } else {
            throw new Error("Failed to upload image");
          }
        } catch (uploadError) {
          console.error("Upload error:", uploadError);
          toast.error("Failed to upload image");
        } finally {
          setUploadingImage(false);
        }
      };

      reader.onerror = () => {
        toast.error("Failed to read image file");
        setUploadingImage(false);
      };

      reader.readAsDataURL(compressedFile);
    } catch (error) {
      console.error("Compression error:", error);
      toast.error("Failed to compress image");
      setUploadingImage(false);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const cancelImageSelection = () => {
    setSelectedImage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const handleOpenChat = () => {
    setChatParticipant(resolveChatParticipant());
    setIsOpen(true);
  };

  const phoneCollectionDialog = (
    <Dialog open={showPhoneDialog} onOpenChange={setShowPhoneDialog}>
      <DialogContent className="sm:max-w-md p-8">
        <DialogHeader>
          <DialogTitle>{t("floatingChat.phoneTitle")}</DialogTitle>
          <DialogDescription>
            {t("floatingChat.phoneDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col space-y-4 pt-2">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto">
            <Phone className="w-8 h-8 text-blue-600" />
          </div>
          <Input
            type="tel"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder={t("floatingChat.phonePlaceholder")}
            className="rounded-xl"
          />
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              disabled={savingPhone || !phoneInput.trim()}
              onClick={() => void saveGuestPhone(phoneInput)}
              className="gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            >
              {savingPhone ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {t("floatingChat.savePhone")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  const stickyAnchorClass = aboveStickyPurchaseBar ? "floating-chat-anchor--above-sticky" : "";
  const stickyFabClass = aboveStickyPurchaseBar ? "floating-chat-fab-anchor--above-sticky" : "";
  const soloFabClass = !reserveBackToTopStack && !aboveStickyPurchaseBar ? "floating-chat-fab-anchor--solo" : "";

  const renderPortal = (node: ReactNode) => {
    if (typeof document === "undefined") return node;
    return createPortal(node, document.body);
  };

  if (!isOpen) {
    return renderPortal(
      <>
        <div
          className={`floating-chat-fab-anchor ${stickyFabClass} ${soloFabClass} transition-all duration-700 ease-out ${
            isMounted ? "translate-x-0 opacity-100" : "translate-x-20 opacity-0"
          }`}
        >
          <Button
            onClick={handleOpenChat}
            size="lg"
            aria-label="Open chat"
            className="h-11 w-11 md:h-14 md:w-14 rounded-full shadow-2xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 transition-all duration-300 hover:scale-110 relative border-0 flex items-center justify-center"
          >
            <MessageCircleMore className="w-5 h-5 md:w-7 md:h-7 text-white" />

            {unreadCount > 0 && (
              <Badge className="absolute -top-1 -right-1 h-5 w-5 md:h-6 md:w-6 flex items-center justify-center p-0 bg-red-500 border-2 border-white text-xs font-semibold">
                {unreadCount}
              </Badge>
            )}
          </Button>
        </div>

        {phoneCollectionDialog}
      </>
    );
  }

  return renderPortal(
    <>
      <div className={`floating-chat-anchor ${stickyAnchorClass}`}>
        <div className="floating-chat-panel bg-white shadow-2xl border border-slate-200 transition-all duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-t-2xl flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
              <MessageCircleMore className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">{chatSupportTitle}</h3>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-xs text-white/90">Online</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Badge className="h-6 min-w-[1.5rem] px-1.5 flex items-center justify-center border-2 border-white bg-red-500 text-white text-xs font-semibold shadow-sm">
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="text-white hover:bg-white/20 h-8 w-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Chat Body */}
        <>
            {/* Messages: flex-1 fills shell; inner min-h-full + justify-end pins short threads above composer */}
            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-slate-50">
              <div className="min-h-full flex flex-col justify-end gap-4 p-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex min-w-0 w-full ${message.sender === "customer" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[min(85%,18rem)] shrink break-words ${
                      message.sender === "customer"
                        ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                        : "bg-white border border-slate-200 text-slate-900"
                    } rounded-2xl px-4 py-2.5 shadow-sm`}
                  >
                    {message.sender === "admin" && (
                      <p className="text-xs font-semibold mb-1 text-blue-600">
                        {message.senderName}
                      </p>
                    )}
                    {message.imageUrl && (
                      <img
                        src={message.imageUrl}
                        alt="Uploaded"
                        className="max-w-full h-auto rounded mb-2"
                      />
                    )}
                    {message.text && (
                      <p className="text-sm leading-relaxed break-words">{message.text}</p>
                    )}
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <p
                        className={`text-xs ${
                          message.sender === "customer" ? "text-white/70" : "text-slate-500"
                        }`}
                      >
                        {formatTime(message.timestamp)}
                      </p>
                      {message.sender === "customer" && message.status && (
                        <span className="text-white/70">
                          {message.status === "sent" && "✓"}
                          {message.status === "delivered" && "✓✓"}
                          {message.status === "read" && "✓✓"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} className="h-px shrink-0" aria-hidden />
              </div>
            </div>

            {/* Input Area */}
            <div className="floating-chat-input p-3 bg-white border-t border-slate-200 rounded-b-2xl shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />

              {selectedImage && (
                <div className="mb-2 flex items-center gap-2 p-2 bg-slate-100 rounded-lg">
                  <img 
                    src={selectedImage} 
                    alt="Preview" 
                    className="w-12 h-12 rounded object-cover"
                  />
                  <span className="text-xs text-slate-600 flex-1">Image ready to send</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={cancelImageSelection}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <Textarea
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("chat.typeMessage")}
                  className="resize-none border-slate-300 rounded-xl min-h-[40px] max-h-[80px] w-full text-sm"
                  rows={1}
                />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700"
                      onClick={() => fileInputRef.current?.click()}
                      title="Upload image"
                    >
                      {uploadingImage ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  <Button
                    onClick={handleSendMessage}
                    disabled={
                      uploadingImage || (!messageInput.trim() && !selectedImage)
                    }
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 h-9 px-4 rounded-xl flex items-center gap-2 shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    <span className="text-sm">{t("chat.send")}</span>
                  </Button>
                </div>
              </div>
            </div>
          </>
        </div>
      </div>
      {phoneCollectionDialog}
    </>
  );
}