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
TENCENT_DATABASE_URL="postgresql://postgres:PASSWORD@HOST:5432/postgres"
```

Run:

```bash
npm run setup:tcb-first
```

Or schema-only only:

```bash
TENCENT_DATABASE_URL="..." SKIP_DATA_COPY=1 npm run db:push
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

### 4. Enable Authentication + Storage

- **Authentication** → enable username/password login
- **Cloud Storage** → create/default bucket for uploads

---

## Phase 3 — HTTP Gateway

1. TCB console → **HTTP Gateway**
2. Create route:
   - Resource: Cloud Function `make-server-16010b6f`
   - Path: `/make-server-16010b6f` (or use default function invoke URL)
3. Copy the public URL

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

## Phase 6 — Import Supabase later

When ready:

```bash
# Add to .env:
# SOURCE_POSTGRES_URL="postgresql://postgres:...@db....supabase.co:5432/postgres"

npm run import:supabase
```

Then migrate Storage objects and Auth users separately. Only delete Supabase after validation.

See also: [READ_MODEL_ROLLOUT.md](./READ_MODEL_ROLLOUT.md), [DEPLOYMENT.md](./DEPLOYMENT.md).
