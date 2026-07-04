/**
 * PostgreSQL KV fallback for object storage when CLOUDBASE_STORAGE_API_BASE_URL
 * is not configured. Files live in kv_store_16010b6f; served via signed URLs.
 */
import crypto from "node:crypto";

type PgPoolLike = {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
};

type StoredObject = {
  contentType: string;
  base64: string;
  size: number;
  createdAt: string;
};

type BucketMeta = {
  public?: boolean;
  fileSizeLimit?: number;
  createdAt: string;
};

let pgPool: PgPoolLike | null = null;

function runtimeEnv(name: string): string {
  const deno = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno;
  const fromDeno = deno?.env?.get?.(name);
  if (fromDeno) return fromDeno;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return String(proc?.env?.[name] || "").trim();
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = runtimeEnv(name);
    if (value) return value.replace(/\/+$/, "");
  }
  return "";
}

function postgresConnectionString(): string {
  return firstEnv("TENCENT_DATABASE_URL", "TENCENTDB_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL");
}

function getPgPool(): PgPoolLike {
  if (pgPool) return pgPool;
  const connectionString = postgresConnectionString();
  if (!connectionString) throw new Error("TENCENT_DATABASE_URL is not configured");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
  return pgPool;
}

const BUCKET_REGISTRY_KEY = "storage:bucket-registry";

function objectKey(bucket: string, path: string): string {
  return `storage:obj:${bucket}:${path}`;
}

function storageSigningSecret(): string {
  return (
    firstEnv("STORAGE_SIGNING_SECRET", "CLOUDBASE_SERVICE_TOKEN", "CLOUDBASE_PUBLISHABLE_KEY") ||
    "local-kv-storage-signing"
  );
}

export function publicStorageApiBaseUrl(): string {
  return firstEnv(
    "CLOUDBASE_API_PUBLIC_BASE_URL",
    "CLOUDBASE_API_BASE_URL",
    "VITE_CLOUDBASE_API_BASE_URL",
  );
}

function signStorageToken(bucket: string, path: string, exp: number): string {
  const payload = `${bucket}\n${path}\n${exp}`;
  return crypto.createHmac("sha256", storageSigningSecret()).update(payload).digest("base64url");
}

export function verifyStorageToken(
  bucket: string,
  path: string,
  exp: number,
  sig: string,
): boolean {
  if (!bucket || !path || !sig || !Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const expected = signStorageToken(bucket, path, exp);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function kvGet(key: string): Promise<unknown> {
  const pool = getPgPool();
  const result = await pool.query(
    "SELECT value FROM public.kv_store_16010b6f WHERE key = $1 LIMIT 1",
    [key],
  );
  return result.rows[0]?.value ?? null;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO public.kv_store_16010b6f (key, value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

async function kvDelete(key: string): Promise<void> {
  const pool = getPgPool();
  await pool.query("DELETE FROM public.kv_store_16010b6f WHERE key = $1", [key]);
}

async function readBucketRegistry(): Promise<Record<string, BucketMeta>> {
  const raw = await kvGet(BUCKET_REGISTRY_KEY);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, BucketMeta>;
  }
  return {};
}

async function writeBucketRegistry(registry: Record<string, BucketMeta>): Promise<void> {
  await kvSet(BUCKET_REGISTRY_KEY, registry);
}

function toBytes(body: BodyInit | ArrayBuffer | Uint8Array | string): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "string") {
    const bin = Buffer.from(body, "utf8");
    return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
  }
  throw new Error("Unsupported upload body type");
}

export async function kvListBuckets(): Promise<{ name: string }[]> {
  const registry = await readBucketRegistry();
  return Object.keys(registry).map((name) => ({ name }));
}

export async function kvCreateBucket(name: string, opts?: Record<string, unknown>): Promise<void> {
  const registry = await readBucketRegistry();
  if (registry[name]) return;
  registry[name] = {
    public: Boolean(opts?.public),
    fileSizeLimit: typeof opts?.fileSizeLimit === "number" ? opts.fileSizeLimit : undefined,
    createdAt: new Date().toISOString(),
  };
  await writeBucketRegistry(registry);
}

export async function kvUpload(
  bucket: string,
  path: string,
  fileBody: BodyInit | ArrayBuffer | Uint8Array | string,
  opts?: Record<string, unknown>,
): Promise<{ path: string }> {
  const registry = await readBucketRegistry();
  if (!registry[bucket]) {
    await kvCreateBucket(bucket, { public: false });
  }

  const bytes = toBytes(fileBody);
  const limit = registry[bucket]?.fileSizeLimit;
  if (typeof limit === "number" && bytes.length > limit) {
    throw new Error(`File exceeds bucket size limit (${bytes.length} > ${limit})`);
  }

  const contentType =
    typeof opts?.contentType === "string" && opts.contentType.trim()
      ? opts.contentType.trim()
      : "application/octet-stream";

  const stored: StoredObject = {
    contentType,
    base64: Buffer.from(bytes).toString("base64"),
    size: bytes.length,
    createdAt: new Date().toISOString(),
  };
  await kvSet(objectKey(bucket, path), stored);
  return { path };
}

export async function kvCreateSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number,
): Promise<{ signedUrl: string }> {
  const obj = await kvGet(objectKey(bucket, path));
  if (!obj) {
    throw new Error(`Object not found: ${bucket}/${path}`);
  }

  const exp = Math.floor(Date.now() / 1000) + Math.max(60, expiresIn);
  const sig = signStorageToken(bucket, path, exp);
  const base = publicStorageApiBaseUrl().replace(/\/+$/, "");
  const qs = new URLSearchParams({
    bucket,
    path,
    exp: String(exp),
    sig,
  });
  const route = `/make-server-16010b6f/storage/object?${qs.toString()}`;
  const signedUrl = base ? `${base}${route}` : route;
  return { signedUrl };
}

export async function kvRemove(bucket: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    if (!path) continue;
    await kvDelete(objectKey(bucket, path));
  }
}

export async function kvGetObject(
  bucket: string,
  path: string,
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  const raw = await kvGet(objectKey(bucket, path));
  if (!raw || typeof raw !== "object") return null;
  const stored = raw as StoredObject;
  if (typeof stored.base64 !== "string" || !stored.base64) return null;
  const buf = Buffer.from(stored.base64, "base64");
  return {
    contentType: stored.contentType || "application/octet-stream",
    bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
  };
}

export function kvStorageAvailable(): boolean {
  return Boolean(postgresConnectionString());
}
