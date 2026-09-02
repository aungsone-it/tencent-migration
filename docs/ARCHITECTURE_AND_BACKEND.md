# Architecture and Backend Reference

This document describes **how the backend actually works today** — data storage, API layer, auth, Realtime, payments, and CloudBase/COS plan limits. Use it when onboarding developers, planning scale, or auditing docs against the codebase.

For routing and host models, see [CODE_REVIEW_AND_ROUTING.md](./CODE_REVIEW_AND_ROUTING.md).

---

## 1) High-level stack

| Layer | Implementation |
|-------|----------------|
| **Frontend** | React 18 + TypeScript + Vite SPA, hosted as static files (production: **Tencent EdgeOne**)
| **API** | CloudBase/Tencent HTTP Function `make-server-16010b6f` — Hono app in `supabase/functions/make-server-16010b6f/index.tsx` |
| **Payment webhook** | Separate function `kpay-webhook` (signature verified in handler) |
| **Database** | TencentDB for PostgreSQL — KV table `kv_store_16010b6f` + SQL read-model `app_*` tables |
| **Auth** | CloudBase/Tencent Auth for customer accounts; KV-backed vendor/staff auth for admin portals |
| **Storage (images/files)** | **Default:** TencentDB KV object backend (`storage:obj:{bucket}:{path}` in `kv_store_16010b6f`, served via signed URLs). **Optional:** CloudBase Storage HTTP API when `CLOUDBASE_STORAGE_API_BASE_URL` is set on the function |
| **Realtime** | CloudBase/Tencent Realtime on pulse tables (`app_order_pulse`, `app_kv_domain_pulse`, `app_vendor_application_pulse`); admin portal mounts the pulse bridge; storefront/checkout use scoped channels |

---

## 2) CloudBase environment binding

**Frontend:** API URL and publishable key come from **`VITE_CLOUDBASE_*`** in `.env` / EdgeOne build settings, resolved in:

```
utils/tencent/cloudbase.ts   →   cloudbaseApiBaseUrl, cloudbasePublishableKey
utils/supabase/info.tsx      →   compat re-export (legacy import path)
```

Used by `src/utils/api-client.ts`, `AuthContext`, `module-cache.ts`, and most `fetch()` calls.

**Backend functions:** `CLOUDBASE_*` and `TENCENT_*` vars in TCB console — see `cloudbase/function-env.template.env`.

---

## 3) Data model (KV store + SQL read model)

### KV (source of truth for writes)

All major entities are stored as JSON documents in `kv_store_16010b6f`:

| Key prefix | Entity |
|------------|--------|
| `product:` | Products — includes optional `vendorFreeShipping: { [vendorId]: true }` for per-vendor free shipping |
| `order:` | Orders — `orderNumber` uses serial **`NOS-00001`** format; counter key `order_serial_counter` in KV |
| `order_serial_counter` | Global serial allocator for NOS order numbers |
| `order_serial_reservation:{NOS-00001}` | Short-lived reservation during allocation |
| `customer:` | Customer profiles |
| `vendor:` | Vendor records — includes optional `freeShippingEnabled` (super-admin feature gate) |
| `vendor_application:` | Vendor applications |
| `kpay_txn:` | KBZPay transaction state (on TCB — not re-imported from Supabase) |
| `kpay_pwa_draft:` | KBZPay PWA checkout drafts (orphan recovery in super-admin Orders) |
| `vendor_withdrawals:{vendorId}` | KBZPay commission payout history for a vendor |
| `vendor_withdraw_lock:{vendorId}` | In-flight withdrawal lock (prevents concurrent payouts) |
| `vendor_withdrawal_txn:{merchOrderId}` | Single withdrawal record keyed by `VWD-*` merchant order id |
| `vendor_session:{token}` | Vendor login session (30-day TTL) for secured payout routes |
| `vendor_session_active:{vendorId}` | Active session token pointer per vendor |
| `customer:{uid}:cart` | Signed-in cart |
| `wishlist:{uid}` | Wishlist |
| `chat:message:` | Chat messages |
| `chat:conversation:` | Chat conversation metadata (customer, vendor, unread) |
| `staff:activity:{userId}` | Per-staff audit log (max 150 entries per user) |
| `staff:activity:global-feed` | Platform-wide admin activity feed (max 500 entries) |

**Staff activity writes:** Mutations call `appendStaffActivity(actorUserId, …)` in `staff_activity_helpers.tsx`. The actor must be a valid CloudBase/Tencent Auth staff UUID — typically sent as `performedByUserId` in the request body or query. Vendor approve/reject and vendor delete log **Vendor Approved** / **Vendor Deleted** with contact detail `StoreName | email | phone`.

**Staff activity reads:**

```
GET /auth/staff-activities              → full global feed
GET /auth/staff-activities?since=ISO8601  → incremental rows newer than timestamp
GET /auth/staff-activity/:userId          → per-user history (profile timeline)
```

Client cache: `ADMIN_STAFF_ACTIVITIES` in `module-cache.ts`; 30s incremental poll while Settings → Activities tab is open (`STAFF_ACTIVITIES_POLL_MS`).

**Writes:** Edge handlers persist to KV first, then sync to SQL read-model tables via `read_model.ts`. Order **create** and status updates **await** `syncOrderReadModel` + `bumpOrderPulse` for admin list consistency.

### SQL read model (optimized reads)

Migrations under `supabase/migrations/` add normalized tables synced from KV:

| Table | Purpose |
|-------|---------|
| `app_products`, `app_product_skus` | Admin product lists, SKU lookup |
| `app_orders`, `app_order_items` | Admin/vendor order lists |
| `app_vendors` | Vendor directory and admin filters |
| `app_customers` | Customer admin lists |

**Read path:** Hot admin endpoints prefer SQL RPCs (e.g. admin orders, vendor orders, dashboard stats). If read models are missing or empty, handlers **fall back to KV prefix scans**.

**Validation:** `GET /read-model/validate` and `npm run validate:read-model` compare KV vs SQL counts. See [READ_MODEL_ROLLOUT.md](./READ_MODEL_ROLLOUT.md).

**Catalog (storefront):** Vendor pagination still uses dedicated RPCs (`rpc_storefront_catalog`, etc.) with partial indexes — separate from the admin read-model tables.

The KV layer remains the write source; SQL tables are additive and do not replace KV storage yet.

### Image and file storage (current production default)

**NEXA production uses TencentDB for uploaded files** — not a separate object-storage env var. This matches the deployed TCB setup (`CLOUDBASE_STORAGE_API_BASE_URL` unset).

| Step | What happens |
|------|----------------|
| **Client upload** | Admin/vendor UI compresses images client-side (target **~500KB** max for logos and gallery uploads) |
| **API** | `make-server-16010b6f` upload routes (`/products/upload-image`, `/settings/upload-logo`, `/logistics/partners/upload-logo`, profile image routes, etc.) |
| **File bytes** | Stored in **`kv_store_16010b6f`** under keys `storage:obj:{bucket}:{path}` as JSON `{ contentType, base64, size, createdAt }` — see `kv_storage_backend.ts` |
| **Serving** | Signed URLs like `/make-server-16010b6f/storage/object?bucket=…&path=…&sig=…` (requires **`CLOUDBASE_API_PUBLIC_BASE_URL`** on the function so browsers get absolute links) |
| **Entity records** | Products, logistics partners, settings, etc. store **URL strings only** — never embed base64 in partner/product JSON |

**Logical buckets** (created lazily on first upload): `make-16010b6f-logistics-logos`, `make-16010b6f-profile-images`, `make-16010b6f-store-logos`, `make-16010b6f-banners`, product gallery bucket, etc.

**Optional object storage (not required):** If `CLOUDBASE_STORAGE_API_BASE_URL` is set on `make-server-16010b6f`, the same upload code uses the CloudBase PG Storage HTTP API instead of KV blobs. Use this only when you outgrow DB disk or want CDN-backed objects. Leave unset for the current NEXA deployment.

**Legacy Supabase Storage URLs** in imported KV rows may 404 until those assets are re-uploaded through the app or URLs are updated.

**Capacity note:** Linked instance `postgres-jwchnpet` (host `sg-postgres-jwchnpet.sql.tencentcdb.com`) holds **all** KV data, SQL read models, and KV-stored images. Plan quotas (e.g. Pro included disk) differ from the **provisioned** instance disk — scale disk in the TencentDB console when needed. At ~500KB per compressed upload, image volume is manageable for typical catalog sizes.

---

## 4) API surface

**Base URL (all clients):**

```
$CLOUDBASE_API_BASE_URL
```

**Authorization:** Almost all requests send `Authorization: Bearer {publicAnonKey}` — the CloudBase/Tencent anon JWT. User-scoped operations rely on application-layer checks in the Edge Function, not Postgres RLS on the KV table.

**Destructive admin routes:** Protected by optional `EDGE_ADMIN_OPERATION_SECRET` (server) + `VITE_ADMIN_OPERATION_SECRET` (client header via `getAdminOperationHeaders()` in `api-client.ts`).

**Hot public read path:**

```
GET /vendor/products/:vendorId?page=&pageSize=&category=&q=
```

Uses server pagination + category filter (see `fetchVendorProducts` in `module-cache.ts`).

**Vendor application validation** (`POST /vendor-applications`, `PUT /vendor-applications/:id`, `POST /vendors/validate`):

- Myanmar phone: `+959XXXXXXXXX` or `09XXXXXXXXX`
- Store description: minimum 10 characters
- Email policy: one email per vendor account; blocks duplicate pending/approved applications (`vendorEmailPolicyConflict`)

**Free shipping (vendor-scoped):**

| Method | Route | Purpose |
|--------|-------|---------|
| `PUT` | `/products/:id` | Patch `vendorFreeShipping` map for one vendor |
| `POST` | `/vendor/categories/:categoryId/bulk-free-shipping` | Bulk enable/disable for all category `productIds` |
| `GET` | `/vendor/categories-details/:vendorId` | Category rows include `freeShippingEnabledCount` / `freeShippingTotalCount` |
| `GET` | `/vendor/products-admin/:vendorId` | Products include derived `freeShipping` boolean |

Order create rejects `shippingFee === 0` unless every line item resolves as free shipping for that vendor in KV (or client sends `checkoutFreeShipping: true` with matching line flags). Client helpers: `src/app/utils/freeShipping.ts`. Checkout delivery dropdown shows **FREE** labels (no quoted fee or ETA) when all items qualify. Full reference: [FREE_SHIPPING.md](./FREE_SHIPPING.md).

**Order numbers (serial):**

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/orders/next-number` | Pre-allocate next serial (`NOS-00001`, `NOS-00002`, …) before checkout POST |
| `POST` | `/orders` | Creates order; accepts pre-allocated `orderNumber` or allocates server-side |

Implementation: `order_number.ts` — KV counter `order_serial_counter`, reservation keys, bootstrap from existing `order:*` rows. Display helper unwraps legacy stacked prefixes (`MOS-NOS-00001` → `NOS-00001`). Client: `src/app/utils/orderNumber.ts`.

**Checkout Seller ID:** Required on vendor checkout; stored on order as `sellerId` (alias `zipCode` for legacy compatibility). Shown in admin order detail, print invoice, and **`.xls` order export**.

**Coupon validation:** `POST /campaigns/validate` checks KV `campaign:*` rows. Invalid codes return a generic **"Invalid coupon code"** message — the API does **not** enumerate available codes in error responses (avoids leaking active promo codes).

**Admin order export:** Super-admin Orders toolbar exports **`.xls`** (Excel HTML via `buildOrderExportSpreadsheetHtml`) with merged cells for multi-item orders. See `src/app/utils/orderExportCsv.ts`.

**Vendor commission wallet & KBZPay withdrawal** (vendor session required — `x-vendor-session`):

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/vendor/commission-wallet/:vendorId` | Balances and withdrawal history |
| `PUT` / `POST` | `/vendor/kpay-account/:vendorId` | Save KBZPay payout phone |
| `POST` | `/vendor/commission-withdraw/:vendorId` | Payout available balance via KBZ `businesspay` |
| `POST` | `/vendor-auth/logout` | Revoke vendor session token |

Default platform commission is **0%** unless admin sets vendor or product rates. See [VENDOR_COMMISSION_AND_WITHDRAWAL.md](./VENDOR_COMMISSION_AND_WITHDRAWAL.md).

**Admin audit (Settings → Activities):** Tracks **super-admin portal** actions only — product/user/vendor CRUD (explicit), settings, categories, orders status changes, etc. Storefront traffic (cart, checkout, KBZPay, customer self-service) is **not** logged. Actor must be a staff profile in `auth:user:{id}` with a staff role; `x-actor-user-id` is sent only from `migoo-staff-actor-id` (admin session), never from customer `migoo-user`.

---

## 5) Auth model

| User type | Auth mechanism | Counts toward CloudBase/Tencent MAU? |
|-----------|----------------|----------------------------|
| **Guest shopper** | No login; anon JWT on API calls; cart in `localStorage` | **No** |
| **Registered customer** | CloudBase/Tencent Auth (`signInWithPassword`, etc.) | **Yes** — 1 MAU per unique user ID per billing month |
| **Vendor admin** | Vendor login (`/vendor-auth/login`) issues a **server session token** (`x-vendor-session`) for secured routes (commission wallet, KBZ payout account, withdraw). KV-backed vendor password auth + `VendorAuthContext`. | **Yes** (if using CloudBase/Tencent Auth session) |
| **Super admin / staff** | KV-backed staff auth (`auth:user:{id}`) + role checks | **Yes** (when using staff login) |

**Canonical staff roles** (assignable on create/update): `store-owner`, `administrator`, `data-entry`, `warehouse`, `customer-services` — enforced in `auth_routes.tsx` (`CANONICAL_STAFF_ROLES`) and `superAdminRolePermissions.ts`.

**Staff user list:** `GET /auth/users` runs **`reconcileAuthUsersList`** first — merges orphan `user:email` KV profiles into `auth:users-list` and backfills `auth:user:{id}` when missing.

**New staff passwords:** `generatePassword()` produces **12-character alphanumeric** strings (no special characters) for easier copy/share; returned once in the create-user response for the admin copy dialog.

**MAU rule:** One account = one MAU for the whole month, regardless of daily logins or open tabs. Guest visits do not consume the 100k MAU quota on CloudBase/Tencent Pro.

The app does **not** currently use `signInAnonymously()` for guests.

### Password reset (OTP email)

Password reset is **server-only** via Tencent Cloud SES approved templates (not inline HTML, not Resend):

| Step | Behavior |
|------|----------|
| Client | `POST /auth/send-email-otp` with email (+ optional `accountType: "vendor"`) |
| Server | Generates OTP, stores hash in KV, sends via `SendEmail` + `TemplateID` + `TemplateData` (`otp_code`) |
| Client | `POST /auth/verify-otp-and-reset` with email, OTP, new password |
| Health | `GET /auth/email-health` → `{ ok, provider: "tencent-ses", passwordResetTemplateId }` |

**Function env (required):** `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `TENCENT_SES_FROM_EMAIL`, `TENCENT_SES_PASSWORD_RESET_TEMPLATE_ID`, `TENCENT_SES_REGION=ap-singapore` (see `cloudbase/function-env.template.env`).

**UI routes:** `/reset-password` — vendor admin uses `?returnTo=/admin&account=vendor` from storefront login **Forgot Password?**

Redeploy the **function zip** after changing SES code or template env vars.

### Phone OTP (customer registration SMS)

Optional Tencent Cloud SMS on `make-server-16010b6f` (`TENCENT_SMS_*` in `cloudbase/function-env.template.env`). Myanmar numbers use Global SMS (`ap-singapore`). Twilio vars are a fallback only when Tencent SMS is unset. `SMS_DEV_MODE=1` logs OTP in function logs without sending.

---

## 6) Realtime (current behavior)

**Super-admin portal routes** mount `OrderRealtimeBridge` via `AdminRealtimeBridge` in `routes.tsx`. TencentDB/CloudBase does **not** expose Supabase-style Realtime WebSockets on pulse tables — the bridge **polls** a tiny HTTP endpoint instead.

| Mechanism | Detail |
|-----------|--------|
| Poll interval | **2 seconds** while the admin tab is **visible** (`PULSE_POLL_MS`) |
| Endpoint | `GET /realtime/pulses` — returns bump counters from `app_order_pulse`, `app_vendor_application_pulse`, `app_kv_domain_pulse` |
| Order debounce | **~350ms** after order counter change → `notifyAdminOrdersUpdated("realtime-order-pulse")` |
| Refetch style | `createAdminOrdersRealtimeRefetchScheduler` — **silent** background reload (no list blink); optional 2s retry while SQL read model catches up |

When KV writes occur, server-side triggers bump pulse rows. Order **POST** and status **PUT** **await** `syncOrderReadModel` + `bumpOrderPulse` so admin lists stay consistent.

**Domain fan-out** (on counter change): `products` → cache patch; `categories`, `vendors`, `marketing` → custom events; `customers`, `notifications`, `staff_sessions` → targeted handlers.

**Other subscriptions (unchanged):**

| Location | Channel | Filter |
|----------|---------|--------|
| `Checkout` | `kpay-txn-{orderId}` | Filtered `kpay_txn:{id}` ✓ |
| `FloatingChat` / admin `Chat` | BroadcastChannel + optional Realtime | Inbox pings, conversation messages — see [CHAT.md](./CHAT.md) |
| Signed-in cart/wishlist | `customer:{uid}:cart`, etc. | Filtered ✓ |
| `VendorStoreView` | Product/policy listeners | Scoped to vendor catalog where configured |

**Scale impact:** Pulse **polling** (2s per visible admin tab) uses far fewer connections than per-client WebSocket fanout. Realtime **connections** (~500 on Pro) are driven mainly by checkout `kpay_txn` channels and scoped storefront listeners — not by a global guest pulse bridge.

---

## 7) Payments

### Production path (Myanmar / vendor checkout)

**Active customer payment choices** in `Checkout.tsx`:

- Cash on Delivery (order is created immediately; customer pays on delivery)
- KBZPay QR and PWA flows
- Webhook source: `supabase/functions/kpay-webhook/` (packaged to `.cloudbase/dist/kpay-webhook.zip`)
- Return/summary: apex `/summary`, vendor `/kpay/return`
- Realtime on `kpay_txn:{merchantOrderId}` + HTTP polling fallback (~1.5s during checkout)

See [PAYMENTS.md](./PAYMENTS.md).

### Vendor commission withdrawal (KBZPay Enterprise Payment)

Vendors withdraw accrued net earnings to a **KBZPay wallet** from vendor admin → **Finances**.

- **Default platform commission:** **0%** on vendor contract and products unless admin sets a rate (see [VENDOR_COMMISSION_AND_WITHDRAWAL.md](./VENDOR_COMMISSION_AND_WITHDRAWAL.md)).
- **Payout API:** `POST /vendor/commission-withdraw/:vendorId` — requires `x-vendor-session` header (issued on vendor login).
- **Infrastructure:** KBZ `businesspay` via VPS PHP relay (`businesspay.php` + `KBZ_VPS_API_SECRET`); not the customer checkout QR/PWA path.
- **KV:** `vendor_withdrawals:*`, `vendor_withdraw_lock:*`, `vendor_session:*`.

Full reference: [VENDOR_COMMISSION_AND_WITHDRAWAL.md](./VENDOR_COMMISSION_AND_WITHDRAWAL.md).

### Stripe (not active in vendor checkout)

Code exists but is **not wired** to the live vendor checkout flow:

- `supabase/functions/make-server-16010b6f/stripe_routes.tsx`
- `src/app/components/StripePayment.tsx` (uses `cloudbaseApiBaseUrl` via `utils/supabase/info` shim — same client config as the main app)
- `src/app/components/PaymentSettings.tsx` (admin UI stub)

Do not document Stripe as a supported customer payment method unless it is integrated into `Checkout.tsx`.

---

## 8) Caching layers

| Layer | Where | TTL / behavior |
|-------|-------|----------------|
| **Client session cache** | `src/app/utils/module-cache.ts` | In-memory Map; coalesced fetches; localStorage for some page-1 slices |
| **Edge in-memory cache** | `server_cache.ts` (`getCached` / `setCache` / `clearCache`) | Per-isolate Map; cleared on order mutations |
| **Client orders cache** | `module-cache.ts` | Paginated `admin-orders-page-*` keys; optimistic patches on status/recover (no full refetch) |
| **CDN / static** | EdgeOne (`edgeone.json` + `public/_headers`) | Long cache on `/assets/*`; `no-cache` on `index.html` and `/version.json` |
| **Deploy version** | `deployVersion.ts` + `dist/version.json` | Open tabs poll every 2 min; hard-reload once after EdgeOne deploy (preserves auth + KBZPay session keys) |
| **Image delivery** | Client compression (~500KB) + KV signed URLs | Default production path has **no** CDN width transform; `VITE_CLOUDBASE_THUMB_MAX` / 256·96·720 defaults apply only to legacy Storage render URLs |

See [PERFORMANCE_AND_CACHING.md](./PERFORMANCE_AND_CACHING.md).

---

## 9) CloudBase/Tencent Pro plan — what limits what

**Pro ($25/mo) includes (typical):** 100k Auth MAU, 2M Cloud Function invocations/mo, 500 Realtime peak connections, 5M Realtime messages/mo, 8 GB **plan** disk, Micro compute credit. Provisioned TencentDB disk on `postgres-jwchnpet` may be larger than the plan included figure.

| Traffic | Pro sufficient? | First limit hit |
|---------|-----------------|-----------------|
| ~1k MAU + guests | **Yes** | Headroom |
| ~10k MAU + moderate guests | **Marginal** | Realtime messages if pulse fallback to full KV activates often |
| ~100k MAU + heavy guests | **No** without changes | Realtime connections + KV scan latency + function overages |
| Millions total | **No** | Full rearchitecture (relational DB, filtered Realtime, CDN, cache) |

**Concurrent tabs (not MAU):** Default Pro allows ~**500 simultaneous Realtime WebSocket connections**. The pulse bridge mounts on **admin** routes only; guest storefronts may open scoped catalog/policy listeners and checkout uses filtered `kpay_txn` channels — flash sales still matter for checkout Realtime, not for a global guest pulse bridge.

**Recommended before scale:**

1. Keep pulse migrations deployed so KV fallback stays rare
2. Keep filtered Realtime for checkout (`kpay_txn`) and signed-in cart/wishlist
3. CDN-cache public catalog responses
4. Upgrade compute Micro → Small when admin SQL RPCs slow down
5. Monitor read-model drift with `/read-model/validate` after bulk imports

---

## 10) Deploy commands

```bash
npm run deploy:functions   # Cloud Functions via CLI
npm run db:schema          # Migrations only (safe re-run)
npm run setup:tcb-first    # Schema + console zip packages
npm run deploy:cloudbase   # Migrations + both functions
```

Functions (source → package → deploy):

- `supabase/functions/make-server-16010b6f/` → `.cloudbase/dist/make-server-16010b6f.zip`
- `supabase/functions/kpay-webhook/` → `.cloudbase/dist/kpay-webhook.zip`

---

## 11) Related docs

| Doc | Topic |
|-----|-------|
| [CODE_REVIEW_AND_ROUTING.md](./CODE_REVIEW_AND_ROUTING.md) | Routes, hosts, guards |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Hosting checklist |
| [PAYMENTS.md](./PAYMENTS.md) | KBZPay flows |
| [VENDOR_COMMISSION_AND_WITHDRAWAL.md](./VENDOR_COMMISSION_AND_WITHDRAWAL.md) | Commission rates (0% default), vendor KBZPay withdrawal |
| [FREE_SHIPPING.md](./FREE_SHIPPING.md) | Per-vendor free shipping — KV model, API, checkout |
| [CHAT.md](./CHAT.md) | FloatingChat, admin Chat, guest phone, emoji picker |
| [PERFORMANCE_AND_CACHING.md](./PERFORMANCE_AND_CACHING.md) | LCP, client cache |
| [READ_MODEL_ROLLOUT.md](./READ_MODEL_ROLLOUT.md) | Read-model deploy validation |
| [LEGACY_DOCS.md](./LEGACY_DOCS.md) | Outdated root markdown files |
