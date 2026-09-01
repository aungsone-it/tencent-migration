# Deployment Guide

This project deploys as:

- **Static frontend** — Vite build in `dist/` (production: **Tencent EdgeOne**)
- **CloudBase backend** — HTTP functions (`make-server-16010b6f`, `kpay-webhook`) + TencentDB

Use this document with [TCB_CONSOLE_SETUP.md](./TCB_CONSOLE_SETUP.md) for the full greenfield path.

## 1) Prerequisites

- Node.js and npm
- Access to CloudBase environment `nexa-mm-i0goiaxufc1521e43` (or your env)
- EdgeOne (or other static host) with SPA fallback
- For CLI deploy: `@cloudbase/cli` (`npx tcb`) logged into the **international** route

### Local development options

| Mode | Commands | When to use |
|------|----------|-------------|
| **Remote API** | `npm run dev` | UI-only changes; hits CloudBase from `.env` |
| **Local API** | Terminal 1: `npm run dev:api` · Terminal 2: `npm run dev:local` | Backend/API changes without uploading function zip |

Local API runs bundled `make-server-16010b6f` on port **8787** (`LOCAL_API_PORT` to override). Vite proxies `/api/make-server-16010b6f` → local server. Requires `TENCENT_DATABASE_URL` in `.env` when endpoints need DB access. Source changes under `supabase/functions/make-server-16010b6f/` trigger auto-rebundle on restart.

See [README.md § Local Development](../README.md#local-development).

## 2) What to deploy when

| You changed | Deploy | Do **not** need |
|-------------|--------|-----------------|
| React UI (`src/`) — scroll, reset page, checkout, admin | `npm run build` → EdgeOne `dist/` | Function zip |
| API / auth / SES / KBZPay (`supabase/functions/`) | Function zip or `npm run deploy:functions` | EdgeOne (unless UI also changed) |
| DB migrations only | `npm run db:schema` | Frontend |
| Env vars on function | TCB console → function env (no zip if code unchanged) | — |

## 3) Frontend deployment (EdgeOne)

```bash
npm install
npm run build
```

Upload the **`dist/`** folder. Configure SPA fallback:

```text
/* -> /index.html
```

(`public/_redirects` is copied into `dist/` for Netlify-style hosts.)

### Cache headers (required for auto-update)

Each build embeds a unique `buildId` in `dist/version.json`. Open tabs poll and hard-reload once after a new deploy.

| File | Cache policy |
|------|----------------|
| `/index.html` | `no-cache` |
| `/version.json` | `no-cache` |
| `/assets/*` | long cache OK (Vite content hashes) |

This repo ships `public/_headers` and matching rules in `edgeone.json` (`no-cache` for `/index.html` + `/version.json`, long cache for `/assets/*`). Confirm the same CDN rules in EdgeOne if the JSON headers are not applied automatically.

See [TCB_CONSOLE_SETUP.md § Phase 4](./TCB_CONSOLE_SETUP.md#phase-4--edgeone-frontend) for EdgeOne env vars (`VITE_CLOUDBASE_*`, subdomain apex, reserved domains).

**Note:** `vercel.json` host redirects are for Vercel-style hosting only. Production EdgeOne relies on SPA `LegacyStoreRedirect` / client guards for legacy path cleanup.

### SPA fallback is mandatory

All unknown routes must rewrite to `index.html` (e.g. `/admin/orders`, `/vendor/go-go/cosmetic`, `migoo.example.com/product/sku`).

If deep links return 404, SPA fallback is misconfigured.

## 4) Backend deployment (Cloud Functions)

### Prepare packages

```bash
npm run setup:tcb-first
# or
npm run deploy:functions:zip
```

Creates:

- `.cloudbase/dist/make-server-16010b6f.zip` — main API
- `.cloudbase/dist/kpay-webhook.zip` — KBZPay webhook

**Upload the `.zip` file**, not `prepare-cloudbase-functions.mjs`.

### Option A — TCB console (recommended)

1. **Cloud Function** → `make-server-16010b6f` → **Function Code** → upload zip → **Save**
2. Repeat for `kpay-webhook` if changed
3. Set environment variables from [`cloudbase/function-env.template.env`](../cloudbase/function-env.template.env)

Full walkthrough: [TCB_CONSOLE_SETUP.md](./TCB_CONSOLE_SETUP.md).

### Option B — CLI

Singapore / international environments require:

```bash
npx tcb config set isIntl true
npx tcb logout
npx tcb login
# or: npx tcb login --apiKeyId AKID... --apiKey ...
npx tcb env list   # must show your env
```

Deploy:

```bash
npm run deploy:functions
```

Or full DB + functions:

```bash
npm run deploy:cloudbase
```

**CLI troubleshooting:** If `env list` is empty but the console works, you are on the wrong account or route (`isIntl`). Use console zip upload as fallback.

Active function packages:

| Function | Source |
|----------|--------|
| `make-server-16010b6f` | `supabase/functions/make-server-16010b6f/` |
| `kpay-webhook` | `supabase/functions/kpay-webhook/` |

## 5) Environment variables

Copy [`.env.example`](../.env.example) → `.env` for local dev.

### Frontend (EdgeOne build) — required

| Variable | Purpose |
|----------|---------|
| `VITE_CLOUDBASE_ENV_ID` | CloudBase env ID |
| `VITE_CLOUDBASE_API_BASE_URL` | HTTP Gateway URL → `make-server-16010b6f` |
| `VITE_CLOUDBASE_PUBLISHABLE_KEY` | Client publishable key (Bearer on API calls) |
| `VITE_CLOUDBASE_REGION` | `ap-singapore` (current NEXA / intl env) |

Resolved in `utils/tencent/cloudbase.ts` (re-exported via `utils/supabase/info.tsx` compat shim).

### Frontend — optional

| Variable | Purpose |
|----------|---------|
| `VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN` | Apex for vendor subdomains (production: `nexa-mm.com`) |
| `VITE_VENDOR_SUBDOMAIN_SLUG_MAP` | DNS label → store slug JSON |
| `VITE_PLATFORM_RESERVED_APEX_DOMAINS` | Hostnames that show platform landing at `/` |
| `VITE_ADMIN_OPERATION_SECRET` | Must match server for destructive admin routes |
| `VITE_CLOUDBASE_THUMB_MAX` | Width for **legacy** Storage render URLs only (defaults 256) |
| `VITE_DEPLOYMENT_PLATFORM` | e.g. `tencent-cloudbase` |

Edge middleware (`middleware.ts`): EdgeOne named export = SPA rewrite; Vercel default export = optional KBZ→`/summary` redirect. Server env `VENDOR_SUBDOMAIN_BASE_DOMAIN`, `VENDOR_SUBDOMAIN_SLUG_MAP` when using Vercel-style edge hosting (optional).

### Cloud Functions — minimum

| Variable | Purpose |
|----------|---------|
| `CLOUDBASE_ENV_ID` | Env ID |
| `CLOUDBASE_SERVICE_TOKEN` | Server API key |
| `CLOUDBASE_PUBLISHABLE_KEY` | Same as client key |
| `CLOUDBASE_API_BASE_URL` | Gateway URL |
| `CLOUDBASE_API_PUBLIC_BASE_URL` | Public URL for signed image links (same host as API base in production) |
| `CLOUDBASE_REGION` | `ap-singapore` |
| `EDGE_ADMIN_OPERATION_SECRET` | Admin ops + monitoring |

Leave `CLOUDBASE_STORAGE_API_BASE_URL` **unset** for KV image storage (current production default).

Full list: [`cloudbase/function-env.template.env`](../cloudbase/function-env.template.env).

### Password reset email (Tencent SES)

Required on **`make-server-16010b6f`** for `/auth/send-email-otp`:

| Variable | Purpose |
|----------|---------|
| `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | CAM API keys (`AKID...`) — not CloudBase Auth JWT |
| `TENCENT_SES_FROM_EMAIL` | Verified sender, e.g. `noreply@nexa-mm.com` |
| `TENCENT_SES_FROM_NAME` | Display name (default: Nexa Marketplace) |
| `TENCENT_SES_REGION` | e.g. `ap-singapore` |
| `TENCENT_SES_PASSWORD_RESET_TEMPLATE_ID` | **Approved** SES template ID |
| `TENCENT_SES_TEMPLATE_OTP_VAR` | Optional; default `otp_code` → `{{otp_code}}` in template |

SES setup: sender domain verified → sender address → **Email Template** approved → set template ID on function.

Verify after deploy:

```bash
set -a && source .env && set +a
curl -sS "${VITE_CLOUDBASE_API_BASE_URL}/auth/email-health" \
  -H "Authorization: Bearer ${VITE_CLOUDBASE_PUBLISHABLE_KEY}"
```

Expect `"ok": true`, `"provider": "tencent-ses"`, and `"passwordResetTemplateId": <number>`.

Password reset UI: `/reset-password` with optional `?returnTo=/admin&account=vendor` for vendor admin.

### Phone OTP (Tencent SMS, optional)

Customer registration phone OTP uses `TENCENT_SMS_SDK_APP_ID`, `TENCENT_SMS_SIGN_NAME`, `TENCENT_SMS_REGISTER_TEMPLATE_ID`, `TENCENT_SMS_REGION=ap-singapore` on `make-server-16010b6f` (reuses CAM keys from SES). See `cloudbase/function-env.template.env`.

### KBZPay

Set `KPAY_*` on `make-server-16010b6f` and `kpay-webhook`. Update `KPAY_NOTIFY_URL` to your public `kpay-webhook` URL. Set `KPAY_PWA_FRONTEND_RETURN_URL` to the unified apex summary (current: `https://nexa-apex.online/summary`). Run `npm run kpay:urls` to verify.

## 6) Domain and vendor host notes

- **Customer shopping** runs on vendor storefront hosts — not a shared marketplace `/products` route.
- **Platform apex** serves landing, super-admin, vendor onboarding, unified KBZPay `/summary`.
- Vendor hosts: subdomain (`{label}.{apex}`), custom domain, or path-based `/vendor/:slug` in dev.
- Set subdomain env vars consistently in EdgeOne build and edge middleware.

Production apex examples: `nexa-mm.com`, `nexa-apex.online` (configure in `VITE_PLATFORM_RESERVED_APEX_DOMAINS`).

## 7) Rollout checklist

1. Deploy **backend** first when API contracts changed.
2. Deploy **frontend** with matching `VITE_*` values.
3. Verify auth: super-admin, vendor login, **Forgot Password** OTP email.
4. Verify vendor storefront: category tabs, product detail, **Back restores scroll**, cart, checkout.
5. Verify **Add to Home** on vendor storefront over HTTPS — [VENDOR_ADD_TO_HOME.md](./VENDOR_ADD_TO_HOME.md).
6. Verify KBZPay webhook and apex `/summary` return flow.
7. Verify admin destructive routes require operation secret headers.
8. Run read-model validation — [READ_MODEL_ROLLOUT.md](./READ_MODEL_ROLLOUT.md).
9. After EdgeOne deploy: confirm `/version.json` returns new `buildId` and stale tabs refresh.

## 8) Troubleshooting

| Symptom | Fix |
|---------|-----|
| 404 on refresh/deep-link | SPA rewrite to `index.html` |
| Old JS after deploy | EdgeOne: no-cache on `index.html` + `/version.json`; hard refresh |
| `tcb env list` empty | `npx tcb config set isIntl true`, re-login; or use console zip |
| SES `WithoutPermission: Use a template` | Set `TENCENT_SES_PASSWORD_RESET_TEMPLATE_ID`; redeploy function with template send code |
| SES `AuthFailure.InvalidAuthorization` | Use CAM `AKID...` keys; check `TENCENT_SES_REGION` |
| `curl: No host part in URL` | `set -a && source .env && set +a` before curl |
| Webhook failures | Verify `KPAY_SIGN_KEY`, `KPAY_NOTIFY_URL`, gateway route |
| Admin ops blocked | Set `EDGE_ADMIN_OPERATION_SECRET` + client header |
