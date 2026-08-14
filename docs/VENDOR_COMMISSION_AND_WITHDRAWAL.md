# Vendor Commission and KBZPay Withdrawal

Canonical reference for **platform commission rates**, **vendor earnings**, and **commission withdrawal to KBZPay wallets**.

Implementation:

- Server: `supabase/functions/make-server-16010b6f/vendor_commission_withdraw.tsx`
- Session guard: `supabase/functions/make-server-16010b6f/vendor_session_guard.tsx`
- KBZPay payout: `supabase/functions/make-server-16010b6f/kpay_routes.tsx` (`invokeKPayBusinessPay`)
- Vendor UI: `src/app/components/vendor-admin/VendorAdminFinances.tsx`
- Shared client math: `src/app/utils/vendorCommissionEarned.ts`

---

## 1) Commission rate model

### Platform default: **0%**

Unless an admin explicitly sets a rate, the platform takes **no commission**:

| Level | Where set | Default when unset |
|-------|-----------|-------------------|
| **Vendor contract** | Super admin → Vendor form (`commission` field) | **0%** |
| **Product** | Product add/edit forms (`commissionRate` field) | **No product-specific rate** (field omitted from KV) |
| **Order line** | Snapshot on checkout when present | Uses product / vendor rules below |

There is **no hidden 15% fallback** in withdrawal or finances code paths.

### Resolution order (per order line)

When calculating platform commission and vendor net payout:

1. **Line snapshot** — `commissionRate` stored on the order item at checkout (if present)
2. **Product rate** — only when admin **explicitly** set `commissionRate` on that product in KV
3. **Vendor contract** — `vendor.commission` when set on the vendor record
4. **Platform default** — **0%**

**Product form rule:** Leave the commission field **blank** to inherit the vendor contract (then 0% if the contract is also unset). Enter `0` to explicitly lock a product at 0%. Enter e.g. `15` for a product-specific override.

**Examples**

| Vendor contract | Product rate | Effective % on that line |
|-----------------|--------------|--------------------------|
| unset | unset | **0%** |
| 10% | unset | **10%** |
| unset | 15% | **15%** |
| 10% | 5% | **5%** (product wins) |
| 0% (explicit) | unset | **0%** |

---

## 2) When earnings become withdrawable

Vendor net earnings (order total minus platform commission) accrue only when **all** of the following are true:

### Order fulfillment status

Must be one of:

- `ready-to-ship`
- `fulfilled`
- `shipped`
- `delivered`

`processing` alone does **not** qualify for withdrawal (it may still appear on dashboard accrual cards).

### Inventory commit

- `inventoryDeducted === false` blocks accrual (stock not committed at ready-to-ship/fulfilled).

### Payment collected

| Payment method | Rule |
|----------------|------|
| **COD** | Delivered or fulfilled status, **or** `paymentStatus: paid` |
| **KBZPay** | `paymentStatus: paid` **or** `kpay.status: paid` |
| **Card / bank / other** | `paymentStatus: paid` (not `unpaid`, `pending`, `pending_verification`) |

**Excluded:** cancelled orders, refunded orders, `pending_refund`, successful KPay refunds.

### Subscriptions

Paid subscription payments (`subscription_payment:*` with `status: paid`) contribute **90% vendor / 10% platform** per `subscription_finance.ts`, included in the withdrawable wallet total.

---

## 3) Withdrawal flow (vendor admin)

**Location:** Vendor admin → **Finances** → **Withdraw to KBZPay**

### User steps

1. Vendor signs in at `/vendor/login` (issues a server session token — see §4).
2. Open **Finances**; available balance reflects eligible earnings minus in-flight/paid withdrawals.
3. Enter or confirm **KBZPay phone** (Myanmar `09…` format).
4. Click **Withdraw now** — the UI saves the KBZ account first if the phone changed, then requests a full available-balance payout (integer MMK).

### Server behavior

1. **Auth** — validates `x-vendor-session` matches the requested `vendorId`.
2. **Balance check** — recomputes earnings from KV (`order:`, `product:`, `subscription_payment:`) minus reserved withdrawals.
3. **Lock** — `vendor_withdraw_lock:{vendorId}` prevents concurrent payouts.
4. **KBZPay Enterprise Payment** — `kbz.payment.businesspay` via VPS PHP relay (`businesspay.php`) or configured gateway; merchant order id prefix `VWD-`.
5. **Status** — `paid`, `processing` (ambiguous/network/KBZ pending), or `failed` (definitive provider rejection).
6. **Reconcile** — on wallet load, pending/processing rows older than ~45s are checked via `queryorder` and updated.

Fractional MMK earnings carry forward; only **whole MMK** amounts are sent (`floor` of available balance).

Minimum payout: `VENDOR_WITHDRAW_MIN_MMK` (default **1** MMK).

---

## 4) Vendor session authentication

Withdrawal routes require a **server-issued session token**, not just the CloudBase publishable key.

| Event | Behavior |
|-------|----------|
| **Login** | `POST /vendor-auth/login` returns `sessionToken`; client stores in `localStorage` (`vendorSessionToken`) |
| **API calls** | Client sends header `x-vendor-session: {token}` on wallet, kpay-account, and withdraw routes |
| **Logout** | `POST /vendor-auth/logout` revokes KV session; client clears token |

KV keys:

- `vendor_session:{token}` — `{ vendorId, email, expiresAt }` (30-day TTL)
- `vendor_session_active:{vendorId}` — current token for that vendor

**After deploying session auth:** vendors with an old browser session must **sign out and sign in again** once to obtain a token.

**Local dev only:** `ALLOW_UNAUTHENTICATED_VENDOR_WITHDRAW=1` on the function bypasses session checks. **Never enable in production.**

---

## 5) API routes

Base: `{CLOUDBASE_API_BASE_URL}` (ends with `/make-server-16010b6f`).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/vendor/commission-wallet/:vendorId` | `x-vendor-session` | Balances, history, reconcile processing rows |
| `PUT` / `POST` | `/vendor/kpay-account/:vendorId` | `x-vendor-session` | Save KBZPay payout phone on vendor record |
| `POST` | `/vendor/commission-withdraw/:vendorId` | `x-vendor-session` | Initiate payout (uses saved phone; body phone must match if both sent) |

Withdraw route is **excluded** from the global 25s function timeout so KBZPay can take up to ~45s.

---

## 6) KV keys (withdrawal)

| Key | Contents |
|-----|----------|
| `vendor_withdrawals:{vendorId}` | Array of withdrawal records (`pending` / `processing` / `paid` / `failed`) |
| `vendor_withdraw_lock:{vendorId}` | In-flight lock (prevents double payout) |
| `vendor_withdrawal_txn:{merchOrderId}` | Single withdrawal record keyed by `VWD-*` merchant order id |
| `kpay_txn:{merchOrderId}` | KBZ query/reconcile state for the same merchant order id |

Reserved balance includes rows in `pending`, `processing`, or `paid` (mock payouts only count when `countsAsWithdrawal: true`).

---

## 7) Environment variables

See `cloudbase/function-env.template.env` (Vendor commission withdrawal section).

| Variable | Purpose |
|----------|---------|
| `KPAY_APPID`, `KPAY_MERCH_CODE`, `KPAY_SIGN_KEY` | KBZPay credentials |
| `KBZ_VPS_API_SECRET` | Bearer secret for VPS `businesspay.php` relay |
| `KBZ_VPS_REFUND_URL` | Used to derive `businesspay.php` path when business pay URL unset |
| `KPAY_BUSINESS_PAY_URL` | Full URL to VPS `businesspay.php` relay (recommended for CloudBase) |
| `KPAY_BUSINESS_PAY_MOCK=1` | UAT mock payouts — **blocked in production** |
| `VENDOR_WITHDRAW_MIN_MMK` | Minimum withdrawable balance (default `1`) |
| `ALLOW_UNAUTHENTICATED_VENDOR_WITHDRAW=1` | **Dev only** — skip session auth |

CloudBase **cannot** call KBZ `/payment/gateway/businesspay/` directly (mTLS). Use the VPS PHP relay (same pattern as `refund.php`).

---

## 8) Operational checks

Before enabling vendor withdrawals in production:

1. KBZ **Enterprise Payment** enabled on the merchant account + VPS relay deployed.
2. `make-server-16010b6f` redeployed with latest `vendor_commission_withdraw.tsx` and `vendor_session_guard.tsx`.
3. Vendor login returns `sessionToken`; Finances loads without 401.
4. Test withdraw in UAT with `KPAY_BUSINESS_PAY_MOCK=1` if gateway unavailable.
5. Confirm earnings only include **paid/collected** orders in **ready-to-ship+** statuses.
6. Confirm commission defaults to **0%** for vendors/products without admin-defined rates.

---

## 9) Related docs

| Doc | Topic |
|-----|-------|
| [PAYMENTS.md](./PAYMENTS.md) | Customer KBZPay checkout, webhooks, PWA drafts |
| [ARCHITECTURE_AND_BACKEND.md](./ARCHITECTURE_AND_BACKEND.md) | KV model, auth overview, API surface |
| [NEXA_ADMIN_AND_VENDOR_GUIDE.md](./NEXA_ADMIN_AND_VENDOR_GUIDE.md) | Vendor admin operator workflows |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Function deploy checklist |
