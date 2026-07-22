# NEXA Platform — Simple UI Instructions

This version is intentionally short and non-technical.

**Full step-by-step guide:** [CLIENT_INSTRUCTIONS.md](./CLIENT_INSTRUCTIONS.md) · [CLIENT_INSTRUCTIONS.html](./CLIENT_INSTRUCTIONS.html)  
**Quick reference (admin & vendor):** [NEXA_SIMPLE_UI_INSTRUCTIONS.html](./NEXA_SIMPLE_UI_INSTRUCTIONS.html)  
**Detailed operator workflows:** [NEXA_ADMIN_AND_VENDOR_GUIDE.md](./NEXA_ADMIN_AND_VENDOR_GUIDE.md)

**Note:** There is no shared marketplace product catalog. Each vendor has their own storefront URL.

## Super Admin

1. Open `https://www.nexa-mm.com/admin`.
2. Sign in with your staff account.
3. Use the left menu for Products, Orders, Vendors, Customers, Marketing, Chat, and Settings.
4. If you cannot see a section, your role likely does not have permission — see **Admin user roles** below.

### Settings

- **General** — platform name, logo, support contact
- **Users** — add/edit staff (**Store Owner only**)
- **Activities** — see who did what across the whole platform (approvals, deletes, user changes)

There is no separate **Appearance** tab; branding is under **General**.

### Admin user roles

Platform staff at `https://www.nexa-mm.com/admin` have one of **four roles**. The role controls which menu items appear.

| Role | Access summary |
|------|----------------|
| **Store Owner** | Full access — all menus including **Finances** and **Settings → Users**. Can manage all staff roles. |
| **Administrator** | Operations — products, orders, vendors, customers, chat, logistics, settings (General + Activities). **No Finances.** No **Settings → Users**. |
| **Data Entry** | Catalog only — Home, Product (products/categories/inventory), Chat, limited Settings (General). |
| **Warehouse** | Fulfillment — Home, Orders, Inventory, Logistics. No products, vendors, finances, settings, or global search. |

**Who can add staff:** only **Store Owner** (Settings → Users). To fix a missing menu item, ask the Store Owner to check your role there.

### Vendors

- New sellers apply at `https://www.nexa-mm.com/vendor/application`; you approve them with **Vendor → Review applications**.
- There is **no “Add vendor” button** — all vendors come through the application flow.
- Deleting a vendor from the list does **not** remove past actions from **Settings → Activities** (that is an audit log).

## Vendor

1. Open `https://www.nexa-mm.com/vendor/login`.
2. Sign in with your vendor account.
3. Manage your store in the vendor admin:
   - `https://yourstore.nexa-mm.com/admin`, or
   - `https://www.nexa-mm.com/vendor/your-store-slug/admin` (path-based)
4. Your **customer-facing shop** is at your subdomain or custom domain (e.g. `https://gogo.nexa-apex.online/` or `https://migoo.nexa-mm.com/`), not at `https://www.nexa-mm.com/products`.
5. Use preview/open-store in admin to verify catalog, categories, checkout, and **scroll restore** (open a product, go back — you should return to the same place in the list).

### Applying to sell

At `https://www.nexa-mm.com/vendor/application`:

- Phone: use `+959…` or `09…` (Myanmar mobile format)
- Store description: at least 10 characters
- Email: wait for “Email is available” before submitting

## Customers

- Shop at a **vendor’s store URL** (subdomain or custom domain), not on a central marketplace catalog.
- On the **platform homepage** (`https://www.nexa-mm.com/`), click a vendor logo in the carousel to open that shop (best-selling vendors appear first).
- Use the **chat bubble** (bottom-right) on the homepage or any vendor store for support.
- Use the store phone contact to choose **Dial** or **Viber**. On desktop the choice appears on hover; on mobile both buttons are shown in the menu.
- Tap **Add to Home** (above the chat bubble) to save a vendor store shortcut on your phone. On Android Chrome you may get an install prompt; on iPhone use Safari → Share → Add to Home Screen.
- Checkout supports **Cash on Delivery** and **KBZPay**. After KBZPay app payment, order summary may open on the platform apex `/summary` (e.g. `https://nexa-apex.online/summary`); use Continue Shopping to return to the vendor store.
- **Forgot password:** customers and vendors use the reset page — enter email, OTP code from email, new password. Vendors: **Forgot Password?** on `/vendor/login`.

## Quick troubleshooting

- Blank page on refresh: report host/deep-link issue (SPA fallback).
- Category page empty but products exist: hard refresh; if it persists, report a catalog filter issue.
- Missing menu items: ask admin to confirm your role.
- Login issues: use **Forgot password** (OTP email) or contact your system admin.
- Vendor application “Checking email…” stuck: refresh and try again; server validates again on submit.
- Activity missing after approve: ensure you were logged in as staff (actions need your user account).
