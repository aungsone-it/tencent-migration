import nodeCrypto from "node:crypto";
import {
  kvCreateBucket,
  kvCreateSignedUrl,
  kvListBuckets,
  kvRemove,
  kvStorageAvailable,
  kvUpload,
} from "./kv_storage_backend.ts";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

type ClientOptions = {
  auth?: Record<string, unknown>;
  db?: { schema?: string };
  global?: { headers?: Record<string, string> };
};

type QueryResult<T = unknown> = {
  data: T | null;
  error: { message: string; [key: string]: unknown } | null;
};

type PgPoolLike = {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
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

function cloudbaseEnvId(): string {
  return firstEnv("CLOUDBASE_ENV_ID", "TCB_ENV_ID", "VITE_CLOUDBASE_ENV_ID");
}

function cloudbaseRegion(): string {
  return firstEnv("CLOUDBASE_REGION", "TCB_REGION", "VITE_CLOUDBASE_REGION");
}

function usesIntlGateway(): boolean {
  if (firstEnv("CLOUDBASE_INTL_GATEWAY", "TCB_INTL_GATEWAY") === "1") return true;
  const region = cloudbaseRegion().toLowerCase();
  return region.includes("singapore") || region.startsWith("ap-singapore");
}

function cloudbaseGatewayBase(): string {
  const explicit = firstEnv("CLOUDBASE_GATEWAY_URL", "TCB_GATEWAY_URL");
  if (explicit) return explicit;
  const envId = cloudbaseEnvId();
  if (!envId) return "";
  const host = usesIntlGateway()
    ? `${envId}.api.intl.tcloudbasegateway.com`
    : `${envId}.api.tcloudbasegateway.com`;
  return `https://${host}`;
}

function serviceToken(): string {
  return firstEnv(
    "CLOUDBASE_SERVICE_TOKEN",
    "TCB_SERVICE_TOKEN",
    "TENCENT_POSTGREST_SERVICE_KEY",
    "POSTGREST_SERVICE_KEY",
    "CLOUDBASE_PUBLISHABLE_KEY",
    "TCB_PUBLISHABLE_KEY",
  );
}

function postgrestBaseUrl(): string {
  return (
    firstEnv("TENCENT_POSTGREST_URL", "TENCENTDB_REST_URL", "POSTGREST_URL") ||
    (cloudbaseGatewayBase() ? `${cloudbaseGatewayBase()}/v1/rdb/rest` : "")
  );
}

function cloudbaseAuthBaseUrl(): string {
  return (
    firstEnv("CLOUDBASE_AUTH_API_BASE_URL", "TCB_AUTH_API_BASE_URL") ||
    (cloudbaseGatewayBase() ? `${cloudbaseGatewayBase()}/auth/v1` : "")
  );
}

function cloudbaseStorageBaseUrl(): string {
  return firstEnv("CLOUDBASE_STORAGE_API_BASE_URL", "TCB_STORAGE_API_BASE_URL");
}

function postgresConnectionString(): string {
  return firstEnv("TENCENT_DATABASE_URL", "TENCENTDB_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL");
}

function errorResult(message: string): QueryResult {
  return { data: null, error: { message } };
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = serviceToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function encodeFilterValue(value: unknown): string {
  if (Array.isArray(value)) return `(${value.map((v) => `"${String(v)}"`).join(",")})`;
  return String(value);
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

function parsePostgrestFilter(raw: string): { op: string; value: string } {
  const dot = raw.indexOf(".");
  if (dot === -1) return { op: "eq", value: raw };
  return { op: raw.slice(0, dot), value: raw.slice(dot + 1) };
}

function parseInValues(raw: string): string[] {
  const trimmed = raw.replace(/^\(/, "").replace(/\)$/, "");
  if (!trimmed) return [];
  return trimmed.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
}

function selectedColumns(columns: string): string {
  const normalized = columns.replace(/\s+/g, "").toLowerCase();
  if (normalized === "value") return "value";
  if (normalized === "key,value" || normalized === "key,value") return "key, value";
  return "key, value";
}

class PostgrestQuery<T = unknown> implements PromiseLike<QueryResult<T>> {
  private method = "GET";
  private body: unknown;
  private params = new URLSearchParams();
  private headers: Record<string, string> = {};
  private columns = "*";
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(
    private readonly table: string,
    private readonly clientHeaders: Record<string, string>,
  ) {}

  select(columns = "*"): this {
    this.method = this.method === "HEAD" ? "HEAD" : "GET";
    this.columns = columns;
    this.params.set("select", columns);
    return this;
  }

  upsert(value: unknown, opts?: { onConflict?: string }): this {
    this.method = "POST";
    this.body = value;
    this.headers.Prefer = "resolution=merge-duplicates,return=representation";
    if (opts?.onConflict) this.params.set("on_conflict", opts.onConflict);
    return this;
  }

  insert(value: unknown): this {
    this.method = "POST";
    this.body = value;
    this.headers.Prefer = "return=representation";
    return this;
  }

  update(value: unknown): this {
    this.method = "PATCH";
    this.body = value;
    this.headers.Prefer = "return=representation";
    return this;
  }

  delete(): this {
    this.method = "DELETE";
    this.headers.Prefer = "return=representation";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.params.append(column, `eq.${encodeFilterValue(value)}`);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.params.append(column, `in.${encodeFilterValue(values)}`);
    return this;
  }

  like(column: string, value: string): this {
    this.params.append(column, `like.${value}`);
    return this;
  }

  ilike(column: string, value: string): this {
    this.params.append(column, `ilike.${value}`);
    return this;
  }

  filter(column: string, operator: string, value: unknown): this {
    this.params.append(column, `${operator}.${encodeFilterValue(value)}`);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.params.append("order", `${column}.${opts?.ascending === false ? "desc" : "asc"}`);
    return this;
  }

  range(from: number, to: number): this {
    this.headers.Range = `${from}-${to}`;
    return this;
  }

  limit(count: number): this {
    this.params.set("limit", String(count));
    return this;
  }

  single(): this {
    this.singleMode = "single";
    this.headers.Accept = "application/vnd.pgrst.object+json";
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybeSingle";
    this.headers.Accept = "application/vnd.pgrst.object+json";
    return this;
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult<T>> {
    if (postgresConnectionString()) {
      return this.executePg();
    }
    const base = postgrestBaseUrl();
    if (!base) return errorResult("TENCENT_POSTGREST_URL is not configured") as QueryResult<T>;
    const qs = this.params.toString();
    const url = `${base}/${encodeURIComponent(this.table)}${qs ? `?${qs}` : ""}`;
    try {
      const res = await fetch(url, {
        method: this.method,
        headers: {
          ...authHeaders({
            "Content-Type": "application/json",
            ...this.clientHeaders,
            ...this.headers,
          }),
        },
        ...(this.body === undefined ? {} : { body: JSON.stringify(this.body) }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        if (this.singleMode === "maybeSingle" && res.status === 406) {
          return { data: null, error: null };
        }
        return errorResult(data?.message || data?.error || res.statusText) as QueryResult<T>;
      }
      return { data: data as T, error: null };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error)) as QueryResult<T>;
    }
  }

  private async executePg(): Promise<QueryResult<T>> {
    if (this.table !== "kv_store_16010b6f") {
      return errorResult(`Unsupported direct PostgreSQL table: ${this.table}`) as QueryResult<T>;
    }

    try {
      const pool = getPgPool();

      if (this.method === "POST") {
        const rows = Array.isArray(this.body) ? this.body : [this.body];
        for (const row of rows as any[]) {
          await pool.query(
            `INSERT INTO public.kv_store_16010b6f (key, value)
             VALUES ($1, $2::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [String(row.key), JSON.stringify(row.value ?? null)],
          );
        }
        return { data: rows as T, error: null };
      }

      if (this.method === "DELETE") {
        const keyFilter = this.params.get("key");
        if (!keyFilter) return { data: [] as T, error: null };
        const parsed = parsePostgrestFilter(keyFilter);
        if (parsed.op === "eq") {
          await pool.query("DELETE FROM public.kv_store_16010b6f WHERE key = $1", [parsed.value]);
        } else if (parsed.op === "in") {
          const values = parseInValues(parsed.value);
          await pool.query("DELETE FROM public.kv_store_16010b6f WHERE key = ANY($1::text[])", [values]);
        }
        return { data: [] as T, error: null };
      }

      const where: string[] = [];
      const values: unknown[] = [];
      for (const [column, raw] of this.params.entries()) {
        if (column === "select" || column === "order" || column === "limit") continue;
        const parsed = parsePostgrestFilter(raw);
        if (column === "key" && parsed.op === "eq") {
          values.push(parsed.value);
          where.push(`key = $${values.length}`);
        } else if (column === "key" && parsed.op === "like") {
          values.push(parsed.value);
          where.push(`key LIKE $${values.length}`);
        } else if (column === "key" && parsed.op === "in") {
          values.push(parseInValues(parsed.value));
          where.push(`key = ANY($${values.length}::text[])`);
        } else if (column === "value->>email" && (parsed.op === "ilike" || parsed.op === "like")) {
          values.push(parsed.value);
          where.push(`value->>'email' ILIKE $${values.length}`);
        }
      }

      let sql = `SELECT ${selectedColumns(this.columns)} FROM public.kv_store_16010b6f`;
      if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
      const order = this.params.get("order");
      if (order?.startsWith("key.")) {
        sql += order.endsWith(".desc") ? " ORDER BY key DESC" : " ORDER BY key ASC";
      }
      const range = this.headers.Range;
      if (range) {
        const [fromRaw, toRaw] = range.split("-");
        const from = Math.max(0, parseInt(fromRaw || "0", 10) || 0);
        const to = Math.max(from, parseInt(toRaw || String(from), 10) || from);
        values.push(to - from + 1);
        sql += ` LIMIT $${values.length}`;
        values.push(from);
        sql += ` OFFSET $${values.length}`;
      } else if (this.params.get("limit")) {
        values.push(Math.max(1, parseInt(this.params.get("limit") || "1", 10) || 1));
        sql += ` LIMIT $${values.length}`;
      }

      const result = await pool.query(sql, values);
      const data = this.singleMode ? (result.rows[0] ?? null) : result.rows;
      return { data: data as T, error: null };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error)) as QueryResult<T>;
    }
  }
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<QueryResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return errorResult(data?.message || data?.error || res.statusText) as QueryResult<T>;
    return { data: data as T, error: null };
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error)) as QueryResult<T>;
  }
}

export type CloudBaseCompatClient = ReturnType<typeof createClient>;

export function createClient(_url?: string, _key?: string, options?: ClientOptions) {
  const clientHeaders = options?.global?.headers || {};
  return {
    from(table: string) {
      return new PostgrestQuery(table, clientHeaders);
    },

    rpc(name: string, args?: Record<string, unknown>) {
      if (postgresConnectionString()) {
        return (async (): Promise<QueryResult> => {
          try {
            const pool = getPgPool();
            if (name === "rpc_storefront_catalog") {
              const result = await pool.query(
                "SELECT public.rpc_storefront_catalog($1,$2,$3,$4,$5,$6,$7,$8) AS data",
                [
                  args?.p_kind,
                  args?.p_page,
                  args?.p_page_size,
                  args?.p_category,
                  args?.p_q,
                  args?.p_sort,
                  args?.p_min_price,
                  args?.p_max_price,
                ],
              );
              return { data: result.rows[0]?.data ?? null, error: null };
            }
            if (name === "rpc_vendor_storefront_products_page") {
              const result = await pool.query(
                "SELECT public.rpc_vendor_storefront_products_page($1,$2,$3,$4,$5,$6,$7) AS data",
                [
                  args?.p_vendor_id,
                  args?.p_vendor_business_name,
                  args?.p_page,
                  args?.p_page_size,
                  args?.p_category,
                  args?.p_q,
                  args?.p_resolve_slug,
                ],
              );
              return { data: result.rows[0]?.data ?? null, error: null };
            }
            return errorResult(`Unsupported direct PostgreSQL RPC: ${name}`);
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : String(error));
          }
        })();
      }
      const base = postgrestBaseUrl();
      if (!base) return Promise.resolve(errorResult("TENCENT_POSTGREST_URL is not configured"));
      return postJson(`${base}/rpc/${encodeURIComponent(name)}`, args || {});
    },

    auth: {
      async signInWithPassword(credentials: { email: string; password: string }) {
        const base = cloudbaseAuthBaseUrl();
        if (!base) return errorResult("CLOUDBASE_AUTH_API_BASE_URL is not configured");
        const username = String(credentials.email || "").trim();
        const password = String(credentials.password || "");
        const result = await postJson<{
          access_token?: string;
          refresh_token?: string;
          sub?: string;
          expires_in?: number;
        }>(`${base}/signin`, { username, password });
        if (result.error || !result.data?.access_token) return result;
        const userId = String(result.data.sub || "");
        return {
          data: {
            user: {
              id: userId,
              email: username,
              created_at: new Date().toISOString(),
            },
            session: {
              access_token: result.data.access_token,
              refresh_token: result.data.refresh_token,
              expires_in: result.data.expires_in,
              user: { id: userId, email: username },
            },
          },
          error: null,
        };
      },
      admin: {
        async createUser(payload: Record<string, unknown>) {
          const base = cloudbaseAuthBaseUrl();
          if (!base) {
            const fallbackId =
              typeof nodeCrypto.randomUUID === "function"
                ? nodeCrypto.randomUUID()
                : `user_${Date.now()}`;
            return {
              data: {
                user: {
                  id: fallbackId,
                  email: String(payload.email || ""),
                  created_at: new Date().toISOString(),
                  user_metadata: payload.user_metadata,
                },
              },
              error: null,
            };
          }
          const result = await postJson<Record<string, unknown>>(`${base}/admin/users`, payload);
          if (result.error) return result;
          const d = result.data || {};
          const userId = String(
            (d as { sub?: string }).sub ||
              (d as { user?: { id?: string } }).user?.id ||
              (d as { uid?: string }).uid ||
              (d as { Uid?: string }).Uid ||
              ""
          );
          if (!userId) return result;
          return {
            data: {
              user: {
                id: userId,
                email: String(payload.email || (d as { email?: string }).email || ""),
                created_at: new Date().toISOString(),
                user_metadata: payload.user_metadata,
              },
            },
            error: null,
          };
        },
        async getUserById(userId: string) {
          const base = cloudbaseAuthBaseUrl();
          if (!base) return errorResult("CLOUDBASE_AUTH_API_BASE_URL is not configured");
          return postJson(`${base}/admin/users/get`, { userId });
        },
        async updateUserById(userId: string, payload: Record<string, unknown>) {
          const base = cloudbaseAuthBaseUrl();
          if (!base) return errorResult("CLOUDBASE_AUTH_API_BASE_URL is not configured");
          return postJson(`${base}/admin/users/update`, { userId, ...payload });
        },
        async deleteUser(userId: string) {
          const base = cloudbaseAuthBaseUrl();
          if (!base) return errorResult("CLOUDBASE_AUTH_API_BASE_URL is not configured");
          return postJson(`${base}/admin/users/delete`, { userId });
        },
        async listUsers(payload?: Record<string, unknown>) {
          const base = cloudbaseAuthBaseUrl();
          if (!base) return errorResult("CLOUDBASE_AUTH_API_BASE_URL is not configured");
          return postJson(`${base}/admin/users/list`, payload || {});
        },
      },
    },

    storage: {
      async listBuckets() {
        const base = cloudbaseStorageBaseUrl();
        if (!base) {
          if (!kvStorageAvailable()) {
            return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
          }
          try {
            const data = await kvListBuckets();
            return { data, error: null };
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : String(error));
          }
        }
        return postJson(`${base}/buckets/list`, {});
      },
      async createBucket(name: string, opts?: Record<string, unknown>) {
        const base = cloudbaseStorageBaseUrl();
        if (!base) {
          if (!kvStorageAvailable()) {
            return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
          }
          try {
            await kvCreateBucket(name, opts);
            return { data: { name }, error: null };
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : String(error));
          }
        }
        return postJson(`${base}/buckets/create`, { name, ...opts });
      },
      from(bucket: string) {
        return {
          async upload(path: string, fileBody: BodyInit | ArrayBuffer | Uint8Array | string, opts?: Record<string, unknown>) {
            const base = cloudbaseStorageBaseUrl();
            if (!base) {
              if (!kvStorageAvailable()) {
                return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
              }
              try {
                const data = await kvUpload(bucket, path, fileBody, opts);
                return { data, error: null };
              } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error));
              }
            }
            const res = await fetch(`${base}/objects/${encodeURIComponent(bucket)}/${path}`, {
              method: "PUT",
              headers: authHeaders({
                ...(opts?.contentType ? { "Content-Type": String(opts.contentType) } : {}),
              }),
              body: fileBody as BodyInit,
            });
            if (!res.ok) return errorResult(await res.text());
            return { data: await res.json().catch(() => ({ path })), error: null };
          },
          async createSignedUrl(path: string, expiresIn: number) {
            const base = cloudbaseStorageBaseUrl();
            if (!base) {
              if (!kvStorageAvailable()) {
                return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
              }
              try {
                const data = await kvCreateSignedUrl(bucket, path, expiresIn);
                return { data, error: null };
              } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error));
              }
            }
            return postJson(`${base}/objects/signed-url`, { bucket, path, expiresIn });
          },
          getPublicUrl(path: string) {
            const base = cloudbaseStorageBaseUrl();
            return { data: { publicUrl: base ? `${base}/public/${encodeURIComponent(bucket)}/${path}` : path } };
          },
          async remove(paths: string[]) {
            const base = cloudbaseStorageBaseUrl();
            if (!base) {
              if (!kvStorageAvailable()) {
                return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
              }
              try {
                await kvRemove(bucket, paths);
                return { data: null, error: null };
              } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error));
              }
            }
            return postJson(`${base}/objects/remove`, { bucket, paths });
          },
        };
      },
    },
  };
}
