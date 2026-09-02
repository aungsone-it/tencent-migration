# NEXA Platform

**NEXA Platform** is a **multi-tenant, vendor-first** e-commerce system: each vendor runs an independent branded storefront, while a single platform apex hosts onboarding, super-admin, and shared payment return flows.

There is **no multi-vendor marketplace catalog** (no shared `/products` shopping surface). Customer shopping happens on **vendor storefronts only**.

## What the platform includes

- **Platform landing page** on the marketplace apex (`nexa-mm.com/`, `nexa-apex.online/`) — branding, vendor discovery, links to apply/login (not a product catalog)
- **Vendor storefronts** — path-based (`/vendor/:slug/*`), vendor subdomains (`{label}.{VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN}`), and custom domains
- **Super-admin portal** — `/admin/*`
- **Vendor-admin portal** — `/vendor/:slug/admin/*` (and legacy `/store/:slug/admin/*` redirects where configured)
- **CloudBase/Tencent Edge backend** — auth, orders, products, payments, notifications

## Recent Updates (September 2026)

| Area | What shipped |
|------|----------------|
| **Admin roles** | **`customer-services`** role: Home, Orders, Chat (full write); Products/Categories/Inventory, Logistics (read-only); **Promo Setting** (full write). **`data-entry`** includes **Promo Setting**. Canonical roles in `superAdminRolePermissions.ts` + backend `CANONICAL_STAFF_ROLES` |
| **Staff users** | New staff get **alphanumeric temp password** (12 chars) with copy dialog in Settings → Users; `GET /auth/users` runs **`reconcileAuthUsersList`** to merge orphan `user:email` profiles |
| **Orders realtime** | **`OrderRealtimeBridge`** polls `GET /realtime/pulses` every **2s** (visible tab only); order bumps debounced **~350ms** → silent background refetch (no list blink) |
| **Order export** | Super-admin **Export** downloads **`.xls`** (Excel HTML), not CSV — columns include **Region**, **Seller ID**, **logistic**, delivery date; multi-item orders use **merged cells** for order-level fields; phone as Excel text formula |
| **Orders toolbar** | Bulk **Delete** hidden (`SHOW_ORDERS_DELETE_BUTTON=false`; handler retained) |
| **Promo / cart** | **Promo Setting** reactivated in admin nav (`/admin/marketing`); cart drawer coupon with Burmese labels (**တွန်းလှည်း**, **ကျသင့်ငွေ**); shared **`couponEligibility.ts`** for checkout + cart |
| **UI polish** | SideNav footer: **Created by Aung Pyae Sone** / Software Architect; **Back-to-top** FAB — white/black hover theme |
| **Backend** | Order create **awaits** `syncOrderReadModel` + `bumpOrderPulse`; coupon validate returns generic errors only (no “available codes” leak) |
| **Chat emoji picker** | Native Unicode emoji in **FloatingChat** (storefront) and **admin Chat** — see [docs/CHAT.md](docs/CHAT.md) |
| **Guest phone modal** | After a guest’s **first successful chat message**, FloatingChat prompts for Myanmar phone (`+959…` / `09…`) |
| **Order numbers (NOS serial)** | Sequential **`NOS-00001`**, **`NOS-00002`**, … via KV counter + `GET /orders/next-number` |
| **Seller ID at checkout** | Required field on vendor checkout; shown on admin order detail, vendor orders, print invoice, and order export |
| **Free shipping checkout UI** | When cart qualifies, delivery dropdown shows **အခမဲ့ / FREE** (not quoted MMK fee) |
| **Local API dev** | `npm run dev:api` (function on `:8787`) + `npm run dev:local` (Vite proxies to local API) — see [Local Development](#local-development) |

## Recent Updates (July 2026)

| Area | What shipped |
|------|----------------|
| **Password reset email** | [Tencent Cloud SES](https://www.tencentcloud.com/products/ses) replaces Resend — OTP via **approved SES template** (`SendEmail` + `TemplateID`); no demo/debug OTP in API or UI |
| **Vendor admin reset** | `/reset-password?returnTo=/admin&account=vendor` — vendor KV accounts can self-reset from storefront login **Forgot Password?** |
| **Auto cache refresh on deploy** | Each build writes `dist/version.json`; open tabs poll and hard-reload once after EdgeOne deploy (keeps auth + KBZPay state) |
| **Storefront scroll restore** | Vendor product grid restores scroll position when returning from product detail (browser Back or header back) |
| **TCB function deploy** | Console zip (`.cloudbase/dist/*.zip`) or CLI (`npm run deploy:functions`); CLI requires `tcb config set isIntl true` for Singapore envs |
| **TencentDB migration** | Supabase → TencentDB for PostgreSQL: KV + SQL read-model tables imported; **KPay txn/draft** and **chat** KV skipped (KPay already on TCB). Scripts: `test:db`, `import:supabase-data`, `db:schema`, `setup:tcb-first` |
| **Super-admin Orders** | KBZPay **draft recovery** panel; optimistic list updates; badge count normalization |
| **Logistics admin** | Delivery partners CRUD, per-region rates, logo upload (~500KB compress), warehouse role access |
| **Free shipping** | Per-vendor product flags; super admin grants access; category + product bulk toggles; checkout 0 MMK when cart qualifies — see [docs/FREE_SHIPPING.md](docs/FREE_SHIPPING.md) |
| **Vendor commission & withdrawal** | **0% default** commission; admin-defined vendor/product rates; KBZPay Enterprise Payment payout from vendor Finances; session token auth — see [docs/VENDOR_COMMISSION_AND_WITHDRAWAL.md](docs/VENDOR_COMMISSION_AND_WITHDRAWAL.md) |
| **Image storage** | **Production default:** files in TencentDB KV (`storage:obj:*` keys); optional CloudBase object storage via `CLOUDBASE_STORAGE_API_BASE_URL` |

### Earlier (June 2026)

| Area | What shipped |
|------|----------------|
| **Platform branding** | Rebrand to **NEXA Platform** — configurable name/logo in admin General settings |
| **SQL read model** | KV writes sync to `app_*` tables; admin list endpoints prefer SQL RPCs with KV fallback |
| **Realtime efficiency** | Pulse tables (`app_order_pulse`, `app_kv_domain_pulse`, `app_vendor_application_pulse`) |
| **Frontend performance** | Smaller route bundles, debounced admin search, `vendor-storefront-head.js` |
| **Payments** | Cash on Delivery, KBZPay QR + PWA, webhook sync, refund/cancel flow |
| **KBZPay returns** | Unified post-payment summary on apex `/summary` |
| **Add to Home** | Vendor storefront FAB — see [docs/VENDOR_ADD_TO_HOME.md](docs/VENDOR_ADD_TO_HOME.md) |

## Migration status (Tencent Cloud)

| Component | Status |
|-----------|--------|
| TencentDB schema | Applied via `npm run db:schema` / `setup:tcb-first` |
| KV + read-model data | Imported via `import:supabase-data` (excludes `kpay_txn:*`, `kpay_pwa_draft:*`, `chat:*`) |
| Cloud Functions | Package with `setup:tcb-first` → upload `.cloudbase/dist/*.zip` to TCB console |
| Frontend API | `VITE_CLOUDBASE_API_BASE_URL` + publishable key in `.env` / EdgeOne build |
| KPay on TCB | Already live — do not re-import Supabase KPay KV |
| Chat KV | Historical `chat:*` rows not imported — chat API runs on TCB KV (empty until backfill) |
| Image uploads (new) | Stored in **TencentDB KV** + signed URLs; compress ~500KB on upload. Legacy Supabase Storage URLs in imported data may need re-upload |
| CloudBase object storage | **Optional** — set `CLOUDBASE_STORAGE_API_BASE_URL` only if migrating off KV blobs later |
| Auth users | Separate migration / password reset via SES OTP (staff, vendor KV, customer KV, CloudBase Auth) |

See [docs/TCB_CONSOLE_SETUP.md](docs/TCB_CONSOLE_SETUP.md) and [migration.md](migration.md).

## Recent Updates (June 2026) — archive

<details>
<summary>June 2026 changelog (collapsed)</summary>

| Area | What shipped |
|------|----------------|
| Cart & catalog | Cart sync hardening, product listing fixes, caching/reload race fixes |
| i18n / URLs | Burmese text in URL segments; storefront English/Burmese |
| Legal pages | Per-vendor Terms and Privacy from vendor settings |
| Settings & audit | Activities tab; Appearance hidden (branding under General) |
| Vendor onboarding | Myanmar phone, store description ≥10 chars, email availability check |

</details>

## Current Product Surface

### Customer (vendor storefront)

Implemented in `VendorStorefrontPage` → `VendorStoreView` (not a shared marketplace `Storefront` route).

- Browse products, categories, product detail, saved items, cart, checkout
- **Scroll position preserved** when opening a product and going back (same category tab)
- Customer profile, addresses, order history, order detail
- Host modes:
  - **Vendor subdomain / custom domain** — clean URLs at host root (`/`, `/product/:sku`, `/checkout`, `/:categorySlug`, `/saved`, `/profile/*`)
  - **Path-based (local dev / apex)** — `/vendor/:storeSlug/*`
- Terms and privacy: `/terms`, `/privacy` on vendor hosts; `/vendor/:slug/terms` on path-based URLs
- Bilingual storefront UI: English / Burmese. Admin language switching remains English / Simplified Chinese.
- **Free shipping** (when vendor enabled by platform): cart items marked free shipping show **0 MMK** delivery when the cart contains only those items; mixed carts use normal logistics quotes; checkout dropdown labels show **FREE** without ETA when all items qualify
- **Seller ID** — required at checkout (vendor-specific field for fulfillment tracking)
- **FloatingChat** — customer support bubble with image upload, emoji picker, and guest phone collection after first message — see [docs/CHAT.md](docs/CHAT.md)
- Store phone contact: desktop hover menu asks whether to **Dial** or open **Viber**; mobile menu shows both actions.
- **Add to Home** — floating button above chat; Android Chrome can show native install prompt; iOS uses Safari Share → Add to Home Screen (see [docs/VENDOR_ADD_TO_HOME.md](docs/VENDOR_ADD_TO_HOME.md))

### Platform apex (non-shopping)

- `/` on platform apex hosts (`nexa-mm.com`, `nexa-apex.online`, etc.) — **LandingPage** (platform marketing, stats, vendor partner carousel)
- **FloatingChat** on the apex landing page and vendor storefronts (hidden on admin, vendor application, and login routes)
- `/summary` — unified KBZPay order summary after mobile app payment
- `/vendor/application`, `/vendor/login`, `/vendor/setup` — vendor onboarding and auth
- `/admin/*` — super-admin portal

### Payments

- **Cash on Delivery**, **KBZPay QR**, and **KBZPay PWA** at vendor checkout — these are the active customer payment paths
- Return landing: `/kpay/return`, `/summary`, `/checkout/success`, `/order-confirmation` (vendor-host or path-based)
- Post-PWA summary consolidates on the **platform apex `/summary`** (current: `https://nexa-apex.online/summary` via `KPAY_PWA_FRONTEND_RETURN_URL`; Continue Shopping returns to the vendor where checkout started)
- KBZPay webhook + Realtime on `kpay_txn:{orderId}` (+ HTTP polling fallback during checkout)
- Refund/cancel logic in code; production refund success depends on gateway mTLS/client certificate setup
- **Stripe/Card/Bank transfer:** helper or legacy code may exist, but these are **not wired as live vendor checkout payment paths** — do not treat as production options

### Super Admin

- Dashboard, products, categories, inventory, orders, customers, chat, **Promo Setting**, finances, settings
- **Staff roles:** store-owner, administrator, data-entry, warehouse, **customer-services** — sidebar and write access via `superAdminRolePermissions.ts` (customer-services: orders/chat/promo write; catalog/logistics read-only)
- **Orders:** paginated SQL read model; serial **`NOS-00001`** format; **Seller ID** on detail/invoice/export; KBZPay **orphaned draft recovery**; realtime list refresh via **2s pulse poll** + debounced silent refetch; **Export** → `.xls` with merged multi-SKU rows; bulk Delete hidden in toolbar
- **Settings → Users** (store owner): staff creation with **temp password copy dialog**; user list reconciled on `GET /auth/users`
- **Chat:** customer inbox at `/admin/chat` — emoji + image in composer; guest phone and display codes in conversation list — see [docs/CHAT.md](docs/CHAT.md)
- Vendor management (**Review applications** only), promotions, collaborator flows
- **Vendor free shipping:** grant per-vendor feature access; view free-shipping product counts on vendor profile
- **Settings → General** — platform name, logo, support contact (formerly split with Appearance; Appearance tab is hidden)
- **Settings → Users** — staff accounts (owner-only)
- **Settings → Activities** — global audit timeline for all admin actions (visible to everyone who can open Settings)
- SQL-backed admin lists where read-model migrations are applied; order list refresh via **2s pulse poll** + debounced silent refetch

### Vendor

- Onboarding: `/vendor/application` (Myanmar phone formats, ≥10 character store description, email availability check), `/vendor/setup`, `/vendor/login`
- Public storefront: subdomain/custom domain host root, or `/vendor/:storeName/*`
- Admin portal: `/vendor/:storeName/admin/*`
- Settings: branding, subdomain URL preview, custom domain, terms/privacy content, social links, stock policy
- Analytics, products, categories, orders, customers, finances
- **Free shipping** (when enabled by platform): toggle per product or bulk by category; applies only to this vendor’s store — [docs/FREE_SHIPPING.md](docs/FREE_SHIPPING.md)

## Key Routes (quick reference)

### Vendor subdomain or custom domain (production)

| Purpose | URL on vendor host |
|---------|-------------------|
| Store home | `/` |
| Category | `/:categorySlug` (e.g. `/cosmetic`) |
| Product detail | `/product/:sku` |
| Checkout | `/checkout` |
| KBZPay return | `/kpay/return` |
| Order summary (in-flow) | `/summary` on vendor host; unified PWA return → apex `/summary` |
| Saved / wishlist | `/saved` |
| Account | `/profile/*` |
| Terms / privacy | `/terms`, `/privacy` |
| Vendor admin | `/admin` on vendor host (where configured) or path-based `/vendor/:slug/admin` |

### Path-based (localhost / apex dev)

| Purpose | URL |
|---------|-----|
| Store home | `/vendor/:slug` |
| Category | `/vendor/:slug/:categorySlug` |
| Product detail | `/vendor/:slug/product/:sku` |
| Checkout | `/vendor/:slug/checkout` |
| Vendor admin | `/vendor/:slug/admin` |

### Platform apex

| Purpose | URL |
|---------|-----|
| Platform landing | `/` — vendor carousel (logos, sorted by revenue), stats, Become a Vendor |
| Unified KBZPay summary | `/summary` |
| Super admin | `/admin`, `/admin/:section` |
| Vendor apply / login | `/vendor/application`, `/vendor/login` |
| Password reset (OTP) | `/reset-password` — optional `?returnTo=/admin&account=vendor` |

### Removed / legacy (redirect or 404)

| Old URL | Current behavior |
|---------|------------------|
| `/products`, `/products/*` | Redirect via `LegacyStoreRedirect` (typically to `/`) |
| `/store/:slug/*` (legacy) | Redirect to `/vendor/:slug/*` where mapped |
| Apex `/checkout`, `/product/*`, `/saved`, `/profile` without vendor host | Not supported — use a vendor storefront URL |

## Vendor Subdomains & Domains

Configure in `.env` (see `.env.example`):

```bash
# Vendor subdomain suffix (no protocol) — current production
VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN=nexa-mm.com

# Hostnames that show platform landing at / (comma-separated)
VITE_PLATFORM_RESERVED_APEX_DOMAINS=nexa-mm.com,nexa-apex.online

# Optional: DNS label → store slug
VITE_VENDOR_SUBDOMAIN_SLUG_MAP={"gogo":"go-go"}
```

Each vendor gets `https://{label}.{baseDomain}` when subdomains are enabled (e.g. `https://gogo.nexa-mm.com`). Custom domains override the default subdomain URL in vendor settings.

EdgeOne middleware (`middleware.ts` named export) serves domain-verify + SPA rewrite to `index.html`. KBZPay → unified apex `/summary` is handled **client-side** on EdgeOne (`kpayUnifiedSummaryRedirect.ts`, `index.html`, `KPayVendorReturnRedirect`). The Vercel `default` export in the same file can redirect KBZ return query params when hosted on Vercel.

## Architecture

- **Frontend:** React 18 + TypeScript + Vite + Tailwind + Radix
- **Customer storefront UI:** `VendorStorefrontPage`, `VendorStoreView`, `Checkout`
- **Platform landing:** `LandingPage` (apex only)
- **Backend:** CloudBase/Tencent HTTP Functions (`make-server-16010b6f`, `kpay-webhook`) + CloudBase Auth; **image uploads default to TencentDB KV** (optional CloudBase Storage via `CLOUDBASE_STORAGE_API_BASE_URL`)
- **Database:** TencentDB for PostgreSQL — KV table `kv_store_16010b6f` + SQL read-model tables (`app_*`)
- **API config:** `VITE_CLOUDBASE_API_BASE_URL` and `VITE_CLOUDBASE_PUBLISHABLE_KEY` in `.env` / EdgeOne (see `utils/tencent/cloudbase.ts`)
- **Region:** Singapore / intl (`ap-singapore`) — CLI deploy needs `npx tcb config set isIntl true`
- **Routing:** React Router — public vendor tree, super-admin, vendor-admin, vendor-host-specific routes
- **Legacy note:** the old shared marketplace storefront components have been removed; customer shopping is only through `VendorStorefrontPage` / `VendorStoreView`

Full backend reference: [docs/ARCHITECTURE_AND_BACKEND.md](docs/ARCHITECTURE_AND_BACKEND.md)

## Local Development

### Standard (remote CloudBase API)

```bash
npm install
cp .env.example .env   # fill VITE_CLOUDBASE_PUBLISHABLE_KEY
npm run dev
```

Open a vendor storefront at `http://localhost:5173/vendor/{store-slug}` or configure a local subdomain host.

### Local API (backend changes without cloud deploy)

Use when testing API, checkout, orders, chat, or auth changes against a locally bundled `make-server-16010b6f`:

```bash
# Terminal 1 — bundles & runs make-server on :8787 (auto-rebuilds when source changes)
npm run dev:api

# Terminal 2 — Vite proxies /api/make-server-16010b6f → localhost:8787
npm run dev:local
```

Requires `.env` with DB URLs if the function needs TencentDB (`TENCENT_DATABASE_URL`). Override port: `LOCAL_API_PORT=8787`.

Build check:

```bash
npm run build
```

Tests:

```bash
npm test
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server (remote CloudBase API from `.env`) |
| `npm run dev:api` | Run local `make-server-16010b6f` HTTP shim on `:8787` |
| `npm run dev:local` | Vite dev server with proxy to local API (`dev:api` must be running) |
| `npm run build` | Production build |
| `npm test` | Run Vitest |
| `npm run test:db` | Test `TENCENT_DATABASE_URL` and `SOURCE_POSTGRES_URL` from `.env` |
| `npm run setup:tcb-first` | Schema-only DB push (if configured) + package CloudBase zips for console upload |
| `npm run smoke:tcb` | Smoke-test `/health` and frontend env vars |
| `npm run db:schema` | Apply `supabase/migrations/` to TencentDB only (`SKIP_DATA_COPY=1`) |
| `npm run db:push` | Migrations + optional Supabase table copy (legacy `migrate-to-tencentdb` data path) |
| `npm run import:supabase-data` | Full import: schema + KV (excl. kpay/chat) + SQL read-model tables |
| `npm run import:supabase-data-only` | KV import only (skip schema) |
| `npm run import:supabase-sql-only` | SQL read-model tables only (skip schema + KV) |
| `npm run import:vendor-product` | Import vendor + product data subset |
| `npm run deploy:functions` | Build + deploy CloudBase functions via CLI (`tcb`) |
| `npm run deploy:functions:zip` | Build `.cloudbase/dist/*.zip` only (console upload) |
| `npm run deploy:cloudbase` | DB push + functions deploy |
| `npm run validate:read-model` | Validate KV ↔ SQL read-model counts (requires `EDGE_ADMIN_OPERATION_SECRET`) |
| `npm run kpay:urls` | Print resolved KBZPay gateway URLs from function env |

**TCB-first console setup:** [docs/TCB_CONSOLE_SETUP.md](docs/TCB_CONSOLE_SETUP.md)

## Environment

Copy `.env.example` → `.env`. Vite exposes only `VITE_*` variables.

**Required for local dev / EdgeOne build:**

```bash
VITE_CLOUDBASE_ENV_ID=nexa-mm-i0goiaxufc1521e43
VITE_CLOUDBASE_REGION=ap-singapore
VITE_CLOUDBASE_API_BASE_URL=https://nexa-mm-i0goiaxufc1521e43-1446771428.ap-singapore.app.tcloudbase.com/make-server-16010b6f
VITE_CLOUDBASE_PUBLISHABLE_KEY=<Client Publishable Key>
```

Resolved in `utils/tencent/cloudbase.ts` and re-exported via `utils/supabase/info.tsx` (compat shim).

**TencentDB migration (local scripts only):**

```bash
TENCENT_DATABASE_URL=postgresql://user:PASSWORD@sg-postgres-jwchnpet.sql.tencentcdb.com:23100/postgres
SOURCE_POSTGRES_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres
```

Use URL-encoded passwords for special characters. Linked instance: `postgres-jwchnpet` (managed host often uses port `23100`, not `5432`).

**Optional `VITE_*`:**

- `VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN` (production: `nexa-mm.com`), `VITE_VENDOR_SUBDOMAIN_SLUG_MAP`
- `VITE_PLATFORM_RESERVED_APEX_DOMAINS` (e.g. `nexa-mm.com,nexa-apex.online`)
- `VITE_ADMIN_OPERATION_SECRET` — must match server `EDGE_ADMIN_OPERATION_SECRET`
- `VITE_CLOUDBASE_THUMB_MAX` — width for **legacy** CloudBase Storage render URLs only (KV signed URLs are not transformed)
- `VITE_DEPLOYMENT_PLATFORM` — e.g. `tencent-cloudbase`

**CloudBase function secrets (TCB console):** see `cloudbase/function-env.template.env` — KBZPay, `EDGE_ADMIN_OPERATION_SECRET`, `CLOUDBASE_SERVICE_TOKEN`, `CLOUDBASE_API_PUBLIC_BASE_URL`, **Tencent SES**, optional **Tencent SMS** phone OTP, etc. Image uploads use **TencentDB KV by default** (`CLOUDBASE_STORAGE_API_BASE_URL` optional). Details: [docs/ARCHITECTURE_AND_BACKEND.md](docs/ARCHITECTURE_AND_BACKEND.md) and [docs/TCB_CONSOLE_SETUP.md](docs/TCB_CONSOLE_SETUP.md).

## Deployment

Static SPA frontend (**EdgeOne**) + CloudBase/Tencent backend (functions + TencentDB).

| Change type | Deploy target |
|-------------|---------------|
| Frontend UI (storefront scroll, reset page, cache refresh) | `npm run build` → upload **`dist/`** to EdgeOne |
| API / auth / email / payments | Upload **`.cloudbase/dist/make-server-16010b6f.zip`** (or `npm run deploy:functions`) |

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/TCB_CONSOLE_SETUP.md](docs/TCB_CONSOLE_SETUP.md). After deploy, follow [docs/READ_MODEL_ROLLOUT.md](docs/READ_MODEL_ROLLOUT.md). (Root `DEPLOYMENT_CHECKLIST.md` is legacy — see [docs/LEGACY_DOCS.md](docs/LEGACY_DOCS.md).)

## Documentation Index

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE_AND_BACKEND.md](docs/ARCHITECTURE_AND_BACKEND.md) | **Backend truth:** KV model, SQL read model, Realtime pulses, auth, CloudBase/Tencent Pro limits, scaling |
| [docs/CLIENT_MANUAL.md](docs/CLIENT_MANUAL.md) | **Frontend architecture:** thin-client manual for developers |
| [docs/CODE_REVIEW_AND_ROUTING.md](docs/CODE_REVIEW_AND_ROUTING.md) | Routes, hosts, component map |
| [docs/TCB_CONSOLE_SETUP.md](docs/TCB_CONSOLE_SETUP.md) | **TCB-first setup:** empty DB, console function deploy, EdgeOne, import Supabase later |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting and env setup |
| [docs/READ_MODEL_ROLLOUT.md](docs/READ_MODEL_ROLLOUT.md) | Read-model deploy validation and monitoring |
| [docs/PAYMENTS.md](docs/PAYMENTS.md) | KBZPay (production path) |
| [docs/VENDOR_COMMISSION_AND_WITHDRAWAL.md](docs/VENDOR_COMMISSION_AND_WITHDRAWAL.md) | Commission rates (0% default), vendor KBZPay withdrawal, session auth |
| [docs/CHAT.md](docs/CHAT.md) | **FloatingChat + admin Chat:** guest phone, emoji picker, KV keys, Realtime |
| [docs/FREE_SHIPPING.md](docs/FREE_SHIPPING.md) | Per-vendor free shipping — data model, admin UI, checkout rules |
| [cloudbase/function-env.template.env](cloudbase/function-env.template.env) | Cloud Function env vars (SES, SMS, KBZPay, storage) |
| [docs/PERFORMANCE_AND_CACHING.md](docs/PERFORMANCE_AND_CACHING.md) | LCP, client cache, deploy refresh, scroll restore, Realtime scale notes |
| [docs/NEXA_ADMIN_AND_VENDOR_GUIDE.md](docs/NEXA_ADMIN_AND_VENDOR_GUIDE.md) | Operator workflows |
| [docs/CLIENT_INSTRUCTIONS.md](docs/CLIENT_INSTRUCTIONS.md) | **End-user manual** — how to shop, sell, and manage (presentation-style) |
| [docs/NEXA_SIMPLE_UI_INSTRUCTIONS.md](docs/NEXA_SIMPLE_UI_INSTRUCTIONS.md) | Short non-technical quick reference |
| [docs/VENDOR_ADD_TO_HOME.md](docs/VENDOR_ADD_TO_HOME.md) | Add to Home button — Android/iOS behavior, testing, limitations |
| [docs/UI_ANIMATIONS.md](docs/UI_ANIMATIONS.md) | Animation reference |
| [docs/LEGACY_DOCS.md](docs/LEGACY_DOCS.md) | Outdated root markdown files — do not use |
| [ATTRIBUTIONS.md](ATTRIBUTIONS.md) | Third-party attributions |

## Performance (PageSpeed / LCP)

Production images are stored in **TencentDB KV** and served via signed URLs (no CDN width transform on those URLs). LCP relies on **client-side compression (~500KB)** at upload. Legacy CloudBase Storage `/storage/v1/object/...` URLs (if any remain in imported data) are rewritten to the render endpoint with defaults **256 / 96 / 720** (`gridDisplayImageUrl` / logo / banner).

| Optimization | Effect |
|--------------|--------|
| Client upload compression (~500KB) | Keeps KV-stored originals small for mobile LCP |
| Legacy Storage render rewrite (256px grid, 96px logos, 720px banners) | Only applies to old `/storage/v1/object/{public\|sign}/` URLs |
| Priority load on first 4 product cards + store logo | Faster above-the-fold paint |
| `vendor-storefront-head.js` before React | Avoids wrong tab title / favicon flash on vendor refresh |
| Non-blocking fonts + no global Quill CSS on storefront | Better FCP |
| CloudBase/Tencent preconnect | Faster catalog/API fetch |

After deploy, re-run [PageSpeed Insights](https://pagespeed.web.dev/) on mobile and desktop. See [docs/PERFORMANCE_AND_CACHING.md](docs/PERFORMANCE_AND_CACHING.md).

## Scaling (CloudBase/Tencent Pro)

| Metric | Pro included | Notes for this app |
|--------|--------------|-------------------|
| Auth MAU | 100,000 | One login account = 1 MAU/month; **guests do not count** |
| Realtime connections | 500 peak | Checkout uses filtered `kpay_txn` channels; admin order sync uses **HTTP pulse poll** (2s), not WebSocket |
| Realtime messages | 5M/month | Admin tabs poll `/realtime/pulses` every 2s; order bumps debounced (~350ms) before refetch |
| Edge Function calls | 2M/month | Client cache + SQL read paths reduce repeat scans |

See [docs/ARCHITECTURE_AND_BACKEND.md](docs/ARCHITECTURE_AND_BACKEND.md) §9 for tier guidance (~1k / 10k / 100k / 1M users).

## Important Caveats

- Some internal identifiers still use `kpay` or `sec-` channel prefixes for backwards compatibility; user-facing copy uses **KBZPay** and **NEXA Platform**.
- Legacy markdown in the repo root is outdated — see [docs/LEGACY_DOCS.md](docs/LEGACY_DOCS.md). **This README** and **`docs/`** are the source of truth.
- CloudBase/Tencent URL/key come from **`VITE_CLOUDBASE_*` in `.env`** (EdgeOne build settings), resolved in `utils/tencent/cloudbase.ts`.
- Subdomain tenancy and custom domains require correct DNS + host env on both Vite and edge middleware (see `docs/DEPLOYMENT.md`).
- Do not expect a shared marketplace product catalog at `/` or `/products`; customers shop on individual vendor storefront URLs.
- Admin SQL read paths require migrations deployed; API keeps KV fallbacks if read models are empty or unavailable.

## License

Proprietary — all rights reserved.

---

**Built for the Burmese market** — MMK pricing, Myanmar phone formats, English/Burmese vendor storefront support.
