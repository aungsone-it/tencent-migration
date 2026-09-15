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

## 2) When earnings accrue vs when they become withdrawable

Vendor net = **product line net minus platform commission**. Shipping is never included.

### Dashboard cards (Commission Earned)

Accrues when:

- Status is `processing`, `ready-to-ship`, `fulfilled`, `shipped`, or `delivered`
- `inventoryDeducted` is not `false`

**Payment does not need to be collected.** Unpaid COD that is ready-to-ship still shows on Commission Earned (e.g. product 2 MMK − 1 MMK platform commission = **1 MMK** earned).

### KBZPay withdrawal (Available to withdraw)

Uses **order status only** — payment collection is **not** required (unpaid COD in `ready-to-ship` can withdraw):

- `ready-to-ship`
- `fulfilled`
- `shipped`
- `delivered`

`processing` alone does **not** qualify for withdrawal (it may still appear on dashboard accrual cards).

`inventoryDeducted === false` does **not** block withdrawal (only dashboard accrual). Cancelled and refunded orders stay excluded.

### Subscriptions

Paid subscription payments (`subscription_payment:*` with `status: paid`) contribute **90% vendor / 10% platform** per `subscription_finance.ts`. They are **excluded** from the KBZPay commission withdraw wallet (`orderEarned` only); super-admin Finances still tracks subscription revenue separately.

---

## 3) Withdrawal flow (vendor admin)

**Location:** Vendor admin → **Finances** → **Withdraw to KBZPay**

### User steps

1. Vendor signs in at `/vendor/login` (issues a server session token — see §4).
2. Open **Finances**; available balance reflects eligible earnings minus in-flight/paid withdrawals.
3. Enter **KBZPay phone** (Myanmar `09…` format; `+959…` is accepted and normalized).
4. Click **Verify wallet** — server calls `business_pay_validate.php` and confirms the wallet can receive Business Pay transfers. On success, a short-lived verification token is issued (15 minutes).
5. Click **Withdraw now** — requires a valid verification for the same phone. The UI saves the KBZ account first if the phone changed, then requests a full available-balance payout (integer MMK). Changing the phone clears verification and requires **Verify wallet** again.

**Note:** KBZ `business_pay_validate` does **not** return the payee KYC name. There is no “look up account holder name” step — payout is phone-only.

### Server behavior

1. **Auth** — validates `x-vendor-session` matches the requested `vendorId`.
2. **Payee validation** — `POST /vendor/kpay-validate/:vendorId` calls `validateKPayBusinessPayee` → VPS `business_pay_validate.php`.
3. **Verification token** — stored at `vendor_kpay_payee_verification:{vendorId}`; consumed on each payout attempt (success or failure).
4. **Balance check** — recomputes earnings from KV (`order:`, `product:`) minus reserved withdrawals.
5. **Lock** — `vendor_withdraw_lock:{vendorId}` prevents concurrent payouts.
6. **KBZPay Enterprise Payment** — `kbz.payment.businesspay` via VPS PHP relay (`business_pay.php`, sibling of `refund.php`); `identifier_value` sent in local **`09…`** MSISDN format; merchant order id prefix `VWD-`.
7. **Status** — `paid`, `processing` (ambiguous/network/KBZ pending), or `failed` (definitive provider rejection). Failed responses include a `diagnostic` object (KBZ code, endpoint, raw response) and are logged server-side as `[vendor-withdrawal] KBZ payout failed`.
8. **Reconcile** — on wallet load, pending/processing rows older than ~45s are checked via `queryorder`; unconfirmed “paid” rows without KBZ ids are auto-failed after 48h.

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
| `POST` | `/vendor/kpay-validate/:vendorId` | `x-vendor-session` | Verify wallet via `business_pay_validate.php`; returns `verificationToken` |
| `POST` | `/vendor/commission-withdraw/:vendorId` | `x-vendor-session` | Initiate payout — requires `verificationToken` + matching `kpayPhone` |

Withdraw route is **excluded** from the global 25s function timeout so KBZPay can take up to ~45s.

---

## 6) KV keys (withdrawal)

| Key | Contents |
|-----|----------|
| `vendor_withdrawals:{vendorId}` | Array of withdrawal records (`pending` / `processing` / `paid` / `failed`) |
| `vendor_withdraw_lock:{vendorId}` | In-flight lock (prevents double payout) |
| `vendor_withdrawal_txn:{merchOrderId}` | Single withdrawal record keyed by `VWD-*` merchant order id |
| `vendor_kpay_payee_verification:{vendorId}` | Short-lived wallet verification token (15 min TTL) |
| `kpay_txn:{merchOrderId}` | KBZ query/reconcile state for the same merchant order id |

Reserved balance counts `pending`, `processing`, and confirmed `paid` rows only. Unconfirmed “paid” rows (no KBZ payment ids) are auto-failed on reconcile. Mock payouts count only when `countsAsWithdrawal: true`.

---

## 7) Environment variables

See `cloudbase/function-env.template.env` (Vendor commission withdrawal section).

| Variable | Purpose |
|----------|---------|
| `KPAY_APPID`, `KPAY_MERCH_CODE`, `KPAY_SIGN_KEY` | KBZPay credentials |
| `KBZ_VPS_API_SECRET` | Bearer secret for VPS `business_pay.php` and `business_pay_validate.php` relays |
| `KBZ_VPS_REFUND_URL` | Used to derive sibling `business_pay.php` / `business_pay_validate.php` when URLs unset |
| `KPAY_BUSINESS_PAY_URL` | Full URL to VPS **`business_pay.php`** (actual payout) — **not** validate-only |
| `KBZ_VPS_BUSINESS_PAY_VALIDATE_URL` | Optional explicit URL for **`business_pay_validate.php`** (wallet verify) |
| `KPAY_BUSINESS_PAY_MOCK=1` | UAT mock payouts — **blocked in production** |
| `VENDOR_WITHDRAW_MIN_MMK` | Minimum withdrawable balance (default `1`) |
| `ALLOW_UNAUTHENTICATED_VENDOR_WITHDRAW=1` | **Dev only** — skip session auth |

CloudBase **cannot** call KBZ `/payment/gateway/businesspay/` directly (mTLS). Use the VPS PHP relay (same pattern as `refund.php`).

**Phone format:** store and display vendor payout phones as **`09…`**. Payout payloads send `identifier_value` in local `09…` MSISDN form (KBZ Business Pay contract). `+959…` input is normalized before send.

---

## 8) Operational checks

Before enabling vendor withdrawals in production:

1. KBZ **Enterprise Payment** (`kbz.payment.businesspay`) enabled on the merchant account + VPS relay deployed (`business_pay.php` + `business_pay_validate.php`).
2. `make-server-16010b6f` redeployed with latest withdrawal + KBZ routes; frontend redeployed for Finances UI.
3. Vendor login returns `sessionToken`; Finances loads without 401.
4. **Verify wallet** succeeds for a test KBZPay number before attempting payout.
5. Test withdraw in UAT with `KPAY_BUSINESS_PAY_MOCK=1` if gateway unavailable.
6. Confirm dashboard Commission Earned includes `processing`+ (including unpaid COD), while KBZPay withdraw includes **ready-to-ship+** by order status (payment not required).
7. Confirm commission defaults to **0%** for vendors/products without admin-defined rates.

### Troubleshooting failed payouts

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Verify succeeds, withdraw fails with **EB039** / “still under review” | KBZ Enterprise Payment not fully activated for the UAT/prod merchant, or KBZ rate-limit/review | Contact KBZ to enable Business Pay; wait and retry (do not spam requests) |
| **Service not available** toast | KBZ gateway rejection (check browser Console for `[Vendor withdrawal] KBZ payout failed` → `diagnostic.providerCode`) | Inspect `diagnostic.rawResponse`; check CloudBase logs for `[vendor-withdrawal]` |
| “Verification missing or expired” | Token consumed by a prior attempt, phone changed, or >15 min elapsed | Click **Verify wallet** again, then **Withdraw now** |
| Balance shows 0 but Commission Earned > 0 | Orders still in `processing`, or balance reserved by failed/processing withdrawal | Check withdrawal history; failed rows release balance |
| KYC name mismatch (legacy) | Old deployments sent store name as payee | Current code sends phone only — redeploy backend |

Browser Console logs the full failed payout object after each attempt. CloudBase function logs include the same `diagnostic` JSON.

---

## 9) Related docs

| Doc | Topic |
|-----|-------|
| [PAYMENTS.md](./PAYMENTS.md) | Customer KBZPay checkout, webhooks, PWA drafts |
| [ARCHITECTURE_AND_BACKEND.md](./ARCHITECTURE_AND_BACKEND.md) | KV model, auth overview, API surface |
| [NEXA_ADMIN_AND_VENDOR_GUIDE.md](./NEXA_ADMIN_AND_VENDOR_GUIDE.md) | Vendor admin operator workflows |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Function deploy checklist |
