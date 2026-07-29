import { Hono } from "hono";
import * as kv from "./kv_store.tsx";
import { createClient } from "./cloudbase_compat.ts";
import {
  isPaidSubscriptionPayment,
  splitSubscriptionRevenue,
  subscriptionPaymentSplit,
} from "./subscription_finance.ts";

type PlanStatus = "active" | "inactive";
type SubscriptionPlan = {
  id: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  promises: string[];
  status: PlanStatus;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

const app = new Hono();
const supabase = createClient(undefined, undefined, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const MAX_PLANS = 10;
const PERIOD_DAYS = 30;

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveMmk(value: unknown): number {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 ? amount : 0;
}

function normalizePromises(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 160))
    .filter(Boolean)
    .slice(0, 10);
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function getPlan(planId: string): Promise<SubscriptionPlan | null> {
  const value = await kv.get(`subscription_plan:${planId}`);
  return value && typeof value === "object" ? (value as SubscriptionPlan) : null;
}

async function vendorPlans(vendorId: string): Promise<SubscriptionPlan[]> {
  const rows = await kv.getByPrefix(`subscription_plan:${vendorId}:`);
  return (Array.isArray(rows) ? rows : [])
    .filter((row): row is SubscriptionPlan => Boolean(row && typeof row === "object"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function validatePlanBody(body: Record<string, unknown>) {
  const name = text(body.name, 80);
  const description = text(body.description, 600);
  const price = positiveMmk(body.price);
  const promises = normalizePromises(body.promises);
  const status: PlanStatus = body.status === "inactive" ? "inactive" : "active";
  if (!name) return { error: "Plan name is required" } as const;
  if (!description) return { error: "Plan description is required" } as const;
  if (!price) return { error: "Enter a valid monthly price" } as const;
  if (promises.length === 0) return { error: "Add at least one subscriber promise" } as const;
  return { value: { name, description, price, promises, status } } as const;
}

app.get("/vendor/subscription-plans/:vendorId", async (c) => {
  try {
    const vendorId = text(c.req.param("vendorId"), 160);
    if (!vendorId) return c.json({ error: "vendorId is required" }, 400);
    const includeInactive = c.req.query("includeInactive") === "1";
    const plans = (await vendorPlans(vendorId)).filter((plan) => !plan.archivedAt);
    return c.json({
      plans: includeInactive ? plans : plans.filter((plan) => plan.status === "active"),
      maxPlans: MAX_PLANS,
    });
  } catch (error) {
    console.error("Failed to load subscription plans", error);
    return c.json({ error: "Failed to load subscription plans" }, 500);
  }
});

app.post("/vendor/subscription-plans/:vendorId", async (c) => {
  try {
    const vendorId = text(c.req.param("vendorId"), 160);
    const body = (await c.req.json()) as Record<string, unknown>;
    const parsed = validatePlanBody(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const plans = await vendorPlans(vendorId);
    if (plans.filter((plan) => !plan.archivedAt).length >= MAX_PLANS) {
      return c.json({ error: `A vendor can create up to ${MAX_PLANS} plans` }, 409);
    }
    const now = new Date().toISOString();
    const id = `${vendorId}:${randomId("plan")}`;
    const plan: SubscriptionPlan = {
      id,
      vendorId,
      ...parsed.value,
      createdAt: now,
      updatedAt: now,
    };
    await kv.set(`subscription_plan:${id}`, plan);
    return c.json({ success: true, plan }, 201);
  } catch (error) {
    console.error("Failed to create subscription plan", error);
    return c.json({ error: "Failed to create subscription plan" }, 500);
  }
});

app.put("/vendor/subscription-plans/:vendorId/:planId", async (c) => {
  try {
    const vendorId = text(c.req.param("vendorId"), 160);
    const planId = text(c.req.param("planId"), 240);
    const existing = await getPlan(planId);
    if (!existing || existing.vendorId !== vendorId) return c.json({ error: "Plan not found" }, 404);
    const body = (await c.req.json()) as Record<string, unknown>;
    const parsed = validatePlanBody(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const plan: SubscriptionPlan = {
      ...existing,
      ...parsed.value,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`subscription_plan:${planId}`, plan);
    return c.json({ success: true, plan });
  } catch (error) {
    console.error("Failed to update subscription plan", error);
    return c.json({ error: "Failed to update subscription plan" }, 500);
  }
});

app.delete("/vendor/subscription-plans/:vendorId/:planId", async (c) => {
  try {
    const vendorId = text(c.req.param("vendorId"), 160);
    const planId = text(c.req.param("planId"), 240);
    const existing = await getPlan(planId);
    if (!existing || existing.vendorId !== vendorId) return c.json({ error: "Plan not found" }, 404);
    await kv.set(`subscription_plan:${planId}`, {
      ...existing,
      status: "inactive",
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete subscription plan", error);
    return c.json({ error: "Failed to delete subscription plan" }, 500);
  }
});

app.post("/subscriptions/start", async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    const planId = text(body.planId, 240);
    const customerId = text(body.customerId, 160);
    const customerName = text(body.customerName, 120);
    const customerEmail = text(body.customerEmail, 200);
    const customerPhone = text(body.customerPhone, 80);
    if (!planId || !customerId) return c.json({ error: "planId and customerId are required" }, 400);
    const plan = await getPlan(planId);
    if (!plan || plan.status !== "active") return c.json({ error: "This plan is not available" }, 404);
    const planPrice = positiveMmk(plan.price);
    if (!planPrice) return c.json({ error: "This plan has an invalid price" }, 409);
    const merchantOrderId = `SUB${Date.now()}${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0")}`;
    const payment = {
      id: randomId("subpay"),
      merchantOrderId,
      planId: plan.id,
      vendorId: plan.vendorId,
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      amount: planPrice,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await kv.set(`subscription_payment:${merchantOrderId}`, payment);
    return c.json({ success: true, payment, plan });
  } catch (error) {
    console.error("Failed to start subscription", error);
    return c.json({ error: "Failed to start subscription" }, 500);
  }
});

app.post("/subscriptions/payment/:merchantOrderId/confirm", async (c) => {
  try {
    const merchantOrderId = text(c.req.param("merchantOrderId"), 120);
    const payment = await kv.get(`subscription_payment:${merchantOrderId}`);
    if (!payment || typeof payment !== "object") return c.json({ error: "Subscription payment not found" }, 404);
    const p = payment as Record<string, any>;
    if (isPaidSubscriptionPayment(p)) {
      const storedSplit = subscriptionPaymentSplit(p);
      if (
        p.vendorPayout !== storedSplit.vendorPayout ||
        p.platformRevenue !== storedSplit.platformRevenue
      ) {
        await kv.set(`subscription_payment:${merchantOrderId}`, {
          ...p,
          ...storedSplit,
        });
      }
      const existingSubscription = await kv.get(`customer_subscription:${p.vendorId}:${p.customerId}`);
      if (p.subscriptionId && existingSubscription?.id === p.subscriptionId) {
        return c.json({ success: true, subscription: existingSubscription });
      }
      // A paid transaction is terminal. Never extend a subscription twice during repair/retry.
      return c.json(
        { error: "This payment was already processed; the subscription record needs repair" },
        409,
      );
    }
    const txn = await kv.get(`kpay_txn:${merchantOrderId}`);
    if (!txn || String(txn.status || "").toLowerCase() !== "paid") {
      return c.json({ error: "Payment has not been confirmed by KBZPay", status: "pending" }, 409);
    }
    const paidAmount = positiveMmk(txn.amount);
    const expectedAmount = positiveMmk(p.amount);
    if (
      !paidAmount ||
      !expectedAmount ||
      paidAmount !== expectedAmount
    ) {
      return c.json({ error: "Paid amount does not match the plan price" }, 409);
    }
    const key = `customer_subscription:${p.vendorId}:${p.customerId}`;
    const existing = await kv.get(key);
    const now = new Date();
    const revenueSplit = splitSubscriptionRevenue(p.amount);
    const oldEnd = existing?.currentPeriodEnd ? new Date(existing.currentPeriodEnd) : null;
    const periodStart = oldEnd && oldEnd > now ? oldEnd : now;
    const subscription = {
      id: existing?.id || randomId("sub"),
      vendorId: p.vendorId,
      customerId: p.customerId,
      customerName: p.customerName,
      customerEmail: p.customerEmail,
      customerPhone: p.customerPhone,
      planId: p.planId,
      status: "active",
      currentPeriodStart: periodStart.toISOString(),
      currentPeriodEnd: addDays(periodStart, PERIOD_DAYS).toISOString(),
      lastPaymentId: p.id,
      lastMerchantOrderId: merchantOrderId,
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const paidPayment = {
      ...p,
      ...revenueSplit,
      status: "paid",
      paidAt: now.toISOString(),
      subscriptionId: subscription.id,
    };
    // The RPC serializes updates by vendor/customer and persists entitlement + accounting atomically.
    const { data: persistedSubscription, error: persistError } = await supabase.rpc(
      "rpc_confirm_subscription_payment",
      {
        p_payment_key: `subscription_payment:${merchantOrderId}`,
        p_subscription_key: key,
        p_subscription_template: subscription,
        p_paid_payment: paidPayment,
        p_period_days: PERIOD_DAYS,
      },
    );
    if (persistError) throw new Error(persistError.message);
    if (!persistedSubscription || typeof persistedSubscription !== "object") {
      throw new Error("Subscription confirmation did not return a subscription");
    }
    return c.json({ success: true, subscription: persistedSubscription });
  } catch (error) {
    console.error("Failed to confirm subscription payment", error);
    return c.json({ error: "Failed to confirm subscription payment" }, 500);
  }
});

app.get("/vendor/subscribers/:vendorId", async (c) => {
  try {
    const vendorId = text(c.req.param("vendorId"), 160);
    if (!vendorId) return c.json({ error: "vendorId is required" }, 400);
    const [rows, customerRows] = await Promise.all([
      kv.getByPrefix(`customer_subscription:${vendorId}:`),
      kv.getByPrefix("customer:"),
    ]);
    const now = Date.now();
    const subscribers = await Promise.all(
      (Array.isArray(rows) ? rows : [])
        .filter((row) => row && typeof row === "object")
        .map(async (row) => {
          const customerId = String(row.customerId || "").trim();
          const customer = (Array.isArray(customerRows) ? customerRows : []).find(
            (candidate) =>
              candidate &&
              typeof candidate === "object" &&
              !Array.isArray(candidate) &&
              (String(candidate.userId || "").trim() === customerId ||
                String(candidate.id || "").trim() === customerId),
          );
          const [plan, authProfile] = await Promise.all([
            getPlan(String(row.planId || "")),
            customerId ? kv.get(`auth:user:${customerId}`).catch(() => null) : Promise.resolve(null),
          ]);
          const profile =
            authProfile && typeof authProfile === "object" && !Array.isArray(authProfile)
              ? authProfile
              : {};
          const email = text(
            customer?.email || profile.email || row.customerEmail,
            200,
          );
          const periodEnd = new Date(String(row.currentPeriodEnd || 0)).getTime();
          return {
            ...row,
            customerName: text(
              customer?.name || profile.name || profile.fullName || row.customerName || "Customer",
              120,
            ),
            customerEmail: email.toLowerCase().endsWith("@phone.migoo.store") ? "" : email,
            customerPhone: text(
              customer?.phone || profile.phone || row.customerPhone,
              80,
            ),
            status: periodEnd > now && row.status === "active" ? "active" : "expired",
            plan: plan
              ? { id: plan.id, name: plan.name, price: plan.price }
              : { id: String(row.planId || ""), name: "Archived plan", price: 0 },
          };
        }),
    );
    subscribers.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const activeSubscribers = subscribers.filter((item) => item.status === "active");
    return c.json({
      subscribers,
      summary: {
        total: subscribers.length,
        active: activeSubscribers.length,
        expired: subscribers.length - activeSubscribers.length,
        monthlyRevenue: activeSubscribers.reduce(
          (sum, item) => sum + positiveMmk(item.plan?.price),
          0,
        ),
      },
    });
  } catch (error) {
    console.error("Failed to load vendor subscribers", error);
    return c.json({ error: "Failed to load subscribers" }, 500);
  }
});

app.get("/admin/subscription-plans", async (c) => {
  try {
    const rows = await kv.getByPrefix("subscription_plan:");
    const plans = await Promise.all(
      (Array.isArray(rows) ? rows : [])
        .filter((plan) => plan && typeof plan === "object" && !plan.archivedAt)
        .map(async (plan) => {
          const vendor = await kv.get(`vendor:${String(plan.vendorId || "")}`).catch(() => null);
          return {
            ...plan,
            vendorName: text(
              vendor?.storeName || vendor?.businessName || vendor?.name || plan.vendorId || "Vendor",
              160,
            ),
          };
        }),
    );
    plans.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const activePlans = plans.filter((plan) => plan.status === "active");
    return c.json({
      plans,
      summary: {
        total: plans.length,
        active: activePlans.length,
        inactive: plans.length - activePlans.length,
        vendors: new Set(plans.map((plan) => String(plan.vendorId || ""))).size,
        activePlanValue: activePlans.reduce((sum, plan) => sum + positiveMmk(plan.price), 0),
      },
    });
  } catch (error) {
    console.error("Failed to load platform subscription plans", error);
    return c.json({ error: "Failed to load subscription plans" }, 500);
  }
});

app.get("/admin/subscribers", async (c) => {
  try {
    const [rows, customerRows] = await Promise.all([
      kv.getByPrefix("customer_subscription:"),
      kv.getByPrefix("customer:"),
    ]);
    const now = Date.now();
    const subscribers = await Promise.all(
      (Array.isArray(rows) ? rows : [])
        .filter((row) => row && typeof row === "object")
        .map(async (row) => {
          const customerId = String(row.customerId || "").trim();
          const customer = (Array.isArray(customerRows) ? customerRows : []).find(
            (candidate) =>
              candidate &&
              typeof candidate === "object" &&
              !Array.isArray(candidate) &&
              (String(candidate.userId || "").trim() === customerId ||
                String(candidate.id || "").trim() === customerId),
          );
          const [plan, vendor, authProfile] = await Promise.all([
            getPlan(String(row.planId || "")),
            kv.get(`vendor:${String(row.vendorId || "")}`).catch(() => null),
            customerId ? kv.get(`auth:user:${customerId}`).catch(() => null) : Promise.resolve(null),
          ]);
          const profile =
            authProfile && typeof authProfile === "object" && !Array.isArray(authProfile)
              ? authProfile
              : {};
          const email = text(customer?.email || profile.email || row.customerEmail, 200);
          const imageCandidates = [
            customer?.profileImageUrl,
            customer?.avatar,
            profile.profileImageUrl,
            profile.avatar,
          ];
          const profileImageUrl =
            imageCandidates
              .map((value) => text(value, 2000))
              .find((value) => /^https?:\/\//i.test(value) || value.startsWith("data:image/")) || "";
          const periodEnd = new Date(String(row.currentPeriodEnd || 0)).getTime();
          return {
            ...row,
            customerName: text(
              customer?.name || profile.name || profile.fullName || row.customerName || "Customer",
              120,
            ),
            customerEmail: email.toLowerCase().endsWith("@phone.migoo.store") ? "" : email,
            customerPhone: text(customer?.phone || profile.phone || row.customerPhone, 80),
            profileImageUrl,
            vendorName: text(
              vendor?.storeName || vendor?.businessName || vendor?.name || row.vendorId || "Vendor",
              160,
            ),
            status: periodEnd > now && row.status === "active" ? "active" : "expired",
            plan: plan
              ? { id: plan.id, name: plan.name, price: plan.price }
              : { id: String(row.planId || ""), name: "Archived plan", price: 0 },
          };
        }),
    );
    subscribers.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const activeSubscribers = subscribers.filter((item) => item.status === "active");
    return c.json({
      subscribers,
      summary: {
        total: subscribers.length,
        active: activeSubscribers.length,
        expired: subscribers.length - activeSubscribers.length,
        vendors: new Set(subscribers.map((item) => String(item.vendorId || ""))).size,
        activeValue: activeSubscribers.reduce(
          (sum, item) => sum + positiveMmk(item.plan?.price),
          0,
        ),
      },
    });
  } catch (error) {
    console.error("Failed to load platform subscribers", error);
    return c.json({ error: "Failed to load subscribers" }, 500);
  }
});

app.get("/subscriptions/customer/:customerId", async (c) => {
  try {
    const customerId = text(c.req.param("customerId"), 160);
    const vendorId = text(c.req.query("vendorId"), 160);
    if (!customerId || !vendorId) return c.json({ error: "customerId and vendorId are required" }, 400);
    const subscription = await kv.get(`customer_subscription:${vendorId}:${customerId}`);
    if (!subscription) return c.json({ subscription: null });
    const plan = await getPlan(String(subscription.planId || ""));
    const expired = new Date(String(subscription.currentPeriodEnd || 0)).getTime() <= Date.now();
    return c.json({
      subscription: { ...subscription, status: expired ? "expired" : subscription.status },
      plan,
    });
  } catch (error) {
    console.error("Failed to load customer subscription", error);
    return c.json({ error: "Failed to load customer subscription" }, 500);
  }
});

export default app;
