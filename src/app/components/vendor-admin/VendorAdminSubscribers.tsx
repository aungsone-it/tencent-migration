import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CircleDollarSign,
  Loader2,
  Mail,
  Phone,
  Search,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  cloudbaseApiBaseUrl,
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
} from "../../../../utils/supabase/info";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import { Input } from "../ui/input";

type Subscriber = {
  id: string;
  customerId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  profileImageUrl?: string;
  status: "active" | "expired";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  updatedAt: string;
  plan: {
    id: string;
    name: string;
    price: number;
  };
};

type Summary = {
  total: number;
  active: number;
  expired: number;
  monthlyRevenue: number;
};

function headers(): Record<string, string> {
  return {
    ...getCloudBaseRequestHeaders(),
    ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
  };
}

function formatMmk(value: number): string {
  return `${Math.round(value || 0).toLocaleString()} MMK`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function displayEmail(value: unknown): string {
  const email = String(value || "").trim();
  return email.toLowerCase().endsWith("@phone.migoo.store") ? "" : email;
}

function renderableProfileImage(profile: Record<string, unknown>): string {
  const candidates = [profile.profileImageUrl, profile.avatar, profile.profileImage];
  return (
    candidates.find((value) => {
      const src = String(value || "").trim();
      return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:image/");
    }) as string | undefined
  ) || "";
}

async function enrichSubscriberProfiles(rows: Subscriber[]): Promise<Subscriber[]> {
  const result = [...rows];
  const workerCount = Math.min(6, result.length);
  let nextIndex = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= result.length) return;
      const subscriber = result[index];
      if (!subscriber?.customerId) continue;
      try {
        const response = await fetch(
          `${cloudbaseApiBaseUrl}/auth/profile/${encodeURIComponent(subscriber.customerId)}`,
          { headers: headers() },
        );
        if (!response.ok) continue;
        const data = await response.json().catch(() => ({}));
        const profile =
          data?.user && typeof data.user === "object"
            ? (data.user as Record<string, unknown>)
            : {};
        result[index] = {
          ...subscriber,
          customerName:
            String(profile.name || profile.fullName || subscriber.customerName || "").trim() ||
            "Customer",
          customerEmail:
            displayEmail(profile.email || profile.authEmail) || subscriber.customerEmail || "",
          customerPhone:
            String(profile.phone || subscriber.customerPhone || "").trim(),
          profileImageUrl:
            renderableProfileImage(profile) || subscriber.profileImageUrl || "",
        };
      } catch {
        // Keep subscription snapshot when a customer profile is temporarily unavailable.
      }
    }
  });
  await Promise.all(workers);
  return result;
}

function SubscriberAvatar({ subscriber, initials }: { subscriber: Subscriber; initials: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (subscriber.profileImageUrl && !imageFailed) {
    return (
      <img
        src={subscriber.profileImageUrl}
        alt=""
        className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm"
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white shadow-sm">
      {initials}
    </div>
  );
}

export function VendorAdminSubscribers({
  vendorId,
}: {
  vendorId: string;
  vendorName: string;
}) {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    active: 0,
    expired: 0,
    monthlyRevenue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const loadSubscribers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/vendor/subscribers/${encodeURIComponent(vendorId)}`,
        { headers: headers() },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load subscribers");
      const baseSubscribers = Array.isArray(data.subscribers) ? data.subscribers : [];
      setSubscribers(await enrichSubscriberProfiles(baseSubscribers));
      setSummary(data.summary || { total: 0, active: 0, expired: 0, monthlyRevenue: 0 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load subscribers");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void loadSubscribers();
  }, [loadSubscribers]);

  const visibleSubscribers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return subscribers;
    const compact = normalized.replace(/[\s+()_-]/g, "");
    return subscribers.filter((subscriber) =>
      [
        subscriber.customerName,
        subscriber.customerEmail,
        subscriber.customerPhone,
        subscriber.plan?.name,
        subscriber.status,
      ].some((value) => {
        const candidate = String(value || "").toLowerCase();
        return (
          candidate.includes(normalized) ||
          (compact.length > 0 && candidate.replace(/[\s+()_-]/g, "").includes(compact))
        );
      }),
    );
  }, [query, subscribers]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Subscribers</h1>
        <p className="text-slate-600">View customers who purchased one of your membership plans.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-slate-500">Total subscribers</p><p className="mt-1 text-2xl font-bold">{summary.total}</p></div>
            <span className="rounded-xl bg-violet-50 p-3"><Users className="h-6 w-6 text-violet-600" /></span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-slate-500">Active</p><p className="mt-1 text-2xl font-bold text-emerald-700">{summary.active}</p></div>
            <span className="rounded-xl bg-emerald-50 p-3"><UserCheck className="h-6 w-6 text-emerald-600" /></span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-slate-500">Expired</p><p className="mt-1 text-2xl font-bold text-slate-700">{summary.expired}</p></div>
            <span className="rounded-xl bg-slate-100 p-3"><CalendarClock className="h-6 w-6 text-slate-600" /></span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-slate-500">Active plan value</p><p className="mt-1 text-xl font-bold">{formatMmk(summary.monthlyRevenue)}</p></div>
            <span className="rounded-xl bg-amber-50 p-3"><CircleDollarSign className="h-6 w-6 text-amber-600" /></span>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              aria-label="Search subscribers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone, email, plan, or status..."
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Clear subscriber search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {query ? `${visibleSubscribers.length} of ${subscribers.length} subscribers` : `${subscribers.length} subscribers`}
          </p>
        </div>

        {visibleSubscribers.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Users className="mx-auto h-12 w-12 text-slate-300" />
            <h2 className="mt-4 font-semibold text-slate-900">
              {subscribers.length === 0 ? "No subscribers yet" : "No subscribers found"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {subscribers.length === 0
                ? "Customers will appear here after their KBZPay membership payment is confirmed."
                : "Try a different search term."}
            </p>
          </div>
        ) : (
          <div>
            <div className="hidden grid-cols-[minmax(260px,1.4fr)_minmax(160px,0.8fr)_110px_minmax(220px,1fr)] gap-5 border-b bg-slate-50/80 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 lg:grid">
              <span>Subscriber</span>
              <span>Membership</span>
              <span>Status</span>
              <span>Billing period</span>
            </div>
            <div className="divide-y">
              {visibleSubscribers.map((subscriber) => {
                const name = subscriber.customerName?.trim() || "Customer";
                const initials = name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part.charAt(0).toUpperCase())
                  .join("") || "C";
                return (
                  <article
                    key={subscriber.id}
                    className="grid gap-4 px-4 py-5 transition-colors hover:bg-slate-50/70 sm:px-6 lg:grid-cols-[minmax(260px,1.4fr)_minmax(160px,0.8fr)_110px_minmax(220px,1fr)] lg:items-center lg:gap-5"
                  >
                    <div className="flex min-w-0 items-start gap-3.5">
                      <SubscriberAvatar subscriber={subscriber} initials={initials} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{name}</p>
                        {subscriber.customerEmail ? (
                          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{subscriber.customerEmail}</span>
                          </p>
                        ) : null}
                        {subscriber.customerPhone ? (
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                            <span>{subscriber.customerPhone}</span>
                          </p>
                        ) : null}
                        {!subscriber.customerEmail && !subscriber.customerPhone ? (
                          <p className="mt-1 text-xs italic text-slate-400">Contact details unavailable</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-xl bg-violet-50 px-3.5 py-3 lg:bg-transparent lg:p-0">
                      <p className="text-xs text-slate-500 lg:hidden">Membership</p>
                      <p className="font-semibold text-slate-900">{subscriber.plan?.name || "Archived plan"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{formatMmk(subscriber.plan?.price)} / 30 days</p>
                    </div>

                    <div>
                      <Badge className={subscriber.status === "active" ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "border border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100"}>
                        <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${subscriber.status === "active" ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {subscriber.status}
                      </Badge>
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <CalendarClock className="h-4 w-4 text-slate-500" />
                        {formatDate(subscriber.currentPeriodStart)} – {formatDate(subscriber.currentPeriodEnd)}
                      </div>
                      <p className="mt-1 pl-6 text-xs text-slate-500">
                        {subscriber.status === "active" ? "Manual renewal before expiry" : "Membership period ended"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
