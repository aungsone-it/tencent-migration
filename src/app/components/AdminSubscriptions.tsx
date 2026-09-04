import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarClock,
  CircleDollarSign,
  Check,
  Crown,
  Layers3,
  Loader2,
  Mail,
  Phone,
  Search,
  UserCheck,
  Users,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "../contexts/LanguageContext";
import {
  cloudbaseApiBaseUrl,
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
} from "../../../utils/supabase/info";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

type PlatformPlan = {
  id: string;
  vendorId: string;
  vendorName: string;
  name: string;
  description: string;
  price: number;
  promises: string[];
  status: "active" | "inactive";
};

type PlatformSubscriber = {
  id: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  profileImageUrl?: string;
  vendorName: string;
  status: "active" | "expired";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: { name: string; price: number };
};

function headers(): Record<string, string> {
  return {
    ...getCloudBaseRequestHeaders(),
    ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
  };
}

function mmk(value: number): string {
  return `${Math.round(value || 0).toLocaleString()} MMK`;
}

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

function SearchBar({
  query,
  setQuery,
  placeholder,
  resultLabel,
}: {
  query: string;
  setQuery: (value: string) => void;
  placeholder: string;
  resultLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">{resultLabel}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
  tone: string;
}) {
  return (
    <Card className="group relative overflow-hidden border-slate-200 bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
      <span className={`absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-40 ${tone.split(" ")[0]}`} />
      <div className="flex items-center justify-between gap-4">
        <div className="relative"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p></div>
        <span className={`relative rounded-2xl p-3 shadow-sm ${tone}`}><Icon className="h-5 w-5" /></span>
      </div>
    </Card>
  );
}

export function AdminSubscriptionPlans() {
  const { t } = useLanguage();
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, inactive: 0, vendors: 0, activePlanValue: 0 });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${cloudbaseApiBaseUrl}/admin/subscription-plans`, { headers: headers() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load plans");
      setPlans(Array.isArray(data.plans) ? data.plans : []);
      setSummary(data.summary || {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("subscriptions.loadPlansFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((plan) =>
      [plan.name, plan.vendorName, plan.description, plan.status]
        .some((value) => String(value || "").toLowerCase().includes(q)),
    );
  }, [plans, query]);
  const planGridClass =
    visible.length === 1
      ? "grid max-w-2xl grid-cols-1"
      : visible.length === 2
        ? "grid max-w-5xl grid-cols-1 md:grid-cols-2"
        : "grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3";

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-lg shadow-violet-200">
          <Crown className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{t("subscriptions.plans.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("subscriptions.plans.subtitle")}</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("subscriptions.metrics.totalPlans")} value={summary.total} icon={Layers3} tone="bg-violet-50 text-violet-600" />
        <Metric label={t("subscriptions.metrics.activePlans")} value={summary.active} icon={UserCheck} tone="bg-emerald-50 text-emerald-600" />
        <Metric label={t("subscriptions.metrics.vendorsOfferingPlans")} value={summary.vendors} icon={Building2} tone="bg-blue-50 text-blue-600" />
        <Metric label={t("subscriptions.metrics.combinedPlanValue")} value={mmk(summary.activePlanValue)} icon={CircleDollarSign} tone="bg-amber-50 text-amber-600" />
      </div>
      <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
        <SearchBar
          query={query}
          setQuery={setQuery}
          placeholder={t("subscriptions.searchPlansPlaceholder")}
          resultLabel={t("subscriptions.plansCount")
            .replace("{visible}", String(visible.length))
            .replace("{total}", String(plans.length))}
        />
        {visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">{t("subscriptions.noPlans")}</div>
        ) : (
          <div className={`${planGridClass} gap-5 bg-slate-50/60 p-5 sm:p-6`}>
            {visible.map((plan) => (
              <article key={plan.id} className="group relative flex min-h-[19rem] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-1 hover:border-violet-200 hover:shadow-[0_20px_45px_rgba(76,29,149,0.12)]">
                <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-violet-600 via-fuchsia-500 to-amber-400" />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 ring-1 ring-violet-100">
                      <Sparkles className="h-5 w-5" />
                    </span>
                    <div className="min-w-0"><h2 className="truncate text-lg font-extrabold tracking-tight text-slate-900">{plan.name}</h2><p className="mt-1 flex items-center gap-1.5 truncate text-sm font-medium text-slate-500"><Building2 className="h-3.5 w-3.5" />{plan.vendorName}</p></div>
                  </div>
                  <Badge className={plan.status === "active" ? "border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700" : "border border-slate-200 bg-slate-100 px-2.5 py-1 text-slate-600"}>
                    {t(`subscriptions.status.${plan.status}`)}
                  </Badge>
                </div>
                <div className="mt-6 rounded-2xl bg-gradient-to-br from-slate-950 to-slate-800 px-5 py-4 text-white">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{t("subscriptions.monthlyMembership")}</p>
                  <p className="mt-1 text-3xl font-black tracking-tight">{Math.round(plan.price || 0).toLocaleString()} <span className="text-sm font-semibold text-violet-300">MMK</span></p>
                  <p className="mt-1 text-xs text-slate-400">{t("subscriptions.renewsManually")}</p>
                </div>
                {plan.description && <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600">{plan.description}</p>}
                <div className="mt-4 space-y-2">
                  {(plan.promises || []).slice(0, 3).map((promise, index) => (
                    <p key={`${plan.id}-promise-${index}`} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-2.5 w-2.5" /></span>
                      <span className="line-clamp-1">{promise}</span>
                    </p>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-medium text-slate-500">
                  <span>{t("subscriptions.subscriberPromises").replace("{count}", String(plan.promises?.length || 0))}</span>
                  <span className="text-violet-600">{t("subscriptions.vendorManaged")}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function AdminSubscriptionSubscribers() {
  const { t } = useLanguage();
  const [subscribers, setSubscribers] = useState<PlatformSubscriber[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, expired: 0, vendors: 0, activeValue: 0 });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${cloudbaseApiBaseUrl}/admin/subscribers`, { headers: headers() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load subscribers");
      setSubscribers(Array.isArray(data.subscribers) ? data.subscribers : []);
      setSummary(data.summary || {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("subscriptions.loadSubscribersFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return subscribers;
    const compact = q.replace(/[\s+()_-]/g, "");
    return subscribers.filter((item) =>
      [item.customerName, item.customerEmail, item.customerPhone, item.vendorName, item.plan?.name, item.status]
        .some((value) => {
          const candidate = String(value || "").toLowerCase();
          return candidate.includes(q) || candidate.replace(/[\s+()_-]/g, "").includes(compact);
        }),
    );
  }, [query, subscribers]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("subscriptions.subscribers.title")}</h1>
        <p className="text-slate-600">{t("subscriptions.subscribers.subtitle")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("subscriptions.metrics.totalSubscribers")} value={summary.total} icon={Users} tone="bg-violet-50 text-violet-600" />
        <Metric label={t("subscriptions.metrics.active")} value={summary.active} icon={UserCheck} tone="bg-emerald-50 text-emerald-600" />
        <Metric label={t("subscriptions.metrics.vendorsWithSubscribers")} value={summary.vendors} icon={Building2} tone="bg-blue-50 text-blue-600" />
        <Metric label={t("subscriptions.metrics.activeMembershipValue")} value={mmk(summary.activeValue)} icon={CircleDollarSign} tone="bg-amber-50 text-amber-600" />
      </div>
      <Card className="overflow-hidden">
        <SearchBar
          query={query}
          setQuery={setQuery}
          placeholder={t("subscriptions.searchSubscribersPlaceholder")}
          resultLabel={t("subscriptions.subscribersCount")
            .replace("{visible}", String(visible.length))
            .replace("{total}", String(subscribers.length))}
        />
        {visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">{t("subscriptions.noSubscribers")}</div>
        ) : (
          <div>
            <div className="hidden grid-cols-[minmax(240px,1.2fr)_minmax(180px,0.8fr)_minmax(170px,0.8fr)_110px_minmax(210px,1fr)] gap-5 border-b bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 lg:grid">
              <span>{t("subscriptions.table.subscriber")}</span>
              <span>{t("subscriptions.table.vendor")}</span>
              <span>{t("subscriptions.table.membership")}</span>
              <span>{t("subscriptions.table.status")}</span>
              <span>{t("subscriptions.table.billingPeriod")}</span>
            </div>
            <div className="divide-y">
              {visible.map((item) => {
                const name = item.customerName || t("subscriptions.customerFallback");
                const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
                return (
                  <article key={item.id} className="grid gap-4 px-4 py-5 hover:bg-slate-50 sm:px-6 lg:grid-cols-[minmax(240px,1.2fr)_minmax(180px,0.8fr)_minmax(170px,0.8fr)_110px_minmax(210px,1fr)] lg:items-center lg:gap-5">
                    <div className="flex min-w-0 items-start gap-3">
                      {item.profileImageUrl ? <img src={item.profileImageUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">{initials || "C"}</div>}
                      <div className="min-w-0"><p className="truncate font-semibold">{name}</p>{item.customerEmail && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Mail className="h-3.5 w-3.5" /><span className="truncate">{item.customerEmail}</span></p>}{item.customerPhone && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Phone className="h-3.5 w-3.5" />{item.customerPhone}</p>}</div>
                    </div>
                    <p className="flex items-center gap-2 font-medium"><Building2 className="h-4 w-4 text-slate-400" />{item.vendorName}</p>
                    <div><p className="font-medium">{item.plan?.name}</p><p className="text-xs text-slate-500">{mmk(item.plan?.price)}</p></div>
                    <Badge className={item.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}>
                      {t(`subscriptions.status.${item.status}`)}
                    </Badge>
                    <div className="rounded-xl bg-slate-50 p-3 text-sm"><p className="flex items-center gap-2 font-medium"><CalendarClock className="h-4 w-4 text-slate-500" />{date(item.currentPeriodStart)} – {date(item.currentPeriodEnd)}</p><p className="mt-1 pl-6 text-xs text-slate-500">{t("subscriptions.manualRenewal")}</p></div>
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
