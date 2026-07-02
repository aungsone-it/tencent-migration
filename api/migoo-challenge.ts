/**
 * Vercel serverless: serves the domain verification token at /.well-known/migoo-verify.txt
 * when the request matches a pending custom domain (HTTPS proof).
 *
 * Important: under custom domains, `Host` may still be the *.vercel.app host; the real
 * hostname is usually in `x-forwarded-host` / `x-vercel-forwarded-host`.
 */
const CLOUDBASE_API_BASE_URL = (
  process.env.CLOUDBASE_API_BASE_URL ||
  process.env.TENCENT_API_BASE_URL ||
  process.env.VITE_CLOUDBASE_API_BASE_URL ||
  "/api/make-server-16010b6f"
).replace(/\/+$/, "");
const CLOUDBASE_PUBLISHABLE_KEY =
  process.env.CLOUDBASE_PUBLISHABLE_KEY ||
  process.env.TCB_PUBLISHABLE_KEY ||
  process.env.VITE_CLOUDBASE_PUBLISHABLE_KEY ||
  "";

type InHeaders = Record<string, string | string[] | undefined>;

function firstHeader(headers: InHeaders | undefined, name: string): string {
  if (!headers) return "";
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  if (typeof v === "string") return v.trim();
  return "";
}

function resolvePublicHostname(req: { headers?: InHeaders }): string {
  const h = req.headers ?? {};
  const chain = [
    firstHeader(h, "x-forwarded-host"),
    firstHeader(h, "x-vercel-forwarded-host"),
    firstHeader(h, "host"),
  ];
  for (const raw of chain) {
    if (!raw) continue;
    const host = raw.split(",")[0].trim().split(":")[0].toLowerCase();
    if (host && !host.endsWith(".vercel.app")) {
      return host;
    }
  }
  for (const raw of chain) {
    if (!raw) continue;
    const host = raw.split(",")[0].trim().split(":")[0].toLowerCase();
    if (host) return host;
  }
  return "";
}

export default async function handler(
  req: { headers?: InHeaders },
  res: {
    status: (code: number) => {
      end: (body?: string) => void;
      send: (body: string) => void;
    };
    setHeader: (name: string, value: string) => void;
  }
): Promise<void> {
  const host = resolvePublicHostname(req);
  if (!host) {
    res.status(400).end("");
    return;
  }

  const url =
    `${CLOUDBASE_API_BASE_URL}/vendor/custom-domain/challenge-text?hostname=${
      encodeURIComponent(host)
    }`;

  try {
    const r = await fetch(url, {
      headers: {
        ...(CLOUDBASE_PUBLISHABLE_KEY ? { Authorization: `Bearer ${CLOUDBASE_PUBLISHABLE_KEY}` } : {}),
        Accept: "text/plain",
      },
    });
    if (!r.ok) {
      res.status(404).end("");
      return;
    }
    const text = await r.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(text);
  } catch {
    res.status(502).end("");
  }
}
