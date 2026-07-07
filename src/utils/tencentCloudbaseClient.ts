import {
  cloudbaseApiBaseUrl,
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
} from "../../utils/tencent/cloudbase";

type AuthUser = {
  id: string;
  email?: string;
  [key: string]: unknown;
};

type AuthSession = {
  access_token: string;
  user: AuthUser;
  expires_at?: number;
};

type AuthResult = {
  data: {
    user: AuthUser | null;
    session?: AuthSession | null;
  };
  error: { message: string } | null;
};

type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
type ChannelCallback = (payload: unknown) => void;
type SubscribeCallback = (status: ChannelStatus) => void;

const SESSION_KEY = "nexa-cloudbase-auth-session";

function apiUrl(path: string): string {
  return `${cloudbaseApiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function readSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    return parsed?.user?.id ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(session: AuthSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* private mode / quota errors are non-fatal */
  }
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  return {
    "Content-Type": "application/json",
    ...getCloudBaseRequestHeaders(),
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(!session?.access_token && cloudbasePublishableKey
      ? { Authorization: `Bearer ${cloudbasePublishableKey}` }
      : {}),
  };
}

class TencentRealtimeChannel {
  private callbacks = new Map<string, ChannelCallback[]>();
  private broadcast?: BroadcastChannel;
  private storageHandler?: (event: StorageEvent) => void;
  private subscribed = false;

  constructor(private readonly name: string) {}

  on(type: string, filter: Record<string, unknown>, callback: ChannelCallback): this {
    const eventName =
      type === "broadcast" && typeof filter?.event === "string" ? filter.event : type;
    const list = this.callbacks.get(eventName) || [];
    list.push(callback);
    this.callbacks.set(eventName, list);
    return this;
  }

  subscribe(callback?: SubscribeCallback): this {
    if (this.subscribed || typeof window === "undefined") {
      callback?.("SUBSCRIBED");
      return this;
    }

    this.subscribed = true;
    const storageKey = this.storageKey();

    try {
      this.broadcast = new BroadcastChannel(this.name);
      this.broadcast.onmessage = (event) => this.dispatch(event.data);
    } catch {
      this.broadcast = undefined;
    }

    this.storageHandler = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        this.dispatch(JSON.parse(event.newValue));
      } catch {
        /* ignore malformed cross-tab payloads */
      }
    };
    window.addEventListener("storage", this.storageHandler);

    queueMicrotask(() => callback?.("SUBSCRIBED"));
    return this;
  }

  async send(message: { type?: string; event?: string; payload?: unknown }): Promise<void> {
    const eventName = message.event || message.type || "message";
    const envelope = {
      event: eventName,
      payload: message.payload,
      sentAt: Date.now(),
    };
    this.dispatch(envelope);
    this.broadcast?.postMessage(envelope);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(this.storageKey(), JSON.stringify(envelope));
        window.localStorage.removeItem(this.storageKey());
      } catch {
        /* ignore storage failures */
      }
    }
  }

  close(): void {
    this.subscribed = false;
    this.broadcast?.close();
    this.broadcast = undefined;
    if (this.storageHandler && typeof window !== "undefined") {
      window.removeEventListener("storage", this.storageHandler);
    }
    this.storageHandler = undefined;
    this.callbacks.clear();
  }

  private storageKey(): string {
    return `nexa-cloudbase-realtime:${this.name}`;
  }

  private dispatch(envelope: unknown): void {
    const eventName =
      envelope && typeof envelope === "object" && "event" in envelope
        ? String((envelope as { event?: unknown }).event || "")
        : "message";
    const payload =
      envelope && typeof envelope === "object" && "payload" in envelope
        ? (envelope as { payload?: unknown }).payload
        : envelope;

    for (const cb of this.callbacks.get(eventName) || []) {
      cb({ payload });
    }
    for (const cb of this.callbacks.get("postgres_changes") || []) {
      cb(payload);
    }
  }
}

async function persistAuthSessionFromLoginResponse(data: Record<string, unknown>): Promise<AuthResult> {
  const user = data.user as AuthUser | undefined;
  if (!user?.id) {
    return {
      data: { user: null, session: null },
      error: { message: String(data?.error || data?.message || "Invalid email or password") },
    };
  }

  const session: AuthSession = {
    access_token: String(data.accessToken || data.token || cloudbasePublishableKey || ""),
    user,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  };
  writeSession(session);
  return { data: { user, session }, error: null };
}

export type TencentCloudBaseCompatClient = {
  auth: {
    getSession: () => Promise<{ data: { session: AuthSession | null }; error: null }>;
    signInWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<AuthResult>;
    /** Admin portal — staff/owner accounts only (separate from storefront customer login). */
    signInStaffWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<AuthResult>;
    signOut: () => Promise<{ error: null }>;
    updateUser: (updates: { password?: string }) => Promise<{ data: unknown; error: null | { message: string } }>;
  };
  channel: (name: string, options?: Record<string, unknown>) => TencentRealtimeChannel;
  removeChannel: (channel: TencentRealtimeChannel) => Promise<void>;
};

export function createTencentCloudBaseCompatClient(): TencentCloudBaseCompatClient {
  return {
    auth: {
      async getSession() {
        return { data: { session: readSession() }, error: null };
      },

      async signInWithPassword({ email, password }) {
        try {
          const response = await fetch(apiUrl("/auth/login"), {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ email, password }),
          });
          const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          if (!response.ok || !data?.user) {
            return {
              data: { user: null, session: null },
              error: { message: String(data?.error || data?.message || "Invalid email or password") },
            };
          }
          return persistAuthSessionFromLoginResponse(data);
        } catch (error) {
          return {
            data: { user: null, session: null },
            error: { message: error instanceof Error ? error.message : "Login failed" },
          };
        }
      },

      async signInStaffWithPassword({ email, password }) {
        try {
          const response = await fetch(apiUrl("/auth/staff/login"), {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ email, password }),
          });
          const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          if (!response.ok || !data?.user) {
            const raw = String(data?.error || data?.message || "Invalid email or password");
            const message =
              response.status === 404 || raw.toLowerCase() === "not found"
                ? "Admin login is not available on the server yet. Deploy the latest make-server-16010b6f function (TCB console upload), then sign in again."
                : raw;
            return {
              data: { user: null, session: null },
              error: { message },
            };
          }
          return persistAuthSessionFromLoginResponse(data);
        } catch (error) {
          return {
            data: { user: null, session: null },
            error: { message: error instanceof Error ? error.message : "Login failed" },
          };
        }
      },

      async signOut() {
        writeSession(null);
        return { error: null };
      },

      async updateUser(updates) {
        const session = readSession();
        if (!session?.user?.id) {
          return { data: null, error: { message: "No active CloudBase session" } };
        }
        if (!updates.password) return { data: session.user, error: null };

        const response = await fetch(apiUrl("/auth/update-password"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ userId: session.user.id, password: updates.password }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          return { data: null, error: { message: data?.error || "Password update failed" } };
        }
        return { data: session.user, error: null };
      },
    },

    channel(name: string) {
      return new TencentRealtimeChannel(name);
    },

    async removeChannel(channel: TencentRealtimeChannel) {
      channel.close();
    },
  };
}
