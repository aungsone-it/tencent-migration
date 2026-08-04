import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle, ChevronRight, Crown, Info, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import {
  cloudbaseApiBaseUrl,
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
  projectId,
  publicAnonKey,
} from "../../../utils/supabase/info";
import {
  createKPayQrSession,
  fetchKPaySessionStatus,
  startKPayPwa,
  type KPaySession,
} from "../utils/kpayClient";
import {
  clearSubscriptionPwaPending,
  readSubscriptionPwaPending,
  writeSubscriptionPwaPending,
} from "../utils/subscriptionPwa";
import type { AuthUser } from "../contexts/AuthContext";
import { supabase } from "../contexts/AuthContext";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Switch } from "./ui/switch";

type Plan = {
  id: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  promises: string[];
};

type ActiveSubscription = {
  planId: string;
  status: "active" | "expired";
  currentPeriodEnd: string;
};

function headers(json = false): Record<string, string> {
  return {
    ...getCloudBaseRequestHeaders(),
    ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function formatMmk(value: number): string {
  return `${Math.round(value).toLocaleString()} MMK`;
}

export function StorefrontSubscriptions({
  vendorId,
  storeName,
  user,
  onRequireAuth,
  onOpenChange,
}: {
  vendorId: string;
  storeName: string;
  user: AuthUser | null;
  onRequireAuth: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [session, setSession] = useState<KPaySession | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [kpayPaidConfirmed, setKpayPaidConfirmed] = useState(false);
  const [subscription, setSubscription] = useState<ActiveSubscription | null>(null);
  const activationStartedRef = useRef(false);
  const activatingRef = useRef(false);

  useEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);

  const loadSubscription = useCallback(async () => {
    if (!user?.id) {
      setSubscription(null);
      return;
    }
    const response = await fetch(
      `${cloudbaseApiBaseUrl}/subscriptions/customer/${encodeURIComponent(user.id)}?vendorId=${encodeURIComponent(vendorId)}`,
      { headers: headers() },
    );
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    setSubscription(data.subscription || null);
  }, [user?.id, vendorId]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${cloudbaseApiBaseUrl}/vendor/subscription-plans/${encodeURIComponent(vendorId)}`, {
      headers: headers(),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!cancelled && response.ok) setPlans(Array.isArray(data.plans) ? data.plans : []);
      })
      .catch(() => {});
    void loadSubscription();
    return () => {
      cancelled = true;
    };
  }, [vendorId, loadSubscription]);

  useEffect(() => {
    if (!user?.id || plans.length === 0) return;
    const pending = readSubscriptionPwaPending();
    if (
      !pending ||
      pending.vendorId !== vendorId ||
      pending.customerId !== user.id
    ) {
      return;
    }
    const plan = plans.find((item) => item.id === pending.planId);
    if (!plan) return;
    setOpen(true);
    setSelected(plan);
    setSession({
      merchantOrderId: pending.merchantOrderId,
      status: "pending",
    });
  }, [plans, user?.id, vendorId]);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === subscription?.planId) || null,
    [plans, subscription?.planId],
  );
  const plansGridClass =
    plans.length === 1
      ? "mx-auto max-w-md grid-cols-1"
      : plans.length === 2
        ? "mx-auto max-w-3xl grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  const plansDialogClass =
    plans.length === 1
      ? "sm:max-w-xl"
      : plans.length === 2
        ? "sm:max-w-4xl"
        : plans.length === 3
          ? "sm:max-w-5xl"
          : "max-w-7xl";

  const choosePlan = async (plan: Plan) => {
    if (!user) {
      setOpen(false);
      onRequireAuth();
      return;
    }
    setSelected(plan);
    setSession(null);
    setKpayPaidConfirmed(false);
    activationStartedRef.current = false;
    setStarting(true);
    try {
      const response = await fetch(`${cloudbaseApiBaseUrl}/subscriptions/start`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({
          planId: plan.id,
          customerId: user.id,
          customerName: user.name,
          customerEmail: user.email,
          customerPhone: user.phone,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not start subscription");
      const merchantOrderId = String(data.payment.merchantOrderId);
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      if (isMobile) {
        writeSubscriptionPwaPending({
          merchantOrderId,
          planId: plan.id,
          vendorId,
          customerId: user.id,
          storefrontOrigin: window.location.origin,
          originPath: window.location.pathname,
          createdAt: new Date().toISOString(),
        });
        const pwa = await startKPayPwa({
          projectId,
          publicAnonKey,
          amount: plan.price,
          merchantOrderId,
          title: `${storeName} ${plan.name}`,
          storefrontOrigin: window.location.origin,
          originPath: window.location.pathname,
          summaryPath: window.location.pathname,
        });
        if (!pwa.redirectUrl) throw new Error("KBZPay did not return a mobile payment URL");
        window.location.assign(pwa.redirectUrl);
        return;
      }
      const kpay = await createKPayQrSession({
        projectId,
        publicAnonKey,
        amount: plan.price,
        merchantOrderId,
        title: `${storeName} ${plan.name}`,
      });
      if (kpay.status === "failed") throw new Error(kpay.providerStatus || "KBZPay could not create a payment");
      setSession(kpay);
    } catch (error) {
      clearSubscriptionPwaPending();
      setSelected(null);
      toast.error(error instanceof Error ? error.message : "Could not start subscription");
    } finally {
      setStarting(false);
    }
  };

  const activateSubscription = useCallback(async (quiet = false) => {
    if (!session?.merchantOrderId || activatingRef.current) return false;
    activatingRef.current = true;
    setConfirming(true);
    try {
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/subscriptions/payment/${encodeURIComponent(session.merchantOrderId)}/confirm`,
        { method: "POST", headers: headers(true), body: "{}" },
      );
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.status === "pending") {
        if (!quiet) toast.info("KBZPay has not confirmed this payment yet.");
        activationStartedRef.current = false;
        return false;
      }
      if (!response.ok) throw new Error(data.error || "Could not activate subscription");
      setSubscription(data.subscription);
      clearSubscriptionPwaPending(session.merchantOrderId);
      toast.success(`You are now subscribed to ${storeName}`);
      setOpen(false);
      setSelected(null);
      setSession(null);
      setKpayPaidConfirmed(false);
      activationStartedRef.current = false;
      void loadSubscription();
      return true;
    } catch (error) {
      activationStartedRef.current = false;
      if (!quiet) toast.error(error instanceof Error ? error.message : "Could not verify payment");
      return false;
    } finally {
      activatingRef.current = false;
      setConfirming(false);
    }
  }, [session?.merchantOrderId, storeName, loadSubscription]);

  const confirmPayment = useCallback(async (quiet = false) => {
    if (!session?.merchantOrderId) return;
    const alreadyPaid = kpayPaidConfirmed || session.status === "paid";
    if (!alreadyPaid) {
      try {
        const latest = await fetchKPaySessionStatus({
          projectId,
          publicAnonKey,
          merchantOrderId: session.merchantOrderId,
        });
        setSession((current) => current ? { ...current, ...latest } : latest);
        if (latest.status === "paid") {
          setKpayPaidConfirmed(true);
        } else {
          if (!quiet) toast.info("KBZPay has not confirmed this payment yet.");
          return;
        }
      } catch {
        if (!quiet) toast.info("Could not refresh payment status. Try again in a moment.");
        return;
      }
    }
    await activateSubscription(quiet);
  }, [session?.merchantOrderId, session?.status, kpayPaidConfirmed, activateSubscription]);

  useEffect(() => {
    const orderId = session?.merchantOrderId;
    if (!orderId) {
      setKpayPaidConfirmed(false);
      activationStartedRef.current = false;
      return;
    }
    const key = `kpay_txn:${orderId}`;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const markPaid = () => {
      if (cancelled) return;
      setKpayPaidConfirmed(true);
      setSession((current) => (current ? { ...current, status: "paid" } : current));
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    const refreshFromServer = async () => {
      if (cancelled) return;
      try {
        const latest = await fetchKPaySessionStatus({
          projectId,
          publicAnonKey,
          merchantOrderId: orderId,
        });
        if (cancelled) return;
        setSession((current) => (current ? { ...current, ...latest } : latest));
        if (latest.status === "paid") markPaid();
      } catch {
        /* next poll or realtime may still deliver */
      }
    };

    void refreshFromServer();
    pollTimer = setInterval(() => {
      void refreshFromServer();
    }, 1500);

    const channel = supabase
      .channel(`subscription-kpay-txn-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kv_store_16010b6f",
          filter: `key=eq.${key}`,
        },
        (payload: { new?: { value?: { status?: string } } }) => {
          if (payload?.new?.value?.status === "paid") markPaid();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
  }, [session?.merchantOrderId]);

  useEffect(() => {
    if (!session?.merchantOrderId || !kpayPaidConfirmed || activationStartedRef.current) return;
    activationStartedRef.current = true;
    void activateSubscription(true).then((ok) => {
      if (!ok) activationStartedRef.current = false;
    });
  }, [session?.merchantOrderId, kpayPaidConfirmed, activateSubscription]);

  if (plans.length === 0) return null;

  return (
    <>
      <section className="mb-8 overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-violet-950 to-slate-900 text-white shadow-lg">
        <div className="flex flex-col gap-5 px-6 py-7 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-white/10 p-3"><Crown className="h-7 w-7 text-amber-300" /></div>
            <div>
              <div className="mb-1 flex items-center gap-2"><Badge className="bg-amber-300 text-slate-950 hover:bg-amber-300">Monthly membership</Badge></div>
              <h2 className="text-xl font-bold sm:text-2xl">Subscribe to {storeName}</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">Support this creator and receive exclusive subscriber promises.</p>
              {subscription?.status === "active" && activePlan && (
                <p className="mt-2 text-sm font-medium text-emerald-300">
                  Active: {activePlan.name} until {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          <Button
            onClick={() => setOpen(true)}
            className="group h-12 w-full shrink-0 rounded-full border border-amber-200/80 bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-400 px-2.5 pr-4 font-bold text-slate-950 shadow-[0_8px_24px_rgba(251,191,36,0.28)] transition-all hover:-translate-y-0.5 hover:from-amber-200 hover:via-yellow-200 hover:to-amber-300 hover:shadow-[0_12px_30px_rgba(251,191,36,0.38)] sm:w-auto"
          >
            <span className="mr-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-amber-300 shadow-sm">
              <Crown className="h-4 w-4" />
            </span>
            <span>{subscription?.status === "active" ? "View membership" : "Become a subscriber"}</span>
            <ChevronRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </div>
      </section>

      <Dialog open={open} onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setSelected(null);
          setSession(null);
          setKpayPaidConfirmed(false);
          activationStartedRef.current = false;
        }
      }}>
        <DialogContent
          className={
            selected
              ? "max-h-[92vh] overflow-y-auto sm:max-w-xl"
              : `flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-0 sm:w-[calc(100vw-3rem)] ${plansDialogClass}`
          }
        >
          <DialogHeader className={selected ? "" : "shrink-0 border-b bg-gradient-to-r from-slate-50 to-violet-50 px-5 py-5 pr-12 sm:px-7"}>
            <DialogTitle className={selected ? "" : "text-xl sm:text-2xl"}>Subscribe to {storeName}</DialogTitle>
            {!selected && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm font-normal text-slate-600">
                <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Secure KBZPay payment</span>
                <span>{plans.length} {plans.length === 1 ? "membership" : "memberships"} available</span>
              </div>
            )}
          </DialogHeader>
          {selected ? (
            <div className="space-y-5">
              <div className="rounded-xl border bg-slate-50 p-4">
                <p className="font-semibold">{selected.name}</p>
                <p className="text-2xl font-bold">{formatMmk(selected.price)} <span className="text-sm font-normal text-slate-500">for 30 days</span></p>
              </div>
              <div className="flex items-center justify-between rounded-xl border p-4">
                <div className="pr-4 text-left">
                  <p className="font-medium">Automatic renewal</p>
                  <p className="text-xs text-slate-500">Unavailable until KBZPay supports authorized recurring charges. This plan renews manually.</p>
                </div>
                <Switch checked={false} disabled aria-label="Automatic renewal unavailable" />
              </div>
              <div className="flex gap-2 rounded-lg bg-blue-50 p-3 text-left text-xs text-blue-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                Desktop customers pay by QR. Mobile customers are sent to the KBZPay app.
              </div>
              {starting ? (
                <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : session ? (
                <div className="text-center">
                  <div className="relative mx-auto flex h-56 w-56 items-center justify-center rounded-xl border-2 bg-white p-3">
                    {session.qrImageUrl ? (
                      <img src={session.qrImageUrl} alt="KBZPay QR" className="h-full w-full object-contain" />
                    ) : session.qrContent ? (
                      <QRCodeCanvas
                        value={session.qrContent}
                        size={200}
                        level="H"
                        marginSize={2}
                        imageSettings={{
                          src: "/kbzpay-logo.png",
                          width: 32,
                          height: 32,
                          excavate: true,
                        }}
                      />
                    ) : (
                      <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                    )}
                    {session.qrImageUrl && (
                      <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg bg-white p-1 shadow-sm">
                        <img src="/kbzpay-logo.png" alt="" className="h-full w-full object-contain" />
                      </span>
                    )}
                    {(kpayPaidConfirmed || session.status === "paid") && (
                      <div
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-md bg-white/45 text-center ring-1 ring-emerald-500/35 backdrop-blur-[1px]"
                        role="status"
                        aria-live="polite"
                      >
                        <CheckCircle
                          className="h-14 w-14 text-emerald-600/95 drop-shadow-sm"
                          strokeWidth={2}
                          aria-hidden
                        />
                        <span className="mt-2 text-lg font-semibold tracking-wide text-emerald-900 drop-shadow-sm">
                          Paid
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="mt-4 font-medium">
                    {kpayPaidConfirmed || session.status === "paid"
                      ? "Payment received — activating your membership…"
                      : `Scan with KBZPay to pay ${formatMmk(selected.price)}`}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">This membership does not auto-renew. Renew manually before it expires.</p>
                  {session.payUrl && !(kpayPaidConfirmed || session.status === "paid") && (
                    <Button className="mt-4 w-full" onClick={() => window.location.assign(session.payUrl!)}>Open KBZPay</Button>
                  )}
                  {kpayPaidConfirmed || session.status === "paid" ? (
                    confirming ? (
                      <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Activating membership…
                      </div>
                    ) : null
                  ) : (
                    <Button variant="outline" className="mt-3 w-full" disabled={confirming} onClick={() => void confirmPayment(false)}>
                      {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Check payment
                    </Button>
                  )}
                </div>
              ) : null}
              <Button variant="ghost" onClick={() => {
                setSelected(null);
                setSession(null);
                setKpayPaidConfirmed(false);
                activationStartedRef.current = false;
              }}>Choose another plan</Button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-7">
              <div className={`grid w-full gap-4 sm:gap-5 ${plansGridClass}`}>
                {plans.map((plan, index) => {
                  const isCurrent = subscription?.planId === plan.id && subscription.status === "active";
                  return (
                    <article
                      key={plan.id}
                      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
                        isCurrent ? "border-violet-500 ring-2 ring-violet-500/20" : "border-slate-200 hover:border-violet-300"
                      }`}
                    >
                      <div className={`h-1.5 w-full ${index % 3 === 0 ? "bg-violet-500" : index % 3 === 1 ? "bg-amber-500" : "bg-emerald-500"}`} />
                      <div className="flex flex-1 flex-col p-5 sm:p-6">
                        <div className="flex min-h-7 items-start justify-between gap-3">
                          <h3 className="min-w-0 break-words text-lg font-bold leading-tight text-slate-900">{plan.name}</h3>
                          {isCurrent && <Badge className="shrink-0 bg-violet-100 text-violet-700 hover:bg-violet-100">Current</Badge>}
                        </div>
                        <div className="mt-4">
                          <p className="break-words text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">{formatMmk(plan.price)}</p>
                          <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">Every 30 days · manual renewal</p>
                        </div>
                        <p className="mt-4 break-words text-sm leading-6 text-slate-600">{plan.description}</p>
                        <div className="my-5 h-px bg-slate-100" />
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">What you receive</p>
                        <ul className="flex-1 space-y-2.5">
                          {plan.promises.map((promise, promiseIndex) => (
                            <li key={`${promise}-${promiseIndex}`} className="flex min-w-0 gap-2.5 text-sm leading-5 text-slate-700">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                                <Check className="h-3 w-3 text-emerald-700" />
                              </span>
                              <span className="min-w-0 break-words">{promise}</span>
                            </li>
                          ))}
                        </ul>
                        <Button
                          className="mt-6 h-11 w-full rounded-xl bg-slate-950 font-semibold text-white hover:bg-violet-700"
                          onClick={() => void choosePlan(plan)}
                        >
                          {isCurrent ? "Renew for 30 days" : "Choose this plan"}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
