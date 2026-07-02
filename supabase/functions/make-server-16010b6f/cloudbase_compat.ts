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

function serviceToken(): string {
  return firstEnv(
    "CLOUDBASE_SERVICE_TOKEN",
    "TCB_SERVICE_TOKEN",
    "TENCENT_POSTGREST_SERVICE_KEY",
    "POSTGREST_SERVICE_KEY",
  );
}

function postgrestBaseUrl(): string {
  return firstEnv("TENCENT_POSTGREST_URL", "TENCENTDB_REST_URL", "POSTGREST_URL");
}

function cloudbaseAuthBaseUrl(): string {
  return firstEnv("CLOUDBASE_AUTH_API_BASE_URL", "TCB_AUTH_API_BASE_URL");
}

function cloudbaseStorageBaseUrl(): string {
  return firstEnv("CLOUDBASE_STORAGE_API_BASE_URL", "TCB_STORAGE_API_BASE_URL");
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

class PostgrestQuery<T = unknown> implements PromiseLike<QueryResult<T>> {
  private method = "GET";
  private body: unknown;
  private params = new URLSearchParams();
  private headers: Record<string, string> = {};
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(
    private readonly table: string,
    private readonly clientHeaders: Record<string, string>,
  ) {}

  select(columns = "*"): this {
    this.method = this.method === "HEAD" ? "HEAD" : "GET";
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
      const base = postgrestBaseUrl();
      if (!base) return Promise.resolve(errorResult("TENCENT_POSTGREST_URL is not configured"));
      return postJson(`${base}/rpc/${encodeURIComponent(name)}`, args || {});
    },

    auth: {
      async signInWithPassword(credentials: { email: string; password: string }) {
        const base = cloudbaseAuthBaseUrl();
        if (!base) return errorResult("CLOUDBASE_AUTH_API_BASE_URL is not configured");
        return postJson(`${base}/signin/password`, credentials);
      },
      admin: {
        async createUser(payload: Record<string, unknown>) {
          const base = cloudbaseAuthBaseUrl();
          if (!base) {
            return {
              data: {
                user: {
                  id: crypto.randomUUID(),
                  email: String(payload.email || ""),
                  created_at: new Date().toISOString(),
                },
              },
              error: null,
            };
          }
          return postJson(`${base}/admin/users`, payload);
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
        if (!base) return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
        return postJson(`${base}/buckets/list`, {});
      },
      async createBucket(name: string, opts?: Record<string, unknown>) {
        const base = cloudbaseStorageBaseUrl();
        if (!base) return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
        return postJson(`${base}/buckets/create`, { name, ...opts });
      },
      from(bucket: string) {
        return {
          async upload(path: string, fileBody: BodyInit | ArrayBuffer | Uint8Array | string, opts?: Record<string, unknown>) {
            const base = cloudbaseStorageBaseUrl();
            if (!base) return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
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
            if (!base) return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
            return postJson(`${base}/objects/signed-url`, { bucket, path, expiresIn });
          },
          getPublicUrl(path: string) {
            const base = cloudbaseStorageBaseUrl();
            return { data: { publicUrl: base ? `${base}/public/${encodeURIComponent(bucket)}/${path}` : path } };
          },
          async remove(paths: string[]) {
            const base = cloudbaseStorageBaseUrl();
            if (!base) return errorResult("CLOUDBASE_STORAGE_API_BASE_URL is not configured");
            return postJson(`${base}/objects/remove`, { bucket, paths });
          },
        };
      },
    },
  };
}
