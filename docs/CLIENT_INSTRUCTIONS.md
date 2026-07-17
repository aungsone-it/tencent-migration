# NEXA Platform — Client Instructions

**Document type:** User manual  
**Audience:** Customers, vendors, and platform staff  
**Language:** Plain English — no technical knowledge required

---

## Table of contents

1. [Overview](#1-overview)
2. [Customer guide](#2-customer-guide)
3. [Vendor guide](#3-vendor-guide)
4. [Super admin guide](#4-super-admin-guide)
5. [Reference](#5-reference)

---

## 1. Overview

### 1.1 What is NEXA?

NEXA Platform is an online shopping system where **each store has its own website**.

- One **main website** (`https://www.nexa-mm.com/`) helps people find stores and run the platform.
- Each **vendor (seller)** has a **separate shop link** — like an independent mini-store.
- Customers shop **one store at a time**. There is no single mixed marketplace catalog.

### 1.2 User roles

| Role | Responsibility |
|------|----------------|
| **Customer** | Browse products, manage cart, checkout, track orders |
| **Vendor** | Manage one store — products, orders, branding, settings |
| **Super Admin** | Manage the whole platform — vendors, orders, staff, settings |

### 1.3 Where customers shop

Customers **do not** shop from a product list on the main homepage.

The main site shows platform information, a **vendor logo carousel** (click to open a store), and links to apply or sign in.

**To buy something:**

1. Open a vendor’s store link (e.g. `https://gogo.nexa-mm.com/` or a custom domain), **or**
2. Click a vendor logo on the main homepage carousel.

Each store sells **only its own products**.

---

## 2. Customer guide

### 2.1 Opening a store

| Method | Example |
|--------|---------|
| Vendor subdomain | `https://gogo.nexa-mm.com/` |
| Custom domain | `https://yourstore.com/` |
| Main site carousel | Click a vendor logo on the homepage |

On the store you can browse products, search, switch **English / Burmese**, contact the store (**Dial** or **Viber**), and use the **chat bubble** (bottom-right).

### 2.2 Browsing and searching

**Home page**

- Products appear with an optional banner at the top.
- Use **category tabs** to filter by category.
- Scroll or tap **Load more** when the store has many products.

**Product page**

- View photos, price, description, and stock.
- Adjust quantity, then **Add to Cart** or save to **Saved / Wishlist** (heart icon).

**Search**

- Type in the search box; results update as you type.

If a category looks empty, refresh the page or switch tabs and return.

### 2.3 Cart and saved items

**Cart**

- Open the cart icon to review items and quantities.
- **Guest:** cart stays on this device only.
- **Signed in:** cart syncs across your devices.

**Saved / Wishlist**

- Tap the heart on a product to save it.
- Open **Saved** from the menu to view all saved items.
- Sign in to keep saved items on your account.

### 2.4 Account and profile

**Benefits of signing in**

- Order history and tracking
- Saved addresses
- Synced cart and wishlist across devices

**Sign in or register**

- Open **Profile** or **Account** from the store menu.
- Use **Forgot password** if needed; check your email for reset instructions.

Guest checkout may be available, but signed-in accounts are easier to track later.

### 2.5 Checkout

1. Open **Cart** → **Checkout**.
2. Enter or select **shipping address** and phone number.
3. Choose **Cash on Delivery (COD)** or **KBZPay**.
4. Review items and total.
5. Tap **Place Order** or **Pay with KBZPay**.

Before paying, confirm address, phone, items, and quantities. Review **Terms** and **Privacy** in the menu if needed.

### 2.6 Cash on Delivery

1. Choose **Cash on Delivery** at checkout.
2. The order is created immediately.
3. Save your **order number** and track status under **Profile → Orders** (when signed in).
4. Pay the delivery person in cash when the order arrives.

Typical statuses: Pending → Processing → Shipped / Fulfilled → Delivered (wording may vary).

### 2.7 KBZPay

1. Choose **KBZPay** at checkout.
2. Scan the **QR code** or open the **KBZPay app**.
3. Complete payment in KBZPay.
4. You may land on `https://www.nexa-mm.com/summary` — tap **Continue Shopping** to return to the store.

Keep the browser open until payment finishes. If unsure whether payment went through, check **Profile → Orders** before paying again.

If payment succeeded but no order appears, contact the store with your receipt. Platform staff can recover some orders from the admin panel.

### 2.8 Order history

Under **Profile**:

- **Orders** — view and open order details
- **Addresses** — save delivery addresses
- **Account** — name, email, password

Order details include order number, items, shipping address, payment method, and current status.

### 2.9 Contact and support

**On vendor stores**

- **Chat bubble** — message support
- **Phone** — **Dial** or **Viber** (desktop: hover the phone icon; mobile: both in menu)

**When contacting support, provide**

- Order number (if available)
- Store name
- Payment screenshot (for KBZPay issues)

### 2.10 Add store to home screen

**Android (Chrome):** Open the store → tap **Add to Home** (above chat) → confirm install.

**iPhone (Safari):** Open in Safari → **Share** → **Add to Home Screen** → **Add**.

On iPhone, Safari is required. Facebook or Instagram in-app browsers may not support this.

### 2.11 Language

Storefronts support **English** and **Burmese** via the language menu. Admin dashboards use English and Chinese and do not change the customer storefront language.

---

## 3. Vendor guide

### 3.1 Getting started

1. Apply at `https://www.nexa-mm.com/vendor/application`.
2. Wait for super admin approval.
3. Complete setup and sign in at `https://www.nexa-mm.com/vendor/login`.
4. Open **vendor admin** to add products and configure your store.

| URL | Purpose |
|-----|---------|
| `https://yourstore.nexa-mm.com/` | Customer-facing shop |
| `https://yourstore.nexa-mm.com/admin` | Your management dashboard |

New stores always come through the application form. There is no manual “Add vendor” button for applicants.

### 3.2 Application form

| Field | Requirement |
|-------|-------------|
| Phone | Myanmar format: `+959…` or `09…` |
| Email | Wait for **Email is available** before submitting |
| Store description | At least 10 characters |
| Store name | Name shown to customers |

If “Checking email…” does not finish, refresh and try again.

### 3.3 Admin dashboard

| Section | Purpose |
|---------|---------|
| Dashboard / Analytics | Sales overview |
| Products | Add, edit, price, and stock products |
| Categories | Organize category tabs on your shop |
| Orders | View and update order status |
| Customers | Buyers linked to your store |
| Finances | Revenue views (role-dependent) |
| Settings | Logo, banner, contact, terms, social links |

Use **Preview / Open store** before sharing your link. Test checkout when possible.

### 3.4 Products

**To add a product**

1. Go to **Products** → **Add product**.
2. Enter name, price, description, category, and stock.
3. Upload photos (large files are compressed automatically).
4. Save.

Keep stock accurate, assign categories, and use clear photos and prices.

### 3.5 Orders

**Daily routine**

1. Open **Orders** and check new / pending items first.
2. Confirm items, address, and payment method.
3. Update status: Pending → Processing → Shipped / Fulfilled (or Cancelled).

- **COD:** order exists immediately — prepare and collect cash on delivery.
- **KBZPay:** verify payment before shipping. Contact platform admin if you see a KBZPay drafts warning.

### 3.6 Settings and branding

Configure under **Settings**:

- Store name, logo, banner
- Phone and email for customers
- Subdomain and optional custom domain
- Terms and privacy pages
- Social links

For best home-screen icons, use a square logo at least 192×192 pixels.

### 3.7 Sharing your store

Share your vendor URL or custom domain — not `https://www.nexa-mm.com/products`.

Customers may also find you on the homepage vendor carousel when your store is active.

---

## 4. Super admin guide

### 4.1 Access

1. Open `https://www.nexa-mm.com/admin`.
2. Sign in with your staff account.
3. Use the left menu to navigate.

If menu items are missing, your role may be restricted — see [Admin user roles](#42-admin-user-roles) below.

### 4.2 Admin user roles

Platform staff have one of **four roles**. Your role controls which left-menu items you see.

| Role | What you can access |
|------|---------------------|
| **Store Owner** | **Full access** — all menus including **Finances** and **Settings → Users**. Can assign any staff role. Cannot be deleted or deactivated. |
| **Administrator** | Day-to-day ops — products, orders, vendors, customers, chat, logistics, settings (General + Activities). **No Finances.** No **Settings → Users**. |
| **Data Entry** | Catalog work — Home, Product (products/categories/inventory), Chat, limited Settings (General). No orders, vendors, customers, or finances. |
| **Warehouse** | Fulfillment — Home, Orders, Inventory, Logistics. No products, vendors, finances, settings, or global search. |

**Who can add staff:** only **Store Owner** via **Settings → Users**. Other roles cannot open that tab.

**Quick check:** missing **Finances** → you are not Store Owner. Missing **Product** → likely **Warehouse** role. Missing **Orders** → likely **Data Entry** role.

### 4.3 Daily workflow

1. Review **Orders** (pending badge on sidebar).
2. Check the **KBZPay drafts** panel for paid orders that need recovery.
3. Process **Vendor → Review applications**.
4. Manage catalog, customers, chat, and finances as needed.
5. Review **Settings → Activities** for the audit log.

Stay signed in as yourself when approving vendors — actions are recorded under your account.

### 4.4 Settings

| Tab | Purpose |
|-----|---------|
| **General** | Platform name, logo, support contact |
| **Users** | Staff accounts (owner only) |
| **Activities** | Platform-wide audit timeline |

Branding lives under **General** (there is no separate Appearance tab). Vendor deletion removes the vendor from the list but keeps history in Activities.

### 4.5 Orders and KBZPay recovery

- Use the orders list to search, filter, and update status.
- If a customer paid via KBZPay but no order exists, use **Recover order** in the amber drafts panel.
- Prefer status changes and cancellation over casual deletion.
- Do not share admin passwords with vendors.

---

## 5. Reference

### 5.1 Quick URLs

Platform URL: **https://www.nexa-mm.com/**

| Purpose | URL |
|---------|-----|
| Main site | `https://www.nexa-mm.com/` |
| Super admin | `https://www.nexa-mm.com/admin` |
| Apply to sell | `https://www.nexa-mm.com/vendor/application` |
| Vendor login | `https://www.nexa-mm.com/vendor/login` |
| Example shop | `https://gogo.nexa-mm.com/` |
| Example vendor admin | `https://gogo.nexa-mm.com/admin` |
| After KBZPay payment | `https://www.nexa-mm.com/summary` |

### 5.2 Do’s and don’ts

**Do**

- Use the correct URL for your role.
- Keep checkout contact details accurate.
- Sign in for order history and synced cart.
- Update order status promptly (vendors and admin).
- Include order numbers when contacting support.

**Don’t**

- Expect one combined catalog on the main site.
- Pay twice on KBZPay without checking orders first.
- Share staff login credentials.
- Submit vendor applications before email shows as available.

### 5.3 Troubleshooting

| Problem | What to try |
|---------|-------------|
| Blank page after refresh | Retry the link; use Chrome or Safari |
| Empty category | Hard refresh; switch category tabs |
| Cannot log in | Password reset; verify email spelling |
| KBZPay paid, no order | Wait 1–2 minutes; check Profile → Orders; contact store |
| Cart empty after sign-in | Re-add items (guest cart may not merge) |
| Email check stuck on application | Refresh; submit only after “Email is available” |
| Missing admin menu | Owner checks role in Settings → Users |
| Add to Home fails on iPhone | Use Safari → Share → Add to Home Screen |

### 5.4 Summary

| Role | Flow |
|------|------|
| **Customer** | Store link → browse → cart → checkout → profile |
| **Vendor** | Apply → approved → admin → products & orders → share store URL |
| **Super Admin** | `https://www.nexa-mm.com/admin` → orders, applications, settings, audit |

Each store is independent. The main site connects people to stores — it is not one combined shopping catalog.

---

*Related: [NEXA_SIMPLE_UI_INSTRUCTIONS.md](./NEXA_SIMPLE_UI_INSTRUCTIONS.md) (quick reference) · [NEXA_ADMIN_AND_VENDOR_GUIDE.md](./NEXA_ADMIN_AND_VENDOR_GUIDE.md) (operator detail)*
