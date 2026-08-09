# Free Shipping Feature

Per-vendor free shipping for the NEXA multi-tenant storefront. A vendor marks selected products as free shipping; checkout delivery fees become **0 MMK** when the cart contains **only** those products for that vendor.

**Important:** Free shipping is **vendor-scoped**, not global on the product. The same catalog product can be free shipping at Vendor A and paid shipping at Vendor B.

---

## 1) Roles and access

| Role | What they control |
|------|-------------------|
| **Super admin** | Enables or disables **free shipping feature access** per vendor (`vendor.freeShippingEnabled`). Without this, the vendor cannot see toggles in their admin portal. |
| **Vendor admin** | Marks individual products or whole categories as free shipping (only for their store). |
| **Customer** | Sees shipping as **FREE** at checkout when every line item in the cart qualifies. |

Super admin UI: **Vendors → Edit/Add vendor → Free shipping feature access** (`VendorForm.tsx`, `VendorAddEdit.tsx`). Vendor profile shows how many products are marked free shipping.

---

## 2) Data model (KV)

No SQL migration. Flags live on existing KV records.

### Vendor record (`vendor:{id}`)

```json
{
  "freeShippingEnabled": true
}
```

Set by super admin. Gates whether the vendor portal shows free-shipping controls.

### Product record (`product:{id}`)

```json
{
  "vendorFreeShipping": {
    "vendor_uuid_here": true
  }
}
```

- Map key = **canonical vendor id** (or legacy alias keys — see §5).
- Value `true` = free shipping for that vendor’s storefront.
- Absent key or deleted key = paid shipping (normal logistics quote applies).
- **Categories do not store** a `freeShipping` field. Category toggles bulk-update `productIds` on the category document.

### Cart / checkout line items (client)

Each line carries a derived boolean `freeShipping` when added from the storefront catalog (`VendorStoreView` → `CartContext`).

---

## 3) Business rules

### When shipping is free (0 MMK)

All of the following must be true:

1. Vendor has `freeShippingEnabled === true` (super admin).
2. **Every** item in the checkout cart has `freeShipping === true` for that vendor.
3. Customer completed region + township (address still required).

If **any** cart line is not free shipping, normal delivery partner selection and quoted fees apply.

### Category vs product toggles

| UI location | Scope |
|-------------|--------|
| **Vendor admin → Products** | Per-product switch + **Free shipping by category** chips (bulk) |
| **Vendor admin → Categories** | Per-category switch (bulk for all `productIds` on that category) |

Turning a category **ON** sets free shipping for all assigned products. Turning **OFF** clears free shipping for all assigned products (all vendor alias keys — see backend helpers).

**Partial state:** If some products in a category are free and others are not, the category switch shows **Partial**. Clicking the switch while partial turns **all off** (recovery path for stuck sync).

### Vendor isolation

Toggles only affect `vendorFreeShipping[yourVendorId]`. Other vendors’ flags on the same shared product are unchanged.

---

## 4) Checkout behavior (`Checkout.tsx`)

| Cart contents | Delivery method select | Shipping line | Payment unlock |
|---------------|------------------------|---------------|----------------|
| All items free shipping | **Disabled** (grayed out), shows FREE label | **FREE** / အခမဲ့ | After region + township |
| Mixed or none free | Enabled (when multiple carriers) | Quoted fee from logistics | After region + township + carrier |

Server validates on order create: `shippingFee === 0` is rejected unless every line item resolves as free shipping for that vendor in KV (not trusting client flags alone).

---

## 5) Backend API

Routes are relative to `{CLOUDBASE_API_BASE_URL}` / `{VITE_CLOUDBASE_API_BASE_URL}`, which **already ends with** `/make-server-16010b6f` (do not prepend the function name again).

| Method | Route | Purpose |
|--------|-------|---------|
| `PUT` | `/products/:id` | Patch `{ vendorFreeShipping: { [vendorId]: true \| false } }` |
| `POST` | `/vendor/categories/:categoryId/bulk-free-shipping` | Body: `{ vendorId, enabled: boolean }` — bulk update all category `productIds` |
| `GET` | `/vendor/categories-details/:vendorId` | Categories include `freeShippingEnabledCount`, `freeShippingTotalCount` |
| `GET` | `/vendor/products-admin/:vendorId` | Products include derived `freeShipping` boolean |
| `GET` | `/vendor-auth/profile/:vendorId` | Returns `user.freeShippingEnabled` for vendor portal gating |

**Helpers** (in `index.tsx`):

- `vendorHasFreeShippingAccess(vendor)`
- `resolveProductFreeShippingForVendor(product, vendorId, access, vendorTokens?)`
- `stripAllVendorFreeShippingKeys` / `setVendorFreeShippingEnabled` — normalize alias keys on write
- Order create: validates zero shipping against product KV when `claimedShipping === 0`

**Frontend utilities:** `src/app/utils/freeShipping.ts` (+ unit tests in `freeShipping.test.ts`).

**Client cache event:** `VENDOR_FREE_SHIPPING_CHANGED_EVENT` (`notifyVendorFreeShippingChanged`) — Products and Categories tabs refresh when either side toggles flags.

---

## 6) Vendor admin UI map

| File | Feature |
|------|---------|
| `VendorAdminProductsCRUD.tsx` | Product table **Free shipping** column; category bulk chips |
| `VendorAdminCategories.tsx` | Category table **Free shipping** column |
| `VendorAdminAddProduct.tsx` | Free shipping checkbox on create/edit (when access granted) |
| `VendorProfile.tsx` / `Vendor.tsx` | Super admin view of vendor free-shipping access and product counts |

Translations: `products.freeShipping*`, `categories.freeShipping*`, `vendor.freeShipping*` in `en.ts` / `zh.ts` (storefront Burmese checkout strings in `my.ts`).

Activity timeline (when configured): vendor free-shipping access toggles; product free-shipping enabled/disabled — see `staffActivityLabels.ts`.

---

## 7) Deploy and test checklist

1. **Deploy backend** after API changes: `npm run deploy:functions` (or upload `make-server-16010b6f.zip`).
2. **Deploy frontend:** `npm run build` → EdgeOne `dist/`.
3. Super admin: enable **Free shipping feature access** on the test vendor.
4. Vendor admin → **Categories → Bags**: toggle ON → both products show free shipping on **Products** tab.
5. Toggle OFF → both products OFF; category switch not **Partial**.
6. Storefront: add only free-shipping items → checkout shows FREE shipping, delivery method grayed out.
7. Add one non-free item → delivery method active, quoted fee applies.
8. Place order with 0 shipping — server accepts only when all items qualify in KV.

---

## 8) Related docs

| Doc | Topic |
|-----|-------|
| [NEXA_ADMIN_AND_VENDOR_GUIDE.md](./NEXA_ADMIN_AND_VENDOR_GUIDE.md) | Operator workflows |
| [ARCHITECTURE_AND_BACKEND.md](./ARCHITECTURE_AND_BACKEND.md) | KV model overview |
| [CLIENT_INSTRUCTIONS.md](./CLIENT_INSTRUCTIONS.md) | End-user checkout notes |
| [PAYMENTS.md](./PAYMENTS.md) | KBZPay + COD (shipping fee in order total) |
