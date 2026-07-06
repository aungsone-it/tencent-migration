/** Matches `auth_routes.tsx` — synthetic CloudBase email for phone-only customers. */
export const PHONE_AUTH_EMAIL_DOMAIN = "phone.migoo.store";

/** Staff / admin roles must not use storefront customer sessions. */
export const STOREFRONT_BLOCKED_ROLES = new Set([
  "super-admin",
  "store-owner",
  "administrator",
  "data-entry",
  "warehouse",
  "platform-admin",
  "product-manager",
  "developer",
  "vendor-admin",
  "collaborator",
]);

export const STOREFRONT_STAFF_BLOCKED_MESSAGE =
  "This account is for staff. Sign in through the admin portal. To shop here, register a separate customer account.";

export function isStaffOrPortalRole(role: unknown): boolean {
  const r = String(role || "").trim().toLowerCase();
  if (!r || r === "customer") return false;
  return STOREFRONT_BLOCKED_ROLES.has(r);
}

export function isStorefrontCustomerSession(
  user: Record<string, unknown> | null | undefined
): boolean {
  if (!user || typeof user !== "object") return false;
  if (isStaffOrPortalRole(user.role)) return false;
  const id = user.id ?? user.userId;
  return typeof id === "string" ? id.trim().length > 0 : typeof id === "number";
}

const MYANMAR_PHONE_RE = /^(\+959|09)\d{9}$/;

export function normalizeMyanmarPhone(raw: string): string | null {
  const normalized = String(raw || "").replace(/[\s\-]/g, "");
  if (!MYANMAR_PHONE_RE.test(normalized)) return null;
  if (normalized.startsWith("09")) return `+959${normalized.slice(1)}`;
  return normalized;
}

export function phoneToAuthEmail(normalizedPhone: string): string {
  const digits = normalizedPhone.replace(/\D/g, "");
  return `${digits}@${PHONE_AUTH_EMAIL_DOMAIN}`;
}

export function isSyntheticAuthEmail(email: string): boolean {
  return String(email || "").toLowerCase().endsWith(`@${PHONE_AUTH_EMAIL_DOMAIN}`);
}

/** Derive CloudBase auth email from any phone-shaped string (lenient fallback). */
export function authEmailFromPhoneRaw(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const normalized = normalizeMyanmarPhone(trimmed);
  if (normalized) return phoneToAuthEmail(normalized);

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 11 && digits.startsWith("959")) {
    return `${digits}@${PHONE_AUTH_EMAIL_DOMAIN}`;
  }
  if (digits.length >= 10 && digits.startsWith("09")) {
    return `${`95${digits.slice(1)}`}@${PHONE_AUTH_EMAIL_DOMAIN}`;
  }
  return null;
}

type CustomerAuthUser = {
  authEmail?: string | null;
  email?: string | null;
  phone?: string | null;
};

function pickNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function phoneFromSyntheticAuthEmail(authEmail: string): string | null {
  if (!isSyntheticAuthEmail(authEmail)) return null;
  const digits = authEmail.split("@")[0]?.replace(/\D/g, "") || "";
  if (!digits) return null;
  if (digits.startsWith("959") && digits.length >= 11) {
    return normalizeMyanmarPhone(`+${digits}`);
  }
  if (digits.startsWith("09")) {
    return normalizeMyanmarPhone(digits);
  }
  return null;
}

/** CloudBase Auth email for password changes / sign-in (real email or phone-derived). */
export function resolveCustomerAuthEmail(user: CustomerAuthUser | null | undefined): string | null {
  if (!user) return null;

  const storedAuthEmail = String(user.authEmail || "").trim();
  if (storedAuthEmail) return storedAuthEmail.toLowerCase();

  const email = String(user.email || "").trim();
  if (email) {
    return isSyntheticAuthEmail(email) ? email.toLowerCase() : email;
  }

  return authEmailFromPhoneRaw(String(user.phone || ""));
}

/** Best phone for display, forms, and checkout — stored phone or derived from synthetic auth email. */
export function resolveCustomerPhone(user: CustomerAuthUser | null | undefined): string | null {
  if (!user) return null;

  const stored = pickNonEmpty(user.phone);
  if (stored) {
    return normalizeMyanmarPhone(stored) || stored;
  }

  const authEmail = resolveCustomerAuthEmail(user);
  if (authEmail) {
    return phoneFromSyntheticAuthEmail(authEmail);
  }

  return null;
}

/** Customer-facing email (never shows synthetic phone-auth address). */
export function getCustomerDisplayEmail(user: CustomerAuthUser | null | undefined): string | null {
  const email = pickNonEmpty(user?.email);
  if (!email || isSyntheticAuthEmail(email)) return null;
  return email;
}

/** Profile subtitle: real email, else formatted phone, else fallback. */
export function getCustomerProfileSubtitle(user: CustomerAuthUser | null | undefined): string {
  const displayEmail = getCustomerDisplayEmail(user);
  if (displayEmail) return displayEmail;
  const phone = resolveCustomerPhone(user);
  if (phone) return formatCustomerPhoneDisplay(phone);
  return "No email provided";
}

/** Format Myanmar mobile for profile UI (falls back to raw stored value if not canonical). */
export function formatCustomerPhoneDisplay(phone: string | null | undefined): string {
  const raw = String(phone || "").trim();
  if (!raw) return "Not provided";

  const normalized = normalizeMyanmarPhone(raw);
  if (!normalized) return raw;

  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 10) return normalized;
  const local = digits.startsWith("959") ? digits.slice(2) : digits;
  if (local.length < 9) return normalized;
  return `+95 ${local[0]} ${local.slice(1, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

export function formatUserPhoneDisplay(user: CustomerAuthUser | null | undefined): string {
  const phone = resolveCustomerPhone(user);
  return phone ? formatCustomerPhoneDisplay(phone) : "Not provided";
}

/**
 * Hydrate migoo-user session: authEmail, display email, and phone from any available source.
 * Safe to run on every load/merge — fixes stale sessions missing phone after phone-only signup.
 */
export function normalizeCustomerSessionUser<T extends Record<string, unknown>>(
  user: T | null | undefined
): T | null {
  if (!user || typeof user !== "object") return null;

  const out = { ...user } as Record<string, unknown>;
  const rawEmail = pickNonEmpty(out.email);

  if (rawEmail && isSyntheticAuthEmail(rawEmail)) {
    if (!pickNonEmpty(out.authEmail)) out.authEmail = rawEmail.toLowerCase();
    out.email = "";
  }

  const authEmail = resolveCustomerAuthEmail(out);
  if (authEmail) out.authEmail = authEmail;

  const phone = resolveCustomerPhone(out);
  if (phone) out.phone = phone;

  return out as T;
}

/**
 * Merge server profile into local migoo-user without wiping phone/email/authEmail
 * when the API returns empty strings.
 */
export function applyCustomerProfileMerge(
  localUser: Record<string, unknown> | null | undefined,
  serverUser: Record<string, unknown>
): Record<string, unknown> {
  const phone = pickNonEmpty(serverUser.phone, localUser?.phone) ?? "";
  const authEmail = pickNonEmpty(serverUser.authEmail, localUser?.authEmail) ?? "";

  const merged: Record<string, unknown> = {
    ...localUser,
    ...serverUser,
    id: pickNonEmpty(localUser?.id, serverUser.id) ?? serverUser.id,
    email: pickNonEmpty(serverUser.email, localUser?.email) ?? "",
    phone,
    authEmail,
  };

  // Never drop a known phone/email/authEmail when the server payload is empty/incomplete.
  if (!phone && localUser?.phone) merged.phone = localUser.phone;
  if (!pickNonEmpty(merged.email) && localUser?.email) merged.email = localUser.email;
  if (!authEmail && localUser?.authEmail) merged.authEmail = localUser.authEmail;

  const serverProfileImageUrl = serverUser.profileImageUrl;
  const hasServerProfileImageUrl =
    typeof serverProfileImageUrl === "string" && serverProfileImageUrl.trim().length > 0;
  if (!hasServerProfileImageUrl) {
    delete merged.profileImageUrl;
  }

  return normalizeCustomerSessionUser(merged) ?? merged;
}

/** Attach authEmail when login/register payload omits it. */
export function withCustomerAuthEmail<T extends Record<string, unknown>>(user: T): T {
  return (normalizeCustomerSessionUser(user) ?? user) as T;
}

/** Merge API user with credentials the customer just typed (covers stale edge responses). */
export function enrichCustomerSessionFromAuthContext(
  user: Record<string, unknown> | null | undefined,
  ctx: { phone?: string; loginIdentifier?: string; email?: string }
): Record<string, unknown> | null {
  if (!user || typeof user !== "object") return null;

  const identifier = pickNonEmpty(ctx.loginIdentifier);
  const phoneCandidate = pickNonEmpty(
    user.phone,
    ctx.phone,
    identifier && normalizeMyanmarPhone(identifier)
  );

  const draft: Record<string, unknown> = { ...user };
  if (phoneCandidate) {
    draft.phone = normalizeMyanmarPhone(phoneCandidate) || phoneCandidate;
  } else if (ctx.phone !== undefined && !String(ctx.phone).trim()) {
    draft.phone = "";
  }

  if (ctx.email !== undefined) {
    const trimmed = String(ctx.email).trim();
    draft.email = trimmed && !isSyntheticAuthEmail(trimmed) ? trimmed : "";
  } else {
    const displayEmail = pickNonEmpty(user.email);
    if (displayEmail && !isSyntheticAuthEmail(displayEmail)) {
      draft.email = displayEmail;
    }
  }

  if (!pickNonEmpty(draft.authEmail)) {
    const derived = authEmailFromPhoneRaw(String(draft.phone || ctx.phone || identifier || ""));
    if (derived) draft.authEmail = derived;
  }

  return normalizeCustomerSessionUser(draft);
}

export function buildCustomerSessionFromAuthResponse(
  user: Record<string, unknown> | null | undefined,
  ctx: { phone?: string; loginIdentifier?: string; email?: string }
): Record<string, unknown> | null {
  const enriched = enrichCustomerSessionFromAuthContext(user, ctx);
  if (!enriched || isStaffOrPortalRole(enriched.role)) return null;
  return enriched;
}

export function readNormalizedMigooUserFromStorage(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("migoo-user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized = normalizeCustomerSessionUser(parsed);
    if (!normalized || !isStorefrontCustomerSession(normalized)) {
      localStorage.removeItem("migoo-user");
      return null;
    }
    return normalized;
  } catch {
    localStorage.removeItem("migoo-user");
    return null;
  }
}

export function persistMigooUserSession(user: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeCustomerSessionUser(user) ?? user;
  if (!isStorefrontCustomerSession(normalized)) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("migoo-user");
    }
    throw new Error(STOREFRONT_STAFF_BLOCKED_MESSAGE);
  }
  if (typeof window !== "undefined") {
    localStorage.setItem("migoo-user", JSON.stringify(normalized));
  }
  return normalized;
}
