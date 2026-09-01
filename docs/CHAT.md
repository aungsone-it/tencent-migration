# Chat System

Customer support chat on **vendor storefronts** and the **platform apex**, plus the **super-admin Chat** inbox. Messages are stored in TencentDB KV (`chat:*` keys) via the `make-server-16010b6f` API.

For routing and where the bubble appears, see [CODE_REVIEW_AND_ROUTING.md](./CODE_REVIEW_AND_ROUTING.md).

---

## 1) Two surfaces

| Surface | Component | Who uses it |
|---------|-----------|-------------|
| **Floating chat widget** | `FloatingChat.tsx` (lazy-loaded from `RootLayout.tsx`) | Guests and signed-in customers on vendor storefronts and apex landing |
| **Admin inbox** | `Chat.tsx` at `/admin/chat` | Super-admin staff |

Both share the same backend chat API (`chatApi` in `src/utils/api.ts`) and Realtime broadcasts (`chatRealtime.ts`).

---

## 2) FloatingChat (customer widget)

### Where it shows

- Vendor storefront hosts (subdomain, custom domain, path-based `/vendor/:slug`)
- Platform apex landing page (`LandingPage`)
- **Hidden on:** super-admin portal, vendor-admin portal, `/vendor/application`, `/vendor/login`, `/reset-password`, and when `LoadingContext.suppressFloatingChat` is set (e.g. storefront skeleton)

### Branding

Header title: `{StoreName} Support` on vendor hosts, `SECURE Support` on apex. Vendor display name comes from `MIGOO_VENDOR_STOREFRONT_BRANDING_EVENT` / `readVendorStorefrontDisplayName`.

### Guest identity

Guests get a stable browser id (`getOrCreateGuestChatId()` in `guestChatIdentity.ts`) and synthetic email `guest-{id}@guest.migoo.store`. Display names use allocated guest codes (e.g. `#003346`) shown in the admin inbox.

Signed-in customers use their profile name, email, and avatar.

### Phone collection (guests)

When a **guest** sends their **first successful message**, a modal asks for a Myanmar phone number (`+959…` or `09…`):

- Trigger: `guestNeedsPhoneCollection()` returns true after the first message is accepted by the server
- Saved locally in `localStorage` (`guestChatSession`) and sent on subsequent messages as `customerPhone`
- Optional — user can dismiss with **Maybe later**; modal may appear again until a valid phone is saved
- Does **not** block sending the first message

### Composer features

| Control | Behavior |
|---------|----------|
| **Text** | Multiline input; Enter sends, Shift+Enter newline |
| **Image upload** | Compresses client-side (~500KB target), uploads via `chatApi.uploadImage`, attaches URL to message |
| **Emoji** | Smile icon **beside** image upload; lazy-loaded `emoji-picker-react` via `EmojiPickerLazy.tsx` |
| **Send** | Purple gradient button |

Emoji picker uses **`EmojiStyle.NATIVE`** (Unicode / OS emoji font) — no paid asset pack. Selecting an emoji inserts at the cursor.

### Caching

Recent messages are cached in `localStorage` per vendor + customer email (`chatLocalCache.ts`) for fast reopen. Server merge wins on poll/realtime.

---

## 3) Admin Chat (`/admin/chat`)

Super-admin inbox for all customer conversations.

### Features

- Conversation list with search, sort (newest/oldest/starred), unread badges
- Guest conversations show allocated display codes and phone when collected
- Star / delete conversation (delete removes KV thread)
- Reply composer: image upload + emoji picker (same `EmojiPickerLazy` as FloatingChat)
- Realtime via `subscribeAdminInbox` + conversation broadcast channels

### Toolbar

Bulk **Delete** on the Orders page is hidden (`SHOW_ORDERS_DELETE_BUTTON = false`). Chat conversation delete remains available per thread.

---

## 4) Data model (KV)

| Key pattern | Purpose |
|-------------|---------|
| `chat:message:{id}` | Individual message documents |
| `chat:conversation:{id}` | Conversation metadata (customer, vendor, last message, unread) |

Historical Supabase `chat:*` rows were **not** imported during TencentDB migration — TCB KV starts empty until customers message again. See [migration.md](../migration.md).

---

## 5) Realtime

| Event | Mechanism |
|-------|-----------|
| New customer message | `broadcastConversationMessage`, `broadcastInboxPing` |
| Admin reply | `broadcastCustomerChatMessage` → FloatingChat on storefront |
| Guest session reset | `broadcastGuestChatReset` when admin deletes guest thread |

Polling fallback while chat panel is open when Realtime is unavailable.

---

## 6) Key source files

| File | Role |
|------|------|
| `src/app/components/FloatingChat.tsx` | Customer widget |
| `src/app/components/Chat.tsx` | Admin inbox |
| `src/app/components/EmojiPickerLazy.tsx` | Lazy emoji picker (native Unicode) |
| `src/app/utils/guestChatIdentity.ts` | Guest id, phone, display codes |
| `src/app/utils/chatLocalCache.ts` | localStorage message cache |
| `src/app/utils/chatRealtime.ts` | BroadcastChannel + Realtime helpers |
| `src/utils/chatConversation.ts` | Canonical thread id resolution |

---

## 7) Dependencies

- **`emoji-picker-react`** (MIT) — bundled as separate Vite chunk `emoji-picker-*.js`
- **`browser-image-compression`** — chat image uploads

---

## 8) Testing checklist

- [ ] Open FloatingChat on vendor storefront as guest — send first message → phone modal appears
- [ ] Save phone → subsequent messages include `customerPhone` in admin inbox
- [ ] Emoji picker opens beside image icon; emoji appears in sent message
- [ ] Admin reply from `/admin/chat` appears in FloatingChat on storefront
- [ ] Image upload sends compressed attachment
- [ ] After backend deploy, new messages persist in KV (not lost on refresh)
