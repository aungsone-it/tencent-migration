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

Password reset stores a code in KV, then sends it via [Tencent Cloud SES](https://www.tencentcloud.com/products/ses). Without these vars, **no email is sent** (the UI will warn instead of pretending delivery succeeded).

| Variable | Value |
|----------|-------|
| `TENCENT_SECRET_ID` | API SecretId from Tencent CAM |
| `TENCENT_SECRET_KEY` | API SecretKey from Tencent CAM |
| `TENCENT_SES_FROM_EMAIL` | Verified sender **email only**, e.g. `noreply@yourdomain.com` (not the display name) |
| `TENCENT_SES_FROM_NAME` | Optional display name (default: `Migoo Marketplace`) |
| `TENCENT_SES_REGION` | Optional SES region (default: `CLOUDBASE_REGION` or `ap-singapore`) |
| `TENCENT_SES_REPLY_TO` | Optional reply-to address |

**SES console setup (one-time):**

1. Open [Tencent SES console](https://console.cloud.tencent.com/ses) in the same region as `TENCENT_SES_REGION`.
2. **Sender domain** → add your domain → publish the DNS records (SPF, DKIM, etc.) until verified.
3. **Sender address** → create `TENCENT_SES_FROM_EMAIL` under that domain.
4. **CAM** → create an API key with SES send permissions (`ses:SendEmail`).

Verify delivery after deploy:

```bash
curl -sS "$VITE_CLOUDBASE_API_BASE_URL/auth/email-health" \
  -H "Authorization: Bearer $VITE_CLOUDBASE_PUBLISHABLE_KEY"
```

Expect `"ok": true` and `"provider": "tencent-ses"`. Password reset will fail with a clear error until SES credentials and a verified sender are configured.

### 4. Enable Authentication (+ optional Cloud Storage)

- **Authentication** → enable username/password login
- **Cloud Storage** in TCB console → optional. **NEXA production does not require it.** With `CLOUDBASE_STORAGE_API_BASE_URL` **unset**, uploads are stored in **TencentDB** (`kv_store_16010b6f`, keys `storage:obj:{bucket}:{path}`) and served via signed URLs from the function.

**Required for image uploads to work (KV mode):**

| Variable | Purpose |
|----------|---------|
| `TENCENT_DATABASE_URL` or PostgREST vars | KV writes for file blobs + metadata |
| `CLOUDBASE_API_PUBLIC_BASE_URL` | Absolute signed URL base for browsers (see `function-env.template.env`) |
| `CLOUDBASE_SERVICE_TOKEN` | API auth |

**Optional — separate object storage later:**

| Variable | When to set |
|----------|-------------|
| `CLOUDBASE_STORAGE_API_BASE_URL` | e.g. `https://{envId}.api.intl.tcloudbasegateway.com/v1/storages` (Singapore) — only if moving file bytes off TencentDB |

Do **not** confuse standalone **Tencent COS console** bucket creation with this env var. TCB **Cloud Storage → File Management** confirms storage is enabled for the env; the app creates logical buckets (`make-16010b6f-*`) automatically on first upload.

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
VITE_PLATFORM_RESERVED_APEX_DOMAINS=nexa-mm.com,nexa-apex.online
VITE_DEPLOYMENT_PLATFORM=edgeone
```

`VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN` — apex used for vendor subdomains (`gogo.<apex>`).

`VITE_PLATFORM_RESERVED_APEX_DOMAINS` — every hostname that should show the **platform branding landing** at `/` (not custom-domain vendor lookup). Include both apex and any extra branding domains (e.g. `nexa-mm.com` even when subdomains use `nexa-apex.online`).

### Platform apex DNS (nexa-mm.com, nexa-apex.online, …)

EdgeOne assigns a **separate** CNAME/target per hostname. `www.nexa-mm.com` working while `nexa-mm.com` fails almost always means **apex DNS or EdgeOne domain binding is missing** — not an app bug.

For each marketplace apex:

1. EdgeOne Makers → **Domains** → add **`nexa-mm.com`** and **`www.nexa-mm.com`** (separate entries).
2. At your DNS registrar:
   - `www` → CNAME to EdgeOne’s value for `www.nexa-mm.com`
   - `@` (apex) → A or ALIAS/ANAME to EdgeOne’s apex target (cannot always be a plain CNAME at root)
3. Rebuild/redeploy after changing `VITE_PLATFORM_RESERVED_APEX_DOMAINS`.
4. Confirm both URLs load the SPA (not registrar parking): `https://nexa-mm.com` and `https://www.nexa-mm.com`.

Vendor custom domains (`shop.example.com`) follow the same apex vs www rule.

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
- [ ] Create test product + upload image (check URL contains `/storage/object?bucket=` when using KV mode, or storage CDN URL if object storage is enabled)
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

Then re-upload or fix **legacy Supabase Storage URLs** in imported KV (new uploads already use TencentDB KV). Migrate Auth users separately. Only decommission Supabase after validation.

```bash
npm run validate:read-model
```

See also: [READ_MODEL_ROLLOUT.md](./READ_MODEL_ROLLOUT.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [../migration.md](../migration.md).
