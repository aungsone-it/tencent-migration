# NEXA Platform — Client Manual (Technical Reference)

> Presentation-style reference for how the **frontend** behaves across the entire system.  
> The client is a **thin presentation layer**. The server owns truth.

Use this when onboarding developers, reviewing PRs, or deciding where new logic belongs.

**Related docs:** [ARCHITECTURE_AND_BACKEND.md](./ARCHITECTURE_AND_BACKEND.md) · [PERFORMANCE_AND_CACHING.md](./PERFORMANCE_AND_CACHING.md) · [CODE_REVIEW_AND_ROUTING.md](./CODE_REVIEW_AND_ROUTING.md)

---

## Slide 1 — What is the Frontend Client?

The **frontend client** is the React SPA (`src/`). It:

- Renders UI (storefront, admin, vendor portal)
- Sends HTTP requests to CloudBase Edge Functions
- Caches responses for speed
- Reacts to Realtime **pulses** (invalidation signals)
- Applies **optimistic UI** for responsiveness

It does **not** own durable business state. All writes go to the server.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Frontend Client)                                      │
│  React 18 + Vite SPA                                        │
│  ┌────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Pages/UI   │  │ module-cache│  │ OrderRealtimeBridge │  │
│  │ CartContext│  │ localStorage│  │ (pulse → refetch)   │  │
│  └─────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│        └────────────────┼─────────────────────┘             │
│                         │ HTTPS                             │
└─────────────────────────┼───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CloudBase Edge Functions (Backend Server)                    │
│  make-server-16010b6f (Hono)  │  kpay-webhook               │
│  KV writes → SQL read-model sync → signed URLs → webhooks   │
└─────────────────────────┼───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  TencentDB for PostgreSQL                                   │
│  kv_store_16010b6f (write source of truth)                  │
│  app_* tables (read models) + pulse tables (Realtime)       │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 2 — The Golden Rule

| Question | Answer |
|----------|--------|
| Who owns product prices, stock, order status? | **Server** (KV) |
| Who validates Myanmar phone numbers? | **Server** |
| Who creates orders after KBZPay payment? | **Server** (webhook + `pwa_finalize`) |
| Who decides SKU uniqueness? | **Server** (fail-closed) |
| Who renders the checkout form? | **Client** |
| Who caches the vendor catalog? | **Client** (display copy only) |
| Who compresses images before upload? | **Client** (transport optimization) |

**Rule:** If a wrong answer would lose money, break inventory, or violate policy → **server only**.

---

## Slide 3 — Three Surfaces, One Client

All three portals share the same SPA and the same thin-client rules.

| Surface | URL pattern | Who uses it |
|---------|-------------|-------------|
| **Platform apex** | `www.nexa-mm.com/` | Landing, super-admin, onboarding, KPay `/summary` |
| **Vendor storefront** | `{label}.nexa-mm.com/*` or custom domain | Customers shopping one vendor |
| **Vendor admin** | `{label}.nexa-mm.com/admin` or `/vendor/:slug/admin` | Store owners |

There is **no shared marketplace catalog**. Customers always shop **one vendor at a time**.

Entry points:

```
src/app/routes.tsx          → route tree + lazy chunks
src/app/pages/VendorStorefrontPage.tsx   → customer shop
src/app/pages/AdminPage.tsx              → super-admin shell
src/app/components/VendorAdminPortal.tsx → vendor admin shell
```

---

## Slide 4 — Client Responsibilities (What It Does)

### Presentation

- Routing, layout, i18n (English / Burmese)
- Host resolution: subdomain, custom domain, path-based dev URLs
- Animations, toasts, loading skeletons
- Meta Pixel browser events (server also sends Meta CAPI)

### Data access (read)

- `GET` paginated lists from server RPCs or REST endpoints
- Session cache via `module-cache.ts` — *"Load once and no more loading"*
- Cross-session cache via `persistedLocalCache.ts` (TTL slices)
- Client-side filter/search on **already-loaded** rows for instant UX

### Data access (write)

- `POST` / `PUT` / `DELETE` through `api-client.ts` and `api.ts`
- Optimistic cache patches, then server confirms or client rolls back
- `keepalive` on critical mutations (order status PUT during navigation)

### Transport helpers

- Image compression (~500 KB target) before upload
- Bearer publishable key on every request
- Staff audit header: `x-actor-user-id` from `migoo-staff-actor-id`

---

## Slide 5 — Server Responsibilities (What Client Must Not Do)

| Domain | Server owns |
|--------|-------------|
| **Auth** | CloudBase Auth JWT validation, vendor/staff KV auth, password reset OTP via **Tencent SES template** |
| **Products** | SKU uniqueness, inventory adjustment, category sync |
| **Orders** | Creation, status transitions, refund/cancel, read-model sync |
| **Payments** | KBZPay signing, webhook verification, PWA draft storage, order finalize |
| **Customers** | Profile CRUD; KV authoritative (SQL read model may lag) |
| **Vendors** | Application approval, subdomain assignment, delete audit |
| **Storage** | Blob persist in KV (`storage:obj:*`), signed URL generation |
| **Audit** | Staff activity log (`staff:activity:*`) |
| **Secrets** | Admin operation secret, KPay keys, **Tencent SES** (CAM keys + template ID), Meta CAPI token |

Client must **never** embed secrets or bypass server validation.

---

## Slide 6 — Request Path (Every API Call)

```
Component / Hook
      │
      ▼
src/utils/api.ts          ← typed wrappers (~83 call sites)
      │
      ▼
src/utils/api-client.ts   ← retries, timeouts, error types, admin headers
      │
      ▼
utils/tencent/cloudbase.ts  ← VITE_CLOUDBASE_API_BASE_URL
      │
      ▼
Authorization: Bearer {VITE_CLOUDBASE_PUBLISHABLE_KEY}
      │
      ▼
POST/GET …/v1/functions/make-server-16010b6f/{route}
      │
      ▼
Hono handler → KV write → read_model sync → JSON response
```

Config resolution:

| Env var | Purpose |
|---------|---------|
| `VITE_CLOUDBASE_ENV_ID` | CloudBase environment |
| `VITE_CLOUDBASE_API_BASE_URL` | Edge function base URL |
| `VITE_CLOUDBASE_PUBLISHABLE_KEY` | Anon JWT on every request |
| `VITE_ADMIN_OPERATION_SECRET` | Destructive admin ops (optional) |

---

## Slide 7 — Caching Layers (Client Side)

The client has **four cache tiers**. None of them is authoritative.

```
┌──────────────────────────────────────────────────────────┐
│ 1. React component state     ← instant UI, lost on unmount│
├──────────────────────────────────────────────────────────┤
│ 2. module-cache.ts (session) ← coalesced fetches, ~100 calls│
├──────────────────────────────────────────────────────────┤
│ 3. persistedLocalCache.ts    ← localStorage TTL slices    │
├──────────────────────────────────────────────────────────┤
│ 4. SmartCache (src/utils/cache.ts) ← generic wrapper      │
└──────────────────────────────────────────────────────────┘
                          │
              Server response always wins on conflict
```

Key behaviors:

- **Request coalescing** — duplicate in-flight fetches share one promise
- **forceRefresh** — bypasses cache after mutations (inventory after order PUT)
- **Category tab change** — must refetch server page, not filter page 1 in memory
- **Guest cart** — localStorage only; signed-in cart — server KV `customer:{uid}:cart`

Philosophy from `module-cache.ts`:

> Reduces API calls from thousands to ~100 per session.

---

## Slide 8 — Flow: Vendor Storefront Catalog

```
Customer opens gogo.nexa-mm.com
        │
        ▼
VendorStorefrontPage → VendorStoreView
        │
        ▼
fetchVendorProducts() in module-cache.ts
        │
        ▼
GET /vendor/products/:vendorId?page=&pageSize=&category=&q=
        │
        ▼
Server: rpc_storefront_catalog (SQL) with KV fallback
        │
        ▼
Client caches by vendor + page + category + query
        │
        ▼
Instant search filters loaded rows; debounced `q` refetches server
```

**Client rule:** Pagination and category filters always come from the server. Client filter is UX-only on loaded data.

Files: `VendorStoreView.tsx`, `module-cache.ts`, `vendorStorefrontProductStats.ts`, `vendorBrowseScroll.ts`, `ScrollController.tsx`

---

## Slide 8b — Flow: Product detail → Back (scroll restore)

```
Customer scrolls vendor grid → taps product
        │
        ▼
VendorStoreView saves scrollTop (window + container) + category tab
        │  history.state + sessionStorage (persistedSessionCache)
        ▼
Product detail route (/product/:slug)
        │
        ▼
Customer taps Back (browser or header)
        │
        ▼
ScrollController skips scroll-to-top on list ↔ product transition
        │
        ▼
VendorStoreView restores scroll + optional anchor (data-vendor-product-id)
```

**Client rule:** Scroll position is UX state only — catalog data still comes from server cache/refetch.

---

## Slide 9 — Flow: Cart and Wishlist

```
┌─────────────────┬──────────────────────────────────────────┐
│ Guest shopper   │ Signed-in customer                       │
├─────────────────┼──────────────────────────────────────────┤
│ Cart in         │ Cart in KV customer:{uid}:cart           │
│ localStorage    │ + immediate PUT on mutation              │
│                 │ + Realtime for cross-tab sync            │
├─────────────────┼──────────────────────────────────────────┤
│ Wishlist local  │ PUT /wishlist/:userId on server          │
└─────────────────┴──────────────────────────────────────────┘
```

Pattern:

1. Update local React state immediately (feels instant)
2. Persist to localStorage (guest) or server (signed-in)
3. On tab focus — throttled GET, not aggressive polling
4. Server response reconciles any drift

Files: `CartContext.tsx`, `VendorStoreView.tsx` (wishlist toggle)

---

## Slide 10 — Flow: Checkout and KBZPay

Why the server stores the checkout draft:

> KBZPay returns in its in-app WebView where **localStorage is often empty**.

```
Client: POST /kpay/pwa/start
        { cart, shipping, draftOrder }
              │
              ▼
Server: saves kpay_pwa_draft:{merchantOrderId} in KV
              │
              ▼
Customer pays in KBZPay app
              │
              ▼
kpay-webhook → pwa_finalize.ts → creates order in KV
              │
              ▼
Client: Realtime on kpay_txn:{orderId}  (primary)
        + poll ~1.5s                      (fallback)
              │
              ▼
Redirect to apex `/summary` (e.g. `nexa-apex.online/summary`) → Continue Shopping → vendor store
```

**Client rule:** Client never marks an order as paid. It waits for server state.

Files: `Checkout.tsx`, `kpayClient.ts`, `supabase/functions/.../kpay_routes.tsx`, `pwa_finalize.ts`

---

## Slide 11 — Flow: Admin Orders

```
Admin opens Orders tab
        │
        ▼
GET /orders → rpc_admin_orders_page (SQL read model)
        │      fallback: KV prefix scan
        ▼
module-cache.ts stores paginated result
        │
        ▼
Staff changes status → optimistic patch in cache + UI
        │
        ▼
PUT /orders/:id (keepalive) → server writes KV + syncs SQL
        │
        ▼
OrderRealtimeBridge hears app_order_pulse → debounce 400ms → refetch
```

Optimistic UI is allowed because:

- It patches **display cache**, not server state
- Failed PUT rolls back via `orderInventoryCacheSync.ts`
- Server PUT is always the final word

Files: `Orders.tsx`, `OrderRealtimeBridge.tsx`, `adminOrdersRealtime.ts`, `orderInventoryCacheSync.ts`

---

## Slide 12 — Realtime: Pulses, Not Payloads

The client does **not** receive full entity updates over Realtime.

```
KV row changes on server
        │
        ▼
Postgres pulse table bumps (app_order_pulse, app_kv_domain_pulse, …)
        │
        ▼
OrderRealtimeBridge (mounted once in ProvidersWrapper)
        │
        ▼
Debounce (~400ms) → notifyAdminOrdersUpdated()
        │
        ▼
Affected caches invalidate or refetch
```

Pulse tables:

| Table | Triggers |
|-------|----------|
| `app_order_pulse` | Order create/update/delete |
| `app_kv_domain_pulse` | Products, settings, policies |
| `app_vendor_application_pulse` | Vendor application queue |

Legacy fallback: full KV subscription only if pulse channel fails.

**Client rule:** Realtime tells you *something changed* — go ask the server.

---

## Slide 13 — Optimistic UI (Allowed Exception)

Optimistic updates are **UX sugar**, not business logic.

| Surface | What client patches locally | Rollback on failure |
|---------|---------------------------|---------------------|
| Order status | List row + badge count | `orderInventoryCacheSync.ts` |
| Inventory after status change | Product stock in cache | Full refetch + merge |
| Vendor delete | Remove row from list | Restore previous list |
| Vendor application approve | Status badge | Refetch applications |
| Wishlist toggle | Heart icon + saved list | Revert toggle |
| Chat messages | Instant bubble | Server merge wins |

Pattern:

```
1. Patch cache + UI immediately
2. Send mutation to server
3. Success → keep patch (server confirms same state)
4. Failure → revert cache + show error toast
```

---

## Slide 14 — Image Uploads

```
Admin selects image
        │
        ▼
Client compresses to ~500 KB
        │
        ▼
POST /products/upload-image  (or settings/logistics/profile routes)
        │
        ▼
Server stores bytes in KV: storage:obj:{bucket}:{path}
        │
        ▼
Returns signed URL → stored in product/settings record (URL only, never base64 in JSON)
        │
        ▼
Client displays via resolveCloudBaseMediaUrl() with thumb sizes:
  grid 480px · logo 128px · banner 960px
```

**Client rule:** Client prepares the file; server stores and serves it.

---

## Slide 15 — Auth Model

| Actor | Auth mechanism | Client storage |
|-------|----------------|----------------|
| **Guest shopper** | Anon publishable key | No account; cart in localStorage |
| **Customer** | CloudBase Auth JWT | Session in AuthContext |
| **Vendor admin** | Vendor KV auth | VendorAuthContext |
| **Super-admin staff** | CloudBase Auth + role | AuthContext + `migoo-staff-actor-id` |

Guest browsers **do not** count toward Auth MAU limits.

**Password reset:** `/reset-password` → `POST /auth/send-email-otp` → email OTP (Tencent SES template) → `POST /auth/verify-otp-and-reset`. Vendor admin: `?returnTo=/admin&account=vendor`. Verify backend: `GET /auth/email-health`.

Every API call includes:

```
Authorization: Bearer {VITE_CLOUDBASE_PUBLISHABLE_KEY}
```

Staff destructive ops also send:

```
x-admin-operation-secret: {VITE_ADMIN_OPERATION_SECRET}
x-actor-user-id: {UUID from localStorage}
```

Files: `AuthContext.tsx`, `VendorAuthContext.tsx`, `auth_routes.tsx`, `tencent_ses.tsx`, `ResetPasswordPage.tsx`, `ForgotPassword.tsx`

---

## Slide 15b — Deploy version watcher

```
EdgeOne deploy → new dist/version.json { buildId }
        │
        ▼
Open tabs poll /version.json (2 min + tab focus)
        │
        ▼
buildId ≠ localStorage migoo-deploy-version
        │
        ▼
purgeDeployClientCaches() — keep auth + KBZPay session keys
        │
        ▼
Hard reload once (?_dv=buildId) — user gets new JS bundle
```

Files: `deployVersion.ts`, `vite.config.ts`, `public/_headers`

---

## Slide 16 — File Map (Client)

| File | Role in thin client |
|------|---------------------|
| `src/app/routes.tsx` | Route tree; mounts `OrderRealtimeBridge` |
| `src/utils/api-client.ts` | HTTP layer: retries, timeouts, errors |
| `src/utils/api.ts` | Typed API wrappers |
| `src/app/utils/module-cache.ts` | Session cache + fetch coalescing |
| `src/app/utils/persistedLocalCache.ts` | localStorage TTL cache |
| `src/app/components/OrderRealtimeBridge.tsx` | Global pulse listener |
| `src/app/components/CartContext.tsx` | Cart state (guest local / signed-in server) |
| `src/app/components/VendorStoreView.tsx` | Storefront catalog + wishlist + scroll restore |
| `src/app/utils/deployVersion.ts` | Post-deploy cache purge + hard reload |
| `src/app/utils/vendorBrowseScroll.ts` | Storefront scroll save/restore |
| `src/app/components/ScrollController.tsx` | Route-level scroll behavior |
| `src/app/components/Checkout.tsx` | Checkout + KPay wait loop |
| `src/app/components/Orders.tsx` | Admin orders + optimistic status |
| `src/app/utils/kpayClient.ts` | KPay API wrapper → server |
| `utils/tencent/cloudbase.ts` | Env config resolution |
| `src/constants/index.ts` | Timeouts, polling guardrails |

---

## Slide 17 — File Map (Server)

| File | Role |
|------|------|
| `supabase/functions/make-server-16010b6f/index.tsx` | Hono app — all REST routes |
| `kv_store.tsx` | KV get/set/del/prefix |
| `read_model.ts` | KV → SQL sync |
| `server_cache.ts` | Per-isolate edge cache |
| `auth_routes.tsx` | Auth, staff activities, OTP reset |
| `tencent_ses.tsx` | Tencent SES template send |
| `customer_routes.tsx` | Customer CRUD + paginated admin |
| `kpay_routes.tsx` | KBZPay QR + PWA start |
| `pwa_finalize.ts` | Post-payment order creation |
| `kv_storage_backend.ts` | Image blob storage in KV |
| `supabase/functions/kpay-webhook/index.ts` | Payment webhook handler |

---

## Slide 18 — API Quick Reference

Base: `$VITE_CLOUDBASE_API_BASE_URL` → typically `…/v1/functions/make-server-16010b6f`

| Domain | Endpoints |
|--------|-----------|
| Health | `GET /health`, `GET /read-model/validate` |
| Storefront | `GET /vendor/products/:vendorId`, `GET /vendors/by-slug/:slug` |
| Products (admin) | `GET/POST/PUT/DELETE /products`, `GET /check-sku/:sku` |
| Orders | `GET/POST/PUT/DELETE /orders`, `GET /user/:userId/orders` |
| Customers | `GET/POST/PUT /customers` |
| Auth | `/auth/send-email-otp`, `/auth/verify-otp-and-reset`, `/auth/email-health`, `/auth/*`, `/vendor-auth/*`, `/wishlist/:userId` |
| Settings | `/settings/general`, upload logo/banner |
| KPay | `/kpay/create-qr`, `/kpay/pwa/start`, `/kpay/pwa/finalize/:id` |
| Storage | `GET /storage/object?bucket=&path=&sig=` |

Full route map: [CODE_REVIEW_AND_ROUTING.md](./CODE_REVIEW_AND_ROUTING.md)

---

## Slide 19 — Polling Exceptions

Prefer event-driven invalidation. Polling is a **last resort**.

| Surface | Interval | Why |
|---------|----------|-----|
| KPay checkout | ~1.5s | WebView return + webhook latency |
| Settings → Activities | 30s | Incremental staff audit feed while tab open |
| Deploy version | 2 min + focus | One hard reload after EdgeOne deploy |

Do **not** add new polling loops without reviewing CloudBase invocation limits.

## Slide 20 — Decision Tree: Where Does This Logic Go?

```
New feature or bug fix
        │
        ▼
Does it change durable state or enforce a business rule?
        │
   YES ─┴─ NO
   │       │
   ▼       ▼
 SERVER   Is it pure UI (layout, animation, copy)?
           │
      YES ─┴─ NO
       │       │
       ▼       ▼
    CLIENT   Is it a cache/transport optimization?
               │
          YES ─┴─ NO
           │       │
           ▼       ▼
        CLIENT   Re-evaluate — probably SERVER
```

Examples:

| Feature | Goes in |
|---------|---------|
| "Show sale badge if discount > 0" | Client (display computed field from server data) |
| "Reject duplicate SKU" | Server (`/check-sku`) |
| "Compress logo before upload" | Client |
| "Calculate delivery fee by region" | Server |
| "Debounce search input" | Client |
| "Create order after payment" | Server (`pwa_finalize`) |

---

## Slide 21 — Common Mistakes to Avoid

| Mistake | Why it breaks thin client |
|---------|---------------------------|
| Filter paginated admin list in memory only | Page 2+ data never loaded |
| Skip server refetch after category tab change | Wrong products shown |
| Store checkout draft only in localStorage | Lost in KBZPay WebView |
| Trust client-side stock count for checkout | Race with other sessions |
| Embed KPay or admin secrets in frontend | Security leak |
| Add 5s polling on every page | Burns Edge Function quota |
| Treat SQL read model as write source | KV is authoritative |
| Skip rollback on failed optimistic PUT | UI shows wrong inventory |

---

## Slide 22 — Verification Checklist

After any client-side data change, verify:

- [ ] Hard refresh — does data match server?
- [ ] Two tabs logged in as same user — do cart/wishlist sync?
- [ ] Mutation failure — does optimistic UI roll back?
- [ ] Category tab switch — does server refetch (not memory filter)?
- [ ] KPay checkout in mobile WebView — does order appear after payment?
- [ ] Admin order status change — badge updates without full-page blink?
- [ ] Guest → sign-in — cart behavior correct per actor type?
- [ ] Product detail → Back — storefront scroll and category tab restored?
- [ ] Password reset — OTP email arrives; `/auth/email-health` ok on server?
- [ ] After EdgeOne deploy — open tab reloads once with new `buildId` in `/version.json`?

---

## Slide 23 — Glossary

| Term | Meaning |
|------|---------|
| **Frontend client** | React SPA — display + cache + submit; no authoritative state |
| **Backend server** | Edge Functions + KV — business logic and persistence |
| **KV store** | `kv_store_16010b6f` — JSONB documents; write source of truth |
| **Read model** | `app_*` SQL tables synced from KV for fast list queries |
| **Pulse** | Realtime invalidation signal (counter bump, not data payload) |
| **Module cache** | Session in-memory cache with request coalescing |
| **Optimistic UI** | Local cache patch before server confirms |
| **PWA draft** | Server-stored checkout payload for post-KPay order creation |
| **Publishable key** | CloudBase anon JWT sent on every API request |
| **Vendor-first** | No shared marketplace; one vendor per storefront session |
| **Fail-closed** | Sensitive checks reject rather than guess (SKU, admin secret) |

---

## Slide 24 — Summary

> **The NEXA frontend is a stateless presentation layer.**

It renders vendor storefronts and admin portals, caches server responses aggressively, and reacts to Realtime invalidation pulses. All durable state, business rules, payment flows, and audit trails live in CloudBase Edge Functions writing to TencentDB KV, with SQL read models for performant queries.

**The client never owns truth — it displays, caches, and submits.**

When in doubt: put logic on the server, not in the browser.

---

*Last updated: July 2026 · NEXA Platform / Tencent migration*
