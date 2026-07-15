import { Hono } from "hono";
import nodeCrypto from "node:crypto";
import * as kv from "./kv_store.tsx";
import { createClient } from "./cloudbase_compat.ts";
import { ensureBucket, getFormDataUpload } from "./storage_bucket_helpers.tsx";
import { absolutizeStorageObjectUrl } from "./storage_url_helpers.tsx";

const logisticsApp = new Hono();

const supabase = createClient(undefined, undefined, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const KV_PREFIX = "logistics:partner:";
const LOGISTICS_LOGO_BUCKET = "make-16010b6f-logistics-logos";

export type RegionShippingRate = {
  estimatedDays: string;
  costMin: string;
  costMax: string;
};

export type DeliveryPartnerRecord = {
  id: string;
  name: string;
  logo: string;
  regionRates: Record<string, RegionShippingRate>;
  status: "active" | "inactive";
  codSupported: boolean;
  codFee: string;
  createdAt: string;
  updatedAt: string;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 15000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Operation timed out")), timeoutMs)
    ),
  ]);
}

function newPartnerId(): string {
  if (typeof nodeCrypto.randomUUID === "function") {
    return `logistics_${nodeCrypto.randomUUID()}`;
  }
  return `logistics_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRegionRate(raw: unknown): RegionShippingRate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const estimatedDays = String(o.estimatedDays || "").trim();
  const costMin = String(o.costMin ?? o.cost ?? "").trim();
  const hasExplicitMax = o.costMax !== undefined && o.costMax !== null;
  const costMax = hasExplicitMax
    ? String(o.costMax).trim()
    : o.costMin === undefined && o.cost !== undefined
      ? String(o.cost).trim()
      : "";
  if (!estimatedDays && !costMin && !costMax) return null;
  return { estimatedDays, costMin, costMax };
}

function normalizeRegionRates(raw: unknown): Record<string, RegionShippingRate> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, RegionShippingRate> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const region = String(key || "").trim();
      if (!region) continue;
      const rate = normalizeRegionRate(value);
      if (rate) out[region] = rate;
    }
    if (Object.keys(out).length > 0) return out;
  }

  return {};
}

function migrateLegacyPartnerFields(
  o: Record<string, unknown>,
  regionRates: Record<string, RegionShippingRate>
): Record<string, RegionShippingRate> {
  if (Object.keys(regionRates).length > 0) return regionRates;

  const legacyRegions = Array.isArray(o.regions)
    ? o.regions.map((r) => String(r || "").trim()).filter(Boolean)
    : [];
  if (legacyRegions.length === 0) return regionRates;

  const legacyRate: RegionShippingRate = {
    estimatedDays: String(o.estimatedDays || "").trim(),
    costMin: String(o.cost || "").trim(),
    costMax: String(o.cost || "").trim(),
  };

  const out: Record<string, RegionShippingRate> = {};
  for (const region of legacyRegions) {
    out[region] = { ...legacyRate };
  }
  return out;
}

function normalizePartner(raw: unknown, id: string): DeliveryPartnerRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const status = String(o.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
  const regionRates = migrateLegacyPartnerFields(o, normalizeRegionRates(o.regionRates));

  return {
    id,
    name: String(o.name || "").trim(),
    logo: String(o.logo || "").trim(),
    regionRates,
    status,
    codSupported: Boolean(o.codSupported),
    codFee: String(o.codFee || "").trim(),
    createdAt: String(o.createdAt || new Date().toISOString()),
    updatedAt: String(o.updatedAt || new Date().toISOString()),
  };
}

async function listDeliveryPartners(): Promise<DeliveryPartnerRecord[]> {
  const rows = await withTimeout(kv.getByPrefix(KV_PREFIX), 20000);
  if (!Array.isArray(rows)) return [];
  const out: DeliveryPartnerRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = String((row as DeliveryPartnerRecord).id || "").trim();
    if (!id) continue;
    const normalized = normalizePartner(row, id);
    if (normalized?.name) out.push(normalized);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function parsePartnerBody(body: Record<string, unknown>): Omit<
  DeliveryPartnerRecord,
  "id" | "createdAt" | "updatedAt"
> | { error: string } {
  const name = String(body.name || "").trim();
  if (!name) return { error: "Company / service name is required" };

  const regionRates = normalizeRegionRates(body.regionRates);
  const regionKeys = Object.keys(regionRates);
  if (regionKeys.length === 0) {
    return { error: "Add at least one region with delivery time and price" };
  }

  for (const region of regionKeys) {
    const rate = regionRates[region];
    if (!rate.estimatedDays) {
      return { error: `Estimated delivery is required for ${region}` };
    }
    if (!rate.costMin) {
      return { error: `Minimum shipping cost is required for ${region}` };
    }
  }

  const status =
    String(body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";

  const logoRaw = String(body.logo || "").trim();
  if (logoRaw.startsWith("data:")) {
    return { error: "Logo must be uploaded as an image file, not embedded inline." };
  }

  return {
    name,
    logo: logoRaw,
    regionRates,
    status,
    codSupported: Boolean(body.codSupported),
    codFee: body.codSupported ? String(body.codFee || "").trim() : "",
  };
}

logisticsApp.get("/logistics/partners", async (c) => {
  try {
    const partners = await listDeliveryPartners();
    return c.json({ success: true, partners, total: partners.length });
  } catch (error) {
    console.error("❌ Error listing delivery partners:", error);
    return c.json({ error: "Failed to load delivery partners" }, 500);
  }
});

/** Multipart logo upload — compressed client-side; only the CDN URL is stored in KV. */
logisticsApp.post("/logistics/partners/upload-logo", async (c) => {
  try {
    const formData = await c.req.formData();
    const imageFile = getFormDataUpload(formData, "image");

    if (!imageFile) {
      return c.json({ error: "No image file provided" }, 400);
    }

    const fileSizeKB = imageFile.size / 1024;
    console.log(`📦 Logistics logo size: ${fileSizeKB.toFixed(2)} KB`);

    if (fileSizeKB > 600) {
      return c.json(
        {
          error: "Image file too large. Maximum size is 500KB after compression.",
          size: `${fileSizeKB.toFixed(2)} KB`,
        },
        400
      );
    }

    try {
      await ensureBucket(supabase, LOGISTICS_LOGO_BUCKET, {
        public: false,
        fileSizeLimit: 629145,
      });
    } catch (bucketErr: unknown) {
      console.error("❌ Failed to ensure logistics logo bucket:", bucketErr);
      return c.json({ error: "Failed to prepare storage bucket" }, 500);
    }

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 9);
    const rawName = typeof imageFile.name === "string" ? imageFile.name : "";
    const fileExt = rawName.split(".").pop() || "jpg";
    const fileName = `logistics_${timestamp}_${randomStr}.${fileExt}`;

    const arrayBuffer = await imageFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const contentType =
      typeof imageFile.type === "string" && imageFile.type.startsWith("image/")
        ? imageFile.type
        : "image/jpeg";

    const { error: uploadError } = await supabase.storage
      .from(LOGISTICS_LOGO_BUCKET)
      .upload(fileName, uint8Array, { contentType, upsert: false });

    if (uploadError) {
      console.error("❌ Logistics logo upload error:", uploadError);
      return c.json({ error: uploadError.message || "Failed to upload logo" }, 500);
    }

    const { data: urlData, error: urlError } = await supabase.storage
      .from(LOGISTICS_LOGO_BUCKET)
      .createSignedUrl(fileName, 315360000);

    if (urlError || !urlData?.signedUrl) {
      return c.json({ error: urlError?.message || "Failed to generate logo URL" }, 500);
    }

    return c.json({
      success: true,
      imageUrl: absolutizeStorageObjectUrl(urlData.signedUrl),
      fileName,
      size: `${fileSizeKB.toFixed(2)} KB`,
    });
  } catch (error) {
    console.error("❌ Error uploading logistics logo:", error);
    return c.json({ error: "Failed to upload logo" }, 500);
  }
});

logisticsApp.post("/logistics/partners", async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    const parsed = parsePartnerBody(body);
    if ("error" in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    const id = newPartnerId();
    const now = new Date().toISOString();
    const record: DeliveryPartnerRecord = {
      id,
      ...parsed,
      createdAt: now,
      updatedAt: now,
    };

    await withTimeout(kv.set(`${KV_PREFIX}${id}`, record), 8000);
    console.log(`✅ Delivery partner created: ${record.name} (${id})`);

    return c.json({ success: true, partner: record }, 201);
  } catch (error) {
    console.error("❌ Error creating delivery partner:", error);
    return c.json({ error: "Failed to create delivery partner" }, 500);
  }
});

logisticsApp.put("/logistics/partners/:id", async (c) => {
  try {
    const id = c.req.param("id").trim();
    if (!id) return c.json({ error: "Partner id is required" }, 400);

    const existing = await withTimeout(kv.get(`${KV_PREFIX}${id}`), 8000);
    if (!existing) return c.json({ error: "Delivery partner not found" }, 404);

    const body = (await c.req.json()) as Record<string, unknown>;
    const parsed = parsePartnerBody(body);
    if ("error" in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    const prev = normalizePartner(existing, id);
    const record: DeliveryPartnerRecord = {
      id,
      ...parsed,
      createdAt: prev?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await withTimeout(kv.set(`${KV_PREFIX}${id}`, record), 8000);
    console.log(`✅ Delivery partner updated: ${record.name} (${id})`);

    return c.json({ success: true, partner: record });
  } catch (error) {
    console.error("❌ Error updating delivery partner:", error);
    return c.json({ error: "Failed to update delivery partner" }, 500);
  }
});

logisticsApp.delete("/logistics/partners/:id", async (c) => {
  try {
    const id = c.req.param("id").trim();
    if (!id) return c.json({ error: "Partner id is required" }, 400);

    const existing = await withTimeout(kv.get(`${KV_PREFIX}${id}`), 8000);
    if (!existing) return c.json({ error: "Delivery partner not found" }, 404);

    await withTimeout(kv.del(`${KV_PREFIX}${id}`), 8000);
    console.log(`🗑️ Delivery partner deleted: ${id}`);

    return c.json({ success: true });
  } catch (error) {
    console.error("❌ Error deleting delivery partner:", error);
    return c.json({ error: "Failed to delete delivery partner" }, 500);
  }
});

export default logisticsApp;
