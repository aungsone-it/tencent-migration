# TCB-First Setup (Console + EdgeOne)

Greenfield setup: empty TencentDB, deploy CloudBase functions, deploy EdgeOne frontend, import Supabase data later.

## Phase 1 — Database schema (empty)

### 1. Link TencentDB to CloudBase

1. TCB console → **Relational Database**
2. Connect your TencentDB instance (`postgres-jwchnpct` or similar)
3. Confirm PostgreSQL REST API is enabled for the environment

### 2. Apply schema only

Add to `.env`:

```bash
TENCENT_DATABASE_URL="postgresql://USER:URL_ENCODED_PASSWORD@HOST:PORT/postgres"
```

Examples:
- Managed TencentDB: `sg-postgres-xxxx.sql.tencentcdb.com:23100`
- URL-encode `$`, `%`, and other special characters in passwords

Run:

```bash
npm run setup:tcb-first
```

This applies `supabase/migrations/` with `SKIP_DATA_COPY=1` (schema + helper functions only). **KV backfill INSERTs are skipped** on re-run when the DB already has imported data — safe to run again before uploading function zips.

Or schema-only only:

```bash
npm run db:schema
```

---

## Phase 2 — Deploy Cloud Functions (console, no CLI)

### 1. Prepare upload packages

```bash
npm run setup:tcb-first
```

Creates:

- `.cloudbase/dist/make-server-16010b6f.zip`
- `.cloudbase/dist/kpay-webhook.zip`

### 2. Upload in TCB console

1. **Cloud Function** → **Create via code package**
2. Upload `make-server-16010b6f.zip`
3. Function name: `make-server-16010b6f`
4. Runtime: Node.js 18+ (or latest available)
5. Repeat for `kpay-webhook.zip`

### 3. Set function environment variables

Copy from [`cloudbase/function-env.template.env`](../cloudbase/function-env.template.env).

Minimum:

| Variable | Value |
|----------|-------|
| `CLOUDBASE_ENV_ID` | `nexa-mm-i0goiaxufc1521e43` |
| `CLOUDBASE_SERVICE_TOKEN` | Server API Key from TCB console |
| `CLOUDBASE_PUBLISHABLE_KEY` | Client Publishable Key |
| `CLOUDBASE_API_BASE_URL` | HTTP Gateway URL (see below) |
| `EDGE_ADMIN_OPERATION_SECRET` | Random secret for admin ops |

`TENCENT_POSTGREST_URL` auto-defaults to `{envId}.api.tcloudbasegateway.com/v1/rdb/rest` when `CLOUDBASE_ENV_ID` is set on the function.

### Email (password reset OTP)

Password reset stores a code in KV, then sends it via [Resend](https://resend.com). Without these vars, **no email is sent** (the UI will warn instead of pretending delivery succeeded).

| Variable | Value |
|----------|-------|
| `RESEND_API_KEY` | API key from Resend dashboard |
| `RESEND_FROM_EMAIL` | Verified sender **email only**, e.g. `noreply@yourdomain.com` (not the display name) |
| `RESEND_FROM_NAME` | Optional display name (default: `Migoo Marketplace`) |

Verify delivery after deploy:

```bash
curl -sS "$VITE_CLOUDBASE_API_BASE_URL/auth/email-health" \
  -H "Authorization: Bearer $VITE_CLOUDBASE_PUBLISHABLE_KEY"
```

Expect `"ok": true`. For local/staging without Resend, set `ALLOW_DEBUG_OTP=true` on the function — the reset page will show the code on screen.

### 4. Enable Authentication + Storage

- **Authentication** → enable username/password login
- **Cloud Storage** → create/default bucket for uploads

### 5. KBZPay (KPay) secrets

Copy **`KPAY_*`** values from Supabase → **Project Settings → Edge Functions → Secrets** (same names). Paste them into **Cloud Function → Environment variables** for `make-server-16010b6f`.

**Two values must change for TCB** (do not copy the Supabase URLs verbatim):

| Variable | TCB value |
|----------|-----------|
| `KPAY_NOTIFY_URL` | Public URL of the **`kpay-webhook`** function (see Phase 3 gateway route below). KBZ POSTs here with no JWT — signature is verified in the handler. |
| `KPAY_PWA_FRONTEND_RETURN_URL` | Unified apex summary page, e.g. `https://walwal.online/summary` |

**Minimum set on `make-server-16010b6f`:**

- `KPAY_PROXY_BASE_URL`, `KPAY_APPID`, `KPAY_MERCH_CODE`, `KPAY_SIGN_KEY`
- `KPAY_NOTIFY_URL`, `KPAY_PWA_FRONTEND_RETURN_URL`
- `KPAY_ENV` (`prod` or `uat`)
- Any proxy/ISV/PWA/refund secrets you already use on Supabase (see [`cloudbase/function-env.template.env`](../cloudbase/function-env.template.env))

**On `kpay-webhook`**, set the same **database / CloudBase** vars as the main function (`CLOUDBASE_ENV_ID`, `TENCENT_POSTGREST_SERVICE_KEY`, etc.) plus **`KPAY_SIGN_KEY`** (must match make-server).

After saving env vars, verify gateway config:

```bash
npm run kpay:urls
```

You should see non-empty `proxyBase`, `qrCreate`, and `orderQuery`. A checkout test confirms end-to-end.

---

## Phase 3 — HTTP Gateway

1. TCB console → **HTTP Gateway**
2. Create route for the main API:
   - Resource: Cloud Function `make-server-16010b6f`
   - Path: `/make-server-16010b6f` (or use default function invoke URL)
3. Create a **second public route** for KBZPay webhooks:
   - Resource: Cloud Function `kpay-webhook`
   - Path: `/kpay-webhook`
   - Must allow unauthenticated POST from KBZ (no Bearer token required)
4. Copy the public URL for make-server; set `KPAY_NOTIFY_URL` to the kpay-webhook URL from step 3

Your API base URL:

```bash
VITE_CLOUDBASE_API_BASE_URL=https://nexa-mm-i0goiaxufc1521e43.api.tcloudbasegateway.com/v1/functions/make-server-16010b6f
```

Test:

```bash
npm run smoke:tcb
```

If you get `403 EXCEED_AUTHORITY`:

1. Deploy `make-server-16010b6f` from `.cloudbase/dist/make-server-16010b6f.zip`
2. TCB console → **Access Control** → **Policy Management** → enable HTTP API invoke for Cloud Functions for your publishable key role

Or manually:

```bash
curl -H "Authorization: Bearer YOUR_PUBLISHABLE_KEY" \
  "https://nexa-mm-i0goiaxufc1521e43.api.tcloudbasegateway.com/v1/functions/make-server-16010b6f/health"
```

---

## Phase 4 — EdgeOne frontend

### 1. Environment variables (EdgeOne build settings)

```bash
VITE_CLOUDBASE_ENV_ID=nexa-mm-i0goiaxufc1521e43
VITE_CLOUDBASE_REGION=ap-shanghai
VITE_CLOUDBASE_PUBLISHABLE_KEY=<Client Publishable Key>
VITE_CLOUDBASE_API_BASE_URL=<HTTP Gateway URL>
VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN=nexa-apex.online
VITE_DEPLOYMENT_PLATFORM=edgeone
```

### 2. Build and deploy

```bash
npm run build
```

Upload `dist/` to EdgeOne. Configure SPA fallback:

```text
/* -> /index.html
```

(`public/_redirects` is copied into `dist/` for Netlify-style hosts.)

---

## Phase 5 — Smoke test (empty DB)

- [ ] `npm run smoke:tcb` passes
- [ ] Platform landing loads on EdgeOne
- [ ] Create test admin/vendor account
- [ ] Create test product + upload image
- [ ] Storefront shows test product
- [ ] Place test order

Existing Supabase data will **not** appear until Phase 6.

---

## Phase 6 — Import Supabase data

When ready, add to `.env`:

```bash
SOURCE_POSTGRES_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
TENCENT_DATABASE_URL="postgresql://...@HOST:PORT/postgres"
```

Test connections:

```bash
npm run test:db
```

### Full import (recommended)

Imports schema (if not skipped), KV rows, and SQL read-model tables. **Skips** `kpay_txn:*`, `kpay_pwa_draft:*`, and `chat:*` (KPay already on TCB).

```bash
npm run import:supabase-data
```

### Partial imports

| Command | What it does |
|---------|----------------|
| `npm run import:supabase-data-only` | KV only (`SKIP_SCHEMA=1`) |
| `npm run import:supabase-sql-only` | `app_*` SQL tables only (`SKIP_SCHEMA=1 SKIP_KV=1`) |
| `npm run import:vendor-product` | Vendor + product subset |

Legacy alias: `npm run import:supabase` → `import-supabase-later.mjs` (see script for behavior).

Then migrate Storage objects and Auth users separately. Only decommission Supabase after validation.

```bash
npm run validate:read-model
```

See also: [READ_MODEL_ROLLOUT.md](./READ_MODEL_ROLLOUT.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [../migration.md](../migration.md).
