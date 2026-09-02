# NEXA Platform — Super Admin and Vendor Guide

This guide documents operator workflows for the current **NEXA Platform** app (**vendor storefronts** — there is no shared marketplace shopping catalog).

## 1) Access and route model

### Super admin

- Portal: `/admin` and `/admin/:section`
- Host: platform apex (e.g. `https://www.nexa-mm.com/admin`)

### Vendor public storefront

Customers shop on **one vendor at a time**:

| Deployment | Public store URL |
|------------|------------------|
| Subdomain (production) | `https://{label}.{VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN}/` (current base: `nexa-mm.com`, e.g. `https://gogo.nexa-mm.com/`) |
| Custom domain | `https://your-domain.com/` |
| Path-based (dev) | `https://your-domain/vendor/{store-slug}/` |

### Vendor admin

- Primary: `/vendor/{store-slug}/admin/*`
- On some vendor hosts: `/admin` at the vendor host root
- Legacy path alias: `/store/{store-slug}/admin/*` may redirect to `/vendor/...`

### Vendor onboarding / auth

- `/vendor/application` — apply to sell
- `/vendor/setup` — complete setup after approval
- `/vendor/login` — vendor sign-in (redirects to correct admin host when configured)
- `/reset-password?returnTo=/admin&account=vendor` — vendor admin OTP reset (linked from storefront login **Forgot Password?**)

## 2) Super-admin workflows

### Core areas

- Dashboard/home
- Products, categories, inventory (platform-wide catalog — super admin creates/edits; vendors select only)
- Orders (includes **KBZPay draft recovery** panel)
- Vendors (**Review applications** — new sellers are approved here; there is no “Add vendor” button)
- Customers
- Chat
- **Promo Setting** (campaigns and discount codes — replaces legacy Marketing nav)
- **Subscriptions** (Plans, Subscribers)
- Finances and settings (role dependent)
- Logistics

> Legacy `/admin/marketing` URLs still route to **Promo Setting**.

### Settings tabs

| Tab | Who sees it | Purpose |
|-----|-------------|---------|
| **General** | All roles with Settings access | Platform name, logo, support phone/email, banners |
| **Users** | **Store owner** only | Create/edit/delete staff accounts — temp password copy dialog on create |
| **Activities** | All roles with Settings access | Global audit timeline — every admin action across the platform |

The **Appearance** tab is hidden in the UI; branding fields live under **General**.

**Activities feed behavior:**

- Shows actions such as **User created/updated/deleted**, **Product created/updated/deleted**, **Vendor Approved**, **Vendor Deleted**
- Vendor rows display as: `Vendor Approved > StoreName | email | phone` and **By Name · Role**
- Feed is stored in KV `staff:activity:global-feed` (max 500 entries)
- While the Activities tab is open, the client polls incrementally every **30 seconds** (`?since=` timestamp) — no full reload on every visit
- Approve/reject/delete actions require the acting staff member’s CloudBase Auth UUID (`performedByUserId`) from the browser session

### Vendors and free shipping access

When reviewing or editing a vendor (**Vendor → Review applications** or vendor profile):

- **Free shipping feature access** — super admin toggle (`vendor.freeShippingEnabled`). When off, the vendor admin portal hides free-shipping controls.
- Vendor profile shows how many products are marked free shipping for that store.

Full data model, API, and checkout rules: [FREE_SHIPPING.md](./FREE_SHIPPING.md).

### Vendor commission (super admin)

When creating or editing a vendor (**Vendor form** / approved application):

| Field | Behavior |
|-------|----------|
| **Commission %** | Platform take from that vendor’s sales. **Default: 0%** when left unset or empty. |
| **Product overrides** | Per-product **Commission Rate (%)** in product forms — leave blank to use the vendor contract; enter a value for a product-specific rate. |

Commission is deducted from vendor net earnings before KBZPay withdrawal. Full rules and withdrawal setup: [VENDOR_COMMISSION_AND_WITHDRAWAL.md](./VENDOR_COMMISSION_AND_WITHDRAWAL.md).

### Staff roles (super admin)

Canonical assignable roles (frontend `superAdminRolePermissions.ts`, backend `CANONICAL_STAFF_ROLES`):

| Role | Nav access | Write notes |
|------|------------|-------------|
| **Store owner** | All pages including Finances and Settings → Users | Full write everywhere |
| **Administrator** | All except Finances; Settings (General + Activities, no Users tab) | Full write except Finances |
| **Data entry** | Home, Product, Categories, Inventory, **Promo Setting**, Chat, Settings (General) | Catalog + promo write; no Orders |
| **Warehouse** | Home, Orders, Inventory, Logistics | Orders, inventory, logistics write |
| **Customer services** | Home, Product*, Categories*, Inventory*, Orders, **Promo Setting**, Chat, Logistics* | Orders, chat, promo write; *product/catalog and logistics **read-only** |

**Staff creation:** Settings → Users (store owner) → new user receives a **12-character alphanumeric temp password** shown in a copy dialog. Backend stores `tempPassword: true` until first login/password change.

**User list reconciliation:** `GET /auth/users` calls **`reconcileAuthUsersList`** — merges orphan staff profiles from the `user:email` index into `auth:users-list` and backfills missing `auth:user:{id}` rows.

### Orders

- Paginated list backed by SQL read model (`rpc_admin_orders_page`) with KV fallback
- **Order numbers:** serial format **`NOS-00001`**, **`NOS-00002`**, … (allocated via `GET /orders/next-number` at checkout)
- **Seller ID:** required customer field at vendor checkout; visible on order detail (above notes) and print invoice under customer phone
- **KBZPay draft recovery:** amber panel lists paid PWA checkouts that never became orders; **Recover order** creates the order and prepends it to the list without a full refetch
- Status changes (including cancel on recovered KPay orders) use optimistic UI + cache patches
- **Realtime list refresh:** `OrderRealtimeBridge` polls `/realtime/pulses` every **2s**; order counter bumps trigger debounced **silent** background refetch (no full-list blink)
- **Export:** toolbar downloads **`.xls`** (Excel-compatible HTML) — not CSV. Columns: No, Order date, Mi Code, Name, Phone, **Seller ID**, address, city, **Region**, SKU, Order qty, Price, Total, Vendor, Status, **logistic**, delivery date. Multi-SKU orders: **merged cells** for order-level fields (Mi Code, Vendor, Status, Total, etc.); one row per SKU. Phone stored as Excel text formula to avoid scientific notation.
- Bulk **Delete** is hidden in the toolbar (`SHOW_ORDERS_DELETE_BUTTON = false`; handler retained for future use)
- Sidebar badge counts pending orders using normalized status (not raw KV strings)

### Chat

Super-admin **Chat** (`/admin/chat`) — customer conversations from FloatingChat on storefronts and apex.

| Feature | Behavior |
|---------|----------|
| **Guest display** | Allocated codes (e.g. `#003346`) + phone when collected |
| **Composer** | Text, image upload (compressed), emoji picker (native Unicode) |
| **Phone collection** | Guests prompted for Myanmar phone **after first successful message** (FloatingChat modal) |
| **Realtime** | Inbox pings + conversation broadcasts; polling fallback |

Full reference: [CHAT.md](./CHAT.md).

### Typical daily flow

1. Open `/admin`.
2. Review order/customer/vendor alerts (sidebar badge = pending orders).
3. On **Orders**, check the KBZPay drafts panel if present — recover any paid orphans.
4. Manage catalog and inventory updates.
5. Process order lifecycle transitions (pending → processing → fulfilled / cancelled).
6. Review vendor applications via **Vendor → Review applications**; approve or reject (logged in Activities).
7. Use **Settings → Users** for staff management (store owner only).
8. Check **Settings → Activities** for a cross-platform audit trail when needed.

Platform branding (name, logo) is editable under **Settings → General** and appears on the apex landing page, admin shell, and default tab titles.

### Security and destructive actions

Destructive admin operations are guarded by backend checks. Production usage should pass admin-operation secret headers from authorized clients only.

## 3) Vendor workflows

### Vendor application (public form)

Applicants use `/vendor/application`:

| Field | Rule |
|-------|------|
| Phone | Myanmar format: `+959XXXXXXXXX` (12 digits) or `09XXXXXXXXX` (11 digits) |
| Store description | At least **10 characters** (max 5,000) |
| Email | Live availability check while typing (debounced; 8s timeout — submit still validated server-side) |

After approval, the vendor completes setup at `/vendor/setup` and signs in at `/vendor/login`.

### Vendor login and setup

1. Vendor signs in at `/vendor/login`.
2. If setup is incomplete, complete vendor setup flow.
3. Vendor lands in admin portal routes under `/vendor/{store-slug}/admin/*` (or vendor-host `/admin`).

**Forgot password (vendor admin):** From `/vendor/login`, use **Forgot Password?** → `/reset-password?returnTo=/admin&account=vendor`. Enter email, receive OTP via Tencent SES, set a new password. Requires function env `TENCENT_SES_*` and approved SES template (see [DEPLOYMENT.md](./DEPLOYMENT.md)).

### Vendor admin areas

- Analytics
- **Products → All Products** — select/unselect items from the **platform catalog** (read-only price, stock, status); remove from store; free-shipping toggles
- **Products → Categories** — create vendor-owned categories and assign already-selected products for storefront tabs
- Orders (includes **KBZPay draft recovery** for paid PWA checkouts with no order)
- Customers
- **Subscriptions** — Plans and Subscribers
- Finances
- Settings/branding (logo, subdomain preview, custom domain, terms/privacy, social links)

**Platform catalog:** Super admin creates all product data under **Products** / **Inventory**. Vendors do not add or edit catalog records — they use **Select Product** to pick from the pool super admin maintains. Super admin can also assign vendors on the product form or via **Vendors → profile → Products**.

### Free shipping (vendor catalog)

Available only when super admin has enabled **Free shipping feature access** for this vendor.

| Location | Control |
|----------|---------|
| **Products** | Per-product switch; **Free shipping by category** chips for bulk on/off |
| **Categories** | Per-category switch — updates all products assigned to that category |

Rules:

- Free shipping is **per vendor**, not global on the product. The same shared catalog product can differ by vendor.
- Category toggles bulk-update products; categories do not store a separate `freeShipping` field.
- **Partial** on a category means some products are on and some off — click to turn all off, then re-enable as needed.
- Products and Categories tabs stay in sync via client refresh events after toggles.

See [FREE_SHIPPING.md](./FREE_SHIPPING.md) for checkout behavior and API details.

### Finances and KBZPay withdrawal

Vendor admin → **Finances** shows revenue, commission, and **available balance** for KBZPay payout.

| Topic | Rule |
|-------|------|
| **Default commission** | **0%** unless super admin sets vendor contract (`commission`) or product-specific rate |
| **Product commission field** | Leave blank → uses vendor contract; enter a number for a product override |
| **Withdrawable orders** | `ready-to-ship`, `fulfilled`, `shipped`, or `delivered` with **collected payment** (COD only after delivery) |
| **KBZPay phone** | Saved on vendor record before withdraw; Myanmar `09…` format |
| **Session** | Vendor must be signed in (server session token); re-login once after session-auth deploy |

Operators configure KBZ Enterprise Payment / VPS relay on the backend — see [VENDOR_COMMISSION_AND_WITHDRAWAL.md](./VENDOR_COMMISSION_AND_WITHDRAWAL.md).

### Public storefront verification

Use **preview / open store** from vendor admin to verify:

- catalog visibility and category tabs (`/`, `/{category-slug}`)
- **scroll position** when opening a product and going back (same category tab)
- pricing and stock
- checkout readiness: Cash on Delivery, KBZPay QR, and KBZPay PWA
- **Seller ID:** required field at checkout — verify it appears on placed orders in vendor/admin portals
- **free shipping:** when all cart items qualify, checkout shows **FREE** delivery; delivery partner dropdown shows free label (no quoted MMK fee or duration text); mixed carts use normal logistics quotes
- storefront contact: phone menu offers native Dial and Viber chat
- **Add to Home** button (floating, above chat) — test on Android Chrome over HTTPS; verify home-screen icon uses store name/logo

Share the **vendor URL** (subdomain or custom domain), not a generic marketplace `/products` link.

Full Add to Home behavior (Android vs iOS, testing, limitations): [VENDOR_ADD_TO_HOME.md](./VENDOR_ADD_TO_HOME.md).

### Platform landing page (apex `/`)

Customers and prospects visiting the marketplace apex see:

- Platform hero, stats (active vendors, products, customers)
- **Vendor partner carousel** — active vendors with **store logos**, sorted by **total revenue** (best selling first)
- Clicking a vendor card opens their storefront: **verified custom domain** → **subdomain** → path `/vendor/:slug`
- **FloatingChat** bubble for customer support (same component as vendor storefronts) — image upload, emoji picker, guest phone prompt after first message

## 4) Role and permission notes

- Super-admin/staff roles control sidebar visibility and privileged actions — see **Staff roles** above and `src/app/utils/superAdminRolePermissions.ts`.
- **Promo Setting** is available to **data-entry** and **customer-services** (full write for customer-services; data-entry has full catalog + promo write).
- Unknown or unsupported role mappings should be corrected in user management to restore expected navigation.
- Owner-level roles are required for full finance/settings administration in most deployments.

### Promo / cart (storefront)

- **Promo Setting** admin UI manages campaigns and coupon codes.
- Storefront **cart drawer** supports coupon apply with Burmese labels (**တွန်းလှည်း** = cart title, **ကျသင့်ငွေ** = subtotal) in `my.ts`.
- Shared eligibility logic: `src/app/utils/couponEligibility.ts` (checkout + cart).
- Coupon validate API returns generic errors only — does **not** leak available code lists on invalid input.

### UI credits

- Super-admin **SideNav** footer: **Created by Aung Pyae Sone** / Software Architect.
- **Back-to-top** FAB: white background, slate text; hover inverts to black background / white icon (`BackToTop.tsx`).

## 5) Operational checks

Before release windows, confirm:

- admin login and section navigation
- vendor login and vendor-admin navigation
- vendor storefront on **subdomain** and **path-based** URLs
- category routes (e.g. `/cosmetic`) show full category catalog without requiring “Load more” on home first
- order updates sync correctly across admin/vendor/customer views
- KBZPay return lands on apex `/summary` (current: `nexa-apex.online/summary`) and Continue Shopping returns to the vendor storefront
- chat and notification flows are healthy (admin `/admin/chat` + FloatingChat emoji/image)
- **Settings → Activities** updates after vendor approve/delete and staff user changes
- **Landing page** carousel logos load; cards link to correct vendor store URL
- **Vendor application** form accepts `+959…` / `09…` phones and rejects duplicate emails
- Storefront language menu shows English/Burmese; admin language controls stay English/Chinese
- after backend deploy: run read-model validation (`docs/READ_MODEL_ROLLOUT.md`)
- **Free shipping:** super admin access toggle → vendor category bulk ON/OFF → storefront checkout with all-free cart shows 0 MMK shipping
- **Vendor withdrawal:** vendor re-login after deploy → Finances shows balance → test KBZ payout in UAT (`KPAY_BUSINESS_PAY_MOCK=1`) before production relay

## 6) Related docs

- Backend / scaling: `docs/ARCHITECTURE_AND_BACKEND.md`
- Free shipping: `docs/FREE_SHIPPING.md`
- Routing/architecture: `docs/CODE_REVIEW_AND_ROUTING.md`
- Chat: `docs/CHAT.md`
- Deployment: `docs/DEPLOYMENT.md`
- Read-model rollout: `docs/READ_MODEL_ROLLOUT.md`
- Payments: `docs/PAYMENTS.md`
- Vendor commission & withdrawal: `docs/VENDOR_COMMISSION_AND_WITHDRAWAL.md`
- Simplified non-technical instructions: `docs/NEXA_SIMPLE_UI_INSTRUCTIONS.md`
- Outdated root markdown: `docs/LEGACY_DOCS.md`
