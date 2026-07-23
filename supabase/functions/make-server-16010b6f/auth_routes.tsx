import { Hono } from "hono";
import nodeCrypto from "node:crypto";
import { createClient } from "./cloudbase_compat.ts";
import * as kv from "./kv_store.tsx";
import { ensureBucket } from "./storage_bucket_helpers.tsx";
import { deleteOwnedStorageRefs } from "./storage_delete_helpers.tsx";
import { absolutizeStorageObjectUrl } from "./storage_url_helpers.tsx";
import {
  appendStaffActivity,
  clearAllStaffActivities,
  getGlobalStaffActivityFeed,
  isValidStaffActorId,
} from "./staff_activity_helpers.tsx";
import { queueCustomerReadModelSync, queueVendorReadModelSync } from "./read_model.ts";
import { hashPasswordPlain, verifyPasswordPlain, isPasswordHashFormat } from "./password_crypto.tsx";
import {
  buildSesFromAddress,
  readSesConfig,
  sendPasswordResetOtpEmail,
  validateSesConfig,
} from "./tencent_ses.tsx";

const authApp = new Hono();

type StaffKvUser = Record<string, unknown> & {
  id?: string;
  email?: string;
  password?: string;
  role?: string;
};

const STAFF_KV_ROLES = new Set([
  "super-admin",
  "store-owner",
  "administrator",
  "platform-admin",
  "product-manager",
  "developer",
  "data-entry",
  "warehouse",
  "vendor-admin",
]);

function isStaffKvProfile(record: unknown): record is StaffKvUser {
  if (!record || typeof record !== "object") return false;
  const id = String((record as StaffKvUser).id || "").trim();
  if (!id || id.startsWith("vendor_")) return false;
  const role = String((record as StaffKvUser).role || "").trim().toLowerCase();
  if (role && STAFF_KV_ROLES.has(role)) return true;
  const email = String((record as StaffKvUser).email || "").trim();
  return Boolean(email) && typeof (record as StaffKvUser).password === "string";
}

async function findStaffUserByEmail(emailLower: string): Promise<StaffKvUser | null> {
  const normalized = String(emailLower || "").trim().toLowerCase();
  if (!normalized) return null;

  const direct = await kv.get(`user:${normalized}`);
  if (isStaffKvProfile(direct)) return direct;

  const usersList = await kv.get("auth:users-list");
  if (Array.isArray(usersList)) {
    for (const uid of usersList) {
      if (typeof uid !== "string" || !uid.trim()) continue;
      const profile = await kv.get(`auth:user:${uid}`);
      if (
        isStaffKvProfile(profile) &&
        String((profile as StaffKvUser).email || "").trim().toLowerCase() === normalized
      ) {
        return profile as StaffKvUser;
      }
    }
  }
  return null;
}

async function persistStaffUserRecord(user: StaffKvUser): Promise<void> {
  const userId = String(user.id || "").trim();
  const emailLower = String(user.email || "").trim().toLowerCase();
  if (userId) await kv.set(`auth:user:${userId}`, user);
  if (emailLower) {
    await kv.set(`user:${emailLower}`, user);
    if (userId) await kv.set(`userId:${userId}`, { email: emailLower });
  }
}

async function setStaffPassword(user: StaffKvUser, plainPassword: string, tempPassword = false): Promise<void> {
  const hashed = await hashPasswordPlain(plainPassword);
  await persistStaffUserRecord({
    ...user,
    password: hashed,
    tempPassword,
    updatedAt: new Date().toISOString(),
  });
}

async function tryStaffLogin(
  email: string,
  password: string,
): Promise<{ user: Record<string, unknown> } | { error: string } | null> {
  const emailLower = String(email || "").trim().toLowerCase();
  const staffUser = await findStaffUserByEmail(emailLower);
  if (!staffUser?.id) return null;

  const ok = await verifyPasswordPlain(password, staffUser.password);
  if (!ok) {
    return { error: "Invalid email or password" };
  }

  if (typeof staffUser.password === "string" && !isPasswordHashFormat(staffUser.password)) {
    await setStaffPassword(staffUser, password, Boolean(staffUser.tempPassword));
  }

  const refreshed = (await findStaffUserByEmail(emailLower)) || staffUser;
  const { password: _password, ...safeUser } = refreshed;
  return { user: safeUser };
}

// Helper function to wrap operations with timeout
async function withTimeout<T>(promise: Promise<T>, timeoutMs = 60000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

const supabaseAdmin = createClient(
  undefined,
  undefined,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// 🔥 SEPARATE CLIENT FOR CUSTOMER AUTH (uses anon key for signInWithPassword)
const supabaseAuth = createClient(
  undefined,
  undefined,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Storage bucket for profile images (lazy `ensureBucket` on upload — no listBuckets on every cold start)
const PROFILE_IMAGES_BUCKET = "make-16010b6f-profile-images";

const MYANMAR_PHONE_RE = /^(\+959|09)\d{9}$/;
const PHONE_AUTH_EMAIL_DOMAIN = "phone.migoo.store";

function normalizeMyanmarPhone(raw: string): string | null {
  const normalized = String(raw || "").replace(/[\s\-]/g, "");
  if (!MYANMAR_PHONE_RE.test(normalized)) return null;
  if (normalized.startsWith("09")) return `+959${normalized.slice(1)}`;
  return normalized;
}

function phoneToAuthEmail(normalizedPhone: string): string {
  const digits = normalizedPhone.replace(/\D/g, "");
  return `${digits}@${PHONE_AUTH_EMAIL_DOMAIN}`;
}

function isSyntheticAuthEmail(email: string): boolean {
  return String(email || "").toLowerCase().endsWith(`@${PHONE_AUTH_EMAIL_DOMAIN}`);
}

type CustomerAuthRecord = {
  id: string;
  email: string;
  password: string;
  name: string;
  phone: string;
  createdAt: string;
  updatedAt?: string;
};

async function persistCustomerAuthRecord(record: CustomerAuthRecord): Promise<void> {
  await kv.set(`customer_auth:${record.id}`, record);
  const emailLower = record.email.trim().toLowerCase();
  if (emailLower) {
    await kv.set(`customer_auth_email:${emailLower}`, { userId: record.id });
  }
}

async function findCustomerAuthByEmail(authEmail: string): Promise<CustomerAuthRecord | null> {
  const emailLower = authEmail.trim().toLowerCase();
  if (!emailLower) return null;
  const idx = await kv.get(`customer_auth_email:${emailLower}`);
  const userId =
    idx && typeof idx === "object" && typeof (idx as { userId?: string }).userId === "string"
      ? String((idx as { userId: string }).userId).trim()
      : "";
  if (!userId) return null;
  const rec = await kv.get(`customer_auth:${userId}`);
  return rec && typeof rec === "object" ? (rec as CustomerAuthRecord) : null;
}

async function verifyKvCustomerPassword(
  authEmail: string,
  password: string
): Promise<CustomerAuthRecord | null> {
  const rec = await findCustomerAuthByEmail(authEmail);
  if (!rec?.password) return null;
  const ok = await verifyPasswordPlain(password, rec.password);
  return ok ? rec : null;
}

async function createKvCustomerAuthUser(opts: {
  authEmail: string;
  password: string;
  name: string;
  phone: string;
}): Promise<string> {
  const userId =
    typeof nodeCrypto.randomUUID === "function"
      ? nodeCrypto.randomUUID()
      : `cust_auth_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const record: CustomerAuthRecord = {
    id: userId,
    email: opts.authEmail.toLowerCase(),
    password: await hashPasswordPlain(opts.password),
    name: opts.name,
    phone: opts.phone,
    createdAt: new Date().toISOString(),
  };
  await persistCustomerAuthRecord(record);
  return userId;
}

async function findCloudbaseAuthUserByEmail(emailLower: string): Promise<{ id: string } | null> {
  let page = 1;
  const perPage = 200;
  while (page <= 25) {
    const { data, error } = await withTimeout(
      supabaseAdmin.auth.admin.listUsers({ page, perPage }),
      30000,
    );
    if (error) {
      console.warn("[auth] listUsers failed during password reset lookup:", error.message);
      return null;
    }
    const users = Array.isArray((data as { users?: { id?: string; email?: string }[] } | null)?.users)
      ? (data as { users: { id?: string; email?: string }[] }).users
      : [];
    const match = users.find((u) => String(u.email || "").trim().toLowerCase() === emailLower);
    if (match?.id) return { id: String(match.id) };
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

type PasswordResetAccountKind = "staff" | "vendor" | "customer_kv" | "cloudbase";
type PasswordResetAccountHint = PasswordResetAccountKind | "auto";

type PasswordResetAccount = {
  userId: string;
  kind: PasswordResetAccountKind;
};

async function findVendorAuthByEmail(emailLower: string): Promise<{ id: string; needsSetup?: boolean } | null> {
  const validVendors = await kv.getVendorProfiles();
  const vendor = validVendors.find(
    (v: Record<string, unknown>) => String(v.email || "").trim().toLowerCase() === emailLower,
  );
  if (!vendor?.id) return null;
  if (String(vendor.status || "").trim().toLowerCase() !== "active") return null;
  if (!vendor.password) {
    return { id: String(vendor.id), needsSetup: true };
  }
  return { id: String(vendor.id) };
}

function otpStorageKey(emailLower: string, accountKind: PasswordResetAccountKind): string {
  return `otp:email:${emailLower}:${accountKind}`;
}

function legacyOtpStorageKey(emailLower: string): string {
  return `otp:email:${emailLower}`;
}

async function clearPasswordResetOtpsForEmail(
  emailLower: string,
  exceptKind?: PasswordResetAccountKind,
): Promise<void> {
  await kv.del(legacyOtpStorageKey(emailLower));
  for (const kind of ["staff", "vendor", "customer_kv", "cloudbase"] as PasswordResetAccountKind[]) {
    if (kind !== exceptKind) {
      await kv.del(otpStorageKey(emailLower, kind));
    }
  }
}

async function loadStoredPasswordResetOtp(
  emailLower: string,
  hint: PasswordResetAccountHint,
): Promise<{ data: Record<string, unknown> | null; key: string | null }> {
  if (hint !== "auto") {
    const scopedKey = otpStorageKey(emailLower, hint);
    const scoped = await kv.get(scopedKey);
    if (scoped) return { data: scoped as Record<string, unknown>, key: scopedKey };
  } else {
    const matches: Array<{ data: Record<string, unknown>; key: string }> = [];
    for (const kind of ["staff", "vendor", "customer_kv", "cloudbase"] as PasswordResetAccountKind[]) {
      const scopedKey = otpStorageKey(emailLower, kind);
      const scoped = await kv.get(scopedKey);
      if (scoped) matches.push({ data: scoped as Record<string, unknown>, key: scopedKey });
    }
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      return { data: null, key: null };
    }
  }

  const legacyKey = legacyOtpStorageKey(emailLower);
  const legacy = await kv.get(legacyKey);
  if (legacy) return { data: legacy as Record<string, unknown>, key: legacyKey };
  return { data: null, key: null };
}

async function resolvePasswordResetAccount(
  email: string,
  hint: PasswordResetAccountHint = "auto",
): Promise<PasswordResetAccount | null> {
  const emailLower = String(email || "").trim().toLowerCase();
  if (!emailLower) return null;

  const tryStaff = hint === "auto" || hint === "staff";
  const tryVendor = hint === "auto" || hint === "vendor";
  const tryCustomer = hint === "auto" || hint === "customer_kv";
  const tryCloudbase = hint === "auto" || hint === "cloudbase";

  if (hint === "staff") {
    const staffUser = await findStaffUserByEmail(emailLower);
    if (staffUser?.id) {
      return { userId: String(staffUser.id), kind: "staff" };
    }
    return null;
  }

  if (hint === "vendor") {
    const vendor = await findVendorAuthByEmail(emailLower);
    if (vendor?.needsSetup) return null;
    if (vendor?.id) return { userId: vendor.id, kind: "vendor" };
    return null;
  }

  if (hint === "auto") {
    const staffUser = await findStaffUserByEmail(emailLower);
    const vendor = await findVendorAuthByEmail(emailLower);
    const staffAccount =
      staffUser?.id ? { userId: String(staffUser.id), kind: "staff" as const } : null;
    const vendorAccount =
      vendor?.id && !vendor.needsSetup
        ? { userId: vendor.id, kind: "vendor" as const }
        : null;
    if (staffAccount && vendorAccount) {
      return null;
    }
    if (staffAccount) return staffAccount;
    if (vendorAccount) return vendorAccount;
  }

  if (tryStaff) {
    const staffUser = await findStaffUserByEmail(emailLower);
    if (staffUser?.id) {
      return { userId: String(staffUser.id), kind: "staff" };
    }
  }

  if (tryVendor) {
    const vendor = await findVendorAuthByEmail(emailLower);
    if (vendor?.needsSetup) return null;
    if (vendor?.id) return { userId: vendor.id, kind: "vendor" };
  }

  if (tryCustomer) {
    const customer = await findCustomerAuthByEmail(emailLower);
    if (customer?.id) {
      return { userId: customer.id, kind: "customer_kv" };
    }
  }

  if (tryCloudbase) {
    const cloudbaseUser = await findCloudbaseAuthUserByEmail(emailLower);
    if (cloudbaseUser?.id) {
      return { userId: cloudbaseUser.id, kind: "cloudbase" };
    }
  }

  return null;
}

async function setCustomerAuthPassword(record: CustomerAuthRecord, plainPassword: string): Promise<void> {
  await persistCustomerAuthRecord({
    ...record,
    password: await hashPasswordPlain(plainPassword),
    updatedAt: new Date().toISOString(),
  });
}

async function authUserExistsByEmail(authEmail: string): Promise<boolean> {
  const emailLower = authEmail.trim().toLowerCase();
  if (!emailLower) return false;
  if (await findCustomerAuthByEmail(emailLower)) return true;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return false;
    const users = (data as { users?: { email?: string }[] } | null)?.users;
    return (
      Array.isArray(users) &&
      users.some((u) => String(u.email || "").trim().toLowerCase() === emailLower)
    );
  } catch {
    return false;
  }
}

async function createStorefrontAuthUser(opts: {
  authEmail: string;
  password: string;
  name: string;
  phone: string;
}): Promise<{ userId: string; provider: "cloudbase" | "kv" }> {
  // CloudBase Auth admin `/admin/users` is unavailable on this environment (returns not_found).
  // Storefront customers use KV-backed auth; login verifies via signInWithPassword or KV fallback.
  const userId = await createKvCustomerAuthUser(opts);
  return { userId, provider: "kv" };
}

function rowToCustomer(row: any): any | null {
  if (!row) return null;
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  return {
    ...raw,
    id: row.id || raw.id,
    userId: row.user_id || raw.userId,
    email: row.email || raw.email,
    phone: row.phone || raw.phone,
    name: row.name || raw.name,
  };
}

async function findCustomerByUserIdFromReadModel(userId: string): Promise<any | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("app_customers")
      .select("id,user_id,name,email,phone,raw")
      .eq("user_id", uid)
      .limit(1);
    if (error) {
      console.warn("[auth] customer userId read-model lookup unavailable:", error.message);
      return null;
    }
    return rowToCustomer(Array.isArray(data) ? data[0] : null);
  } catch (error) {
    console.warn("[auth] customer userId read-model lookup failed:", error);
    return null;
  }
}

function pickNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** KV is authoritative for storefront customers; read-model can lag or omit phone/email. */
async function findStorefrontCustomerByUserId(userId: string): Promise<any | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  const allCustomers = await withTimeout(kv.getByPrefix("customer:"), 30000);
  const fromKv = Array.isArray(allCustomers)
    ? allCustomers.find((c: any) => c != null && c.userId === uid)
    : null;

  const fromReadModel = await findCustomerByUserIdFromReadModel(uid);
  if (!fromKv && !fromReadModel) return null;
  if (!fromKv) return fromReadModel;
  if (!fromReadModel) return fromKv;

  return {
    ...fromReadModel,
    ...fromKv,
    id: fromKv.id || fromReadModel.id,
    userId: uid,
    name: pickNonEmpty(fromKv.name, fromReadModel.name),
    email: pickNonEmpty(fromKv.email, fromReadModel.email),
    phone: pickNonEmpty(fromKv.phone, fromReadModel.phone),
  };
}

async function getSupabaseAuthEmail(userId: string): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return "";
    return String(data.user.email).trim().toLowerCase();
  } catch {
    return "";
  }
}

function buildStorefrontUserResponse(customer: any, userId: string, authEmail?: string) {
  const displayEmail = isSyntheticAuthEmail(String(customer?.email || "")) ? "" : String(customer?.email || "").trim();
  const normalizedPhone = normalizeMyanmarPhone(String(customer?.phone || ""));
  const phoneAuth = normalizedPhone ? phoneToAuthEmail(normalizedPhone) : "";
  const resolvedAuthEmail = pickNonEmpty(
    authEmail,
    displayEmail && !isSyntheticAuthEmail(displayEmail) ? displayEmail : "",
    phoneAuth
  );

  return {
    ...customer,
    email: displayEmail,
    id: userId,
    customerId: customer.id,
    ...(resolvedAuthEmail ? { authEmail: resolvedAuthEmail } : {}),
  };
}

async function enrichCustomerFromAuthUser(customer: any, authUser: { user_metadata?: Record<string, unknown>; email?: string | null }): Promise<any> {
  if (!customer || typeof customer !== "object") return customer;

  const metaPhone = normalizeMyanmarPhone(String(authUser.user_metadata?.phone || ""));
  const metaName = String(authUser.user_metadata?.name || "").trim();
  let changed = false;

  if (metaPhone && !pickNonEmpty(customer.phone)) {
    customer.phone = metaPhone;
    changed = true;
  }
  if (metaName && !pickNonEmpty(customer.name)) {
    customer.name = metaName;
    changed = true;
  }

  const authEmail = String(authUser.email || "").trim().toLowerCase();
  if (authEmail && !pickNonEmpty(customer.email) && !isSyntheticAuthEmail(authEmail)) {
    customer.email = authEmail;
    changed = true;
  }

  if (changed && customer.id) {
    customer.updatedAt = new Date().toISOString();
    await withTimeout(kv.set(`customer:${customer.id}`, customer), 5000);
    queueCustomerReadModelSync(String(customer.id), customer);
  }

  return customer;
}

async function findCustomerByEmailFromReadModel(email: string): Promise<any | null> {
  const em = String(email || "").trim();
  if (!em) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("app_customers")
      .select("id,user_id,name,email,phone,raw")
      .ilike("email", em)
      .limit(1);
    if (error) {
      console.warn("[auth] customer email read-model lookup unavailable:", error.message);
      return null;
    }
    return rowToCustomer(Array.isArray(data) ? data[0] : null);
  } catch (error) {
    console.warn("[auth] customer email read-model lookup failed:", error);
    return null;
  }
}

async function findCustomerByPhone(normalizedPhone: string): Promise<any | null> {
  try {
    const phone09 = normalizedPhone.startsWith("+959") ? `09${normalizedPhone.slice(4)}` : normalizedPhone;
    const { data, error } = await supabaseAdmin
      .from("app_customers")
      .select("id,user_id,name,email,phone,raw")
      .in("phone", [normalizedPhone, phone09])
      .limit(1);
    if (!error) {
      const customer = rowToCustomer(Array.isArray(data) ? data[0] : null);
      if (customer) return customer;
    } else {
      console.warn("[auth] customer phone read-model lookup unavailable:", error.message);
    }
  } catch (error) {
    console.warn("[auth] customer phone read-model lookup failed:", error);
  }

  const allCustomers = await withTimeout(kv.getByPrefix("customer:"), 30000);
  if (!Array.isArray(allCustomers)) return null;
  return (
    allCustomers.find((c: any) => {
      if (!c?.phone) return false;
      return normalizeMyanmarPhone(c.phone) === normalizedPhone;
    }) ?? null
  );
}

async function findCustomerByEmail(email: string): Promise<any | null> {
  const emLower = String(email || "").trim().toLowerCase();
  if (!emLower || isSyntheticAuthEmail(emLower)) return null;

  const fromReadModel = await findCustomerByEmailFromReadModel(emLower);
  if (fromReadModel) return fromReadModel;

  const allCustomers = await withTimeout(kv.getByPrefix("customer:"), 30000);
  if (!Array.isArray(allCustomers)) return null;
  return (
    allCustomers.find((c: any) => {
      const ce = String(c?.email || "").trim().toLowerCase();
      return ce && ce === emLower && !isSyntheticAuthEmail(ce);
    }) ?? null
  );
}

async function findCustomerAuthByUserId(userId: string): Promise<CustomerAuthRecord | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const rec = await kv.get(`customer_auth:${uid}`);
  return rec && typeof rec === "object" ? (rec as CustomerAuthRecord) : null;
}

async function buildCustomerLoginAuthCandidates(identifier: string): Promise<string[]> {
  const trimmed = String(identifier || "").trim();
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (email: unknown) => {
    const lower = String(email || "").trim().toLowerCase();
    if (!lower || seen.has(lower)) return;
    seen.add(lower);
    candidates.push(lower);
  };

  const asPhone = normalizeMyanmarPhone(trimmed);
  const customer = asPhone
    ? await findCustomerByPhone(asPhone)
    : trimmed.includes("@")
      ? await findCustomerByEmail(trimmed)
      : null;

  if (customer?.userId) {
    const authRec = await findCustomerAuthByUserId(String(customer.userId));
    if (authRec?.email) add(authRec.email);
  }

  if (trimmed.includes("@")) add(trimmed);

  const phone =
    asPhone ||
    (customer?.phone ? normalizeMyanmarPhone(String(customer.phone)) : null);
  if (phone) add(phoneToAuthEmail(phone));

  const displayEmail = String(customer?.email || "").trim();
  if (displayEmail && !isSyntheticAuthEmail(displayEmail)) add(displayEmail);

  return candidates;
}

async function resolveCustomerLoginEmail(
  identifier: string
): Promise<{ email: string; error?: string }> {
  const trimmed = String(identifier || "").trim();
  if (!trimmed) {
    return { email: "", error: "Email or phone number is required" };
  }

  const candidates = await buildCustomerLoginAuthCandidates(trimmed);

  for (const candidate of candidates) {
    if (await findCustomerAuthByEmail(candidate)) {
      return { email: candidate };
    }
  }

  for (const candidate of candidates) {
    if (await authUserExistsByEmail(candidate)) {
      return { email: candidate };
    }
  }

  if (candidates.length > 0) return { email: candidates[0] };

  const asPhone = normalizeMyanmarPhone(trimmed);
  if (asPhone) return { email: phoneToAuthEmail(asPhone).toLowerCase() };
  if (trimmed.includes("@")) return { email: trimmed.toLowerCase() };

  return { email: trimmed.toLowerCase() };
}

async function authenticateStorefrontCustomer(
  identifier: string,
  password: string
): Promise<{
  authUser: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  };
  loginEmail: string;
  authSession?: { access_token?: string; refresh_token?: string };
} | null> {
  const candidates = await buildCustomerLoginAuthCandidates(identifier);
  if (candidates.length === 0) return null;

  for (const loginEmail of candidates) {
    const kvAuth = await verifyKvCustomerPassword(loginEmail, password);
    if (kvAuth) {
      return {
        authUser: {
          id: kvAuth.id,
          email: loginEmail,
          user_metadata: { name: kvAuth.name, phone: kvAuth.phone, role: "customer" },
        },
        loginEmail,
      };
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    if (!error && data.user) {
      return {
        authUser: data.user,
        loginEmail,
        authSession: data.session,
      };
    }
  }

  return null;
}

// Helper function to upload profile image to storage (multipart file)
async function uploadProfileImageFile(userId: string, imageFile: File): Promise<string | null> {
  try {
    await ensureBucket(supabaseAdmin, PROFILE_IMAGES_BUCKET, {
      public: false,
      fileSizeLimit: 524288,
    });

    const MAX_PROFILE_BYTES = 524288;
    if (imageFile.size > MAX_PROFILE_BYTES) {
      console.error(`❌ Profile image too large: ${imageFile.size} bytes (max ${MAX_PROFILE_BYTES})`);
      return null;
    }

    const name = imageFile.name || "profile.jpg";
    const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "jpg";
    const imageType = ext === "jpg" ? "jpeg" : ext || "jpeg";
    const filename = `${userId}_${Date.now()}.${imageType}`;
    const filePath = `profile-images/${filename}`;

    const arrayBuffer = await imageFile.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const { error } = await supabaseAdmin.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(filePath, bytes, {
        contentType: imageFile.type || `image/${imageType}`,
        upsert: false,
      });

    if (error) {
      console.error("❌ Error uploading profile image file:", error);
      return null;
    }

    console.log(`✅ Profile image uploaded: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error("❌ Error processing profile image file:", error);
    return null;
  }
}

// Helper function to upload profile image to Supabase Storage
async function uploadProfileImage(userId: string, imageDataUrl: string): Promise<string | null> {
  try {
    await ensureBucket(supabaseAdmin, PROFILE_IMAGES_BUCKET, {
      public: false,
      fileSizeLimit: 524288,
    });

    // Extract base64 data from data URL
    const matches = imageDataUrl.match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,(.+)$/);
    if (!matches) {
      console.error("Invalid image data URL format");
      return null;
    }

    const [, imageType, base64Data] = matches;
    
    // Convert base64 to Uint8Array
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Generate unique filename
    const filename = `${userId}_${Date.now()}.${imageType === 'jpg' ? 'jpeg' : imageType}`;
    const filePath = `profile-images/${filename}`;

    // Upload to Supabase Storage
    const { data, error } = await supabaseAdmin.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(filePath, bytes, {
        contentType: `image/${imageType}`,
        upsert: false,
      });

    if (error) {
      console.error("❌ Error uploading image to storage:", error);
      return null;
    }

    console.log(`✅ Profile image uploaded: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error("❌ Error processing profile image:", error);
    return null;
  }
}

// Helper function to get signed URL for profile image
async function getSignedImageUrl(filePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(PROFILE_IMAGES_BUCKET)
      .createSignedUrl(filePath, 60 * 60 * 24 * 365); // 1 year expiry

    if (error) {
      console.error("❌ Error creating signed URL:", error);
      return null;
    }

    return data.signedUrl ? absolutizeStorageObjectUrl(data.signedUrl) : null;
  } catch (error) {
    console.error("❌ Error getting signed URL:", error);
    return null;
  }
}

/** Only these may be stored on new/updated staff (setup still creates `super-admin`). */
const CANONICAL_STAFF_ROLES = new Set([
  "store-owner",
  "administrator",
  "data-entry",
  "warehouse",
]);

const OWNER_ROLES = new Set(["super-admin", "store-owner"]);
const ADMIN_TIER_ROLES = new Set([
  "administrator",
  "platform-admin",
  "product-manager",
  "developer",
]);

function canAssignStaffRoleBackend(creatorRole: string, targetRole: string): boolean {
  const t = String(targetRole || "").trim();
  if (!CANONICAL_STAFF_ROLES.has(t)) return false;
  const c = String(creatorRole || "").trim();
  if (OWNER_ROLES.has(c)) return true;
  if (ADMIN_TIER_ROLES.has(c)) return t === "warehouse" || t === "data-entry";
  if (c === "vendor-admin") return true;
  return false;
}

/** Same email twice in auth:users-list (legacy sync / duplicate IDs) → one row for Settings UI. */
function profileRolePriority(role: string): number {
  const r = String(role || "").trim();
  if (OWNER_ROLES.has(r)) return 100;
  if (ADMIN_TIER_ROLES.has(r)) return 50;
  return 10;
}

function formatAuditRoleLabel(role: unknown): string {
  const raw = String(role || "").trim();
  if (!raw) return "Unknown";
  return raw
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAuditStatusLabel(status: unknown): string {
  const raw = String(status || "").trim().toLowerCase();
  if (!raw) return "Unknown";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatUserAuditDetail(opts: {
  name?: unknown;
  email?: unknown;
  role?: unknown;
}): string {
  const parts = [
    String(opts.name || "").trim(),
    String(opts.email || "").trim(),
    opts.role ? formatAuditRoleLabel(opts.role) : "",
  ].filter(Boolean);
  return parts.join(" | ").slice(0, 220);
}

function dedupeAuthProfilesByEmail(profiles: any[]): any[] {
  const byEmail = new Map<string, any[]>();
  const noEmail: any[] = [];
  for (const p of profiles) {
    if (!p || typeof p !== "object") continue;
    const em = String(p.email || "").trim().toLowerCase();
    if (!em) {
      noEmail.push(p);
      continue;
    }
    const g = byEmail.get(em) || [];
    g.push(p);
    byEmail.set(em, g);
  }
  const out: any[] = [...noEmail];
  for (const [em, group] of byEmail) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    console.warn(
      `⚠️ Deduped ${group.length} staff profiles for email ${em} — kept one canonical row (merge auth:users-list in KV if needed)`
    );
    group.sort((a, b) => {
      const pr = profileRolePriority(b.role) - profileRolePriority(a.role);
      if (pr !== 0) return pr;
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
    out.push(group[0]);
  }
  return out;
}

/** All Supabase Auth user ids (source of truth for who can log in / reset password). */
async function listSupabaseAuthUserIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await withTimeout(
      supabaseAdmin.auth.admin.listUsers({ page, perPage }),
      30000
    );
    if (error) throw error;
    for (const u of data.users) {
      if (u.id) ids.add(u.id);
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return ids;
}

/** Drop KV staff rows whose id no longer exists in Supabase Auth. */
async function pruneOrphanedStaffProfiles(validAuthIds: Set<string>): Promise<number> {
  const raw = await kv.get("auth:users-list");
  const userIds = Array.isArray(raw) ? raw.map((id) => String(id)) : [];
  if (userIds.length === 0) return 0;

  const orphans = userIds.filter((id) => !validAuthIds.has(id));
  if (orphans.length === 0) return 0;

  const nextList = userIds.filter((id) => validAuthIds.has(id));
  await kv.set("auth:users-list", nextList);
  for (const id of orphans) {
    await kv.del(`auth:user:${id}`).catch(() => undefined);
  }
  console.warn(
    `🧹 Pruned ${orphans.length} orphaned staff profile(s) from KV (missing in Supabase Auth): ${orphans.join(", ")}`
  );
  return orphans.length;
}

// Generate random password
function generatePassword(): string {
  const length = 12;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

// ============================================
// CHECK IF SETUP IS NEEDED
// ============================================
authApp.get("/check-setup", async (c) => {
  try {
    const setupComplete = await kv.get("auth:super-admin-created");
    return c.json({ setupComplete: !!setupComplete });
  } catch (error: any) {
    console.error("Check setup error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// EMAIL DELIVERY HEALTH (Tencent SES config quick check)
// ============================================
authApp.get("/email-health", async (c) => {
  try {
    const sesConfig = readSesConfig();
    const issues = validateSesConfig(sesConfig);
    const fromBuilt =
      sesConfig?.fromEmail ? buildSesFromAddress(sesConfig.fromEmail, sesConfig.fromName) : null;

    return c.json({
      ok: issues.length === 0,
      provider: "tencent-ses",
      region: sesConfig?.region,
      fromEmailConfigured: !!sesConfig?.fromEmail,
      fromName: sesConfig?.fromName,
      passwordResetTemplateId: sesConfig?.passwordResetTemplateId,
      templateOtpVar: sesConfig?.passwordResetTemplateOtpVar,
      fromField: fromBuilt && "from" in fromBuilt ? fromBuilt.from : undefined,
      issues,
    }, issues.length === 0 ? 200 : 503);
  } catch (error: any) {
    console.error("Email health check error:", error);
    return c.json({ ok: false, error: error.message || "Email health check failed" }, 500);
  }
});

// ============================================
// SETUP: Create super admin (one-time only)
// ============================================
authApp.post("/setup", async (c) => {
  try {
    const { name, email, password, phone } = await c.req.json();
    const emailLower = String(email || "").trim().toLowerCase();

    // Check if super admin already exists
    const existing = await kv.get("auth:super-admin-created");
    if (existing) {
      return c.json({ error: "Super admin already exists" }, 400);
    }

    if (!name || !emailLower || !password) {
      return c.json({ error: "Name, email, and password are required" }, 400);
    }

    const userId =
      typeof nodeCrypto.randomUUID === "function"
        ? nodeCrypto.randomUUID()
        : `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = new Date().toISOString();
    const userRecord = {
      id: userId,
      email: emailLower,
      name,
      phone: phone || "",
      role: "store-owner",
      tempPassword: false,
      password: await hashPasswordPlain(password),
      createdAt,
    };

    // Store user profile in KV
    await kv.set(`user:${emailLower}`, userRecord);
    await kv.set(`userId:${userId}`, { email: emailLower });
    await kv.set(`auth:user:${userId}`, userRecord);

    // Add super admin to users list
    const usersList = (await kv.get("auth:users-list")) || [];
    usersList.push(userId);
    await kv.set("auth:users-list", usersList);

    // Mark super admin as created
    await kv.set("auth:super-admin-created", true);

    console.log(`✅ Super admin created: ${emailLower}`);

    return c.json({ success: true, userId });
  } catch (error: any) {
    console.error("Setup error:", error);
    return c.json({ error: error.message || "Setup failed" }, 500);
  }
});

// ============================================
// GET USER PROFILE
// ============================================
authApp.get("/profile/:userId", async (c) => {
  try {
    let userId = c.req.param("userId");
    console.log(`📡 API Request: GET /auth/profile/${userId}`);
    
    // 🔥 AUTO-FIX: If a customer ID was passed instead of a userId, resolve it
    if (userId.startsWith('cust_')) {
      console.log(`⚠️ Customer ID detected in profile fetch: ${userId}. Resolving to userId...`);
      const customer = await kv.get(`customer:${userId}`);
      if (customer && customer.userId) {
        console.log(`✅ Resolved ${userId} -> ${customer.userId}`);
        userId = customer.userId;
      } else {
        // Try searching by ID if it's not a prefix
        const allCustomers = await kv.getByPrefix("customer:");
        const found = allCustomers.find((c: any) => c && c.id === userId);
        if (found && found.userId) {
          userId = found.userId;
        }
      }
    }

    const profile = await kv.get(`auth:user:${userId}`);

    if (profile && typeof profile === "object") {
      const { password: _, ...rest } = profile as Record<string, unknown> & {
        password?: string;
        profileImage?: string;
      };
      const out = { ...rest } as Record<string, unknown>;
      if (typeof out.profileImage === "string" && out.profileImage.trim()) {
        const signedUrl = await getSignedImageUrl(out.profileImage.trim());
        if (signedUrl) out.profileImageUrl = signedUrl;
      }
      try {
        const { data: au, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (!authErr && au?.user) {
          const u = au.user;
          if (u.last_sign_in_at) out.lastSignInAt = u.last_sign_in_at;
          if (u.created_at) out.authCreatedAt = u.created_at;
        }
      } catch (e) {
        console.warn("⚠️ Profile: could not enrich from Supabase Auth:", e);
      }
      console.log(`✅ API Success: auth:user profile for ${userId}`);
      return c.json({ user: out });
    }

    // Storefront customers live in customer:* — same as login payload, not auth:user.
    let authUserEmail = "";
    let customer = await findStorefrontCustomerByUserId(userId);

    try {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (!authErr && authData?.user) {
        authUserEmail = String(authData.user.email || "").trim().toLowerCase();
      }
    } catch {
      // CloudBase Auth admin lookup unavailable — KV storefront customers may still exist.
    }

    if (!authUserEmail) {
      const kvAuth = await kv.get(`customer_auth:${userId}`);
      if (kvAuth && typeof kvAuth === "object") {
        authUserEmail = String((kvAuth as CustomerAuthRecord).email || "").trim().toLowerCase();
      }
    }

    if (!customer && !authUserEmail) {
      console.log(`❌ API Error (/auth/profile/${userId}): User not found`);
      return c.json({ error: "User not found" }, 404);
    }

    if (customer && typeof customer === "object") {
      const authEmail = authUserEmail || (await getSupabaseAuthEmail(userId));
      customer = await enrichCustomerFromAuthUser(customer, { email: authEmail });
      const { password: __, ...customerRest } = customer as Record<string, unknown> & {
        password?: string;
      };
      const cust = customer as {
        id?: string;
        profileImage?: string;
        avatar?: string;
      };
      const userPayload: Record<string, unknown> = buildStorefrontUserResponse(
        { ...customerRest, customerId: cust.id },
        userId,
        authEmail
      );
      if (typeof cust.profileImage === "string" && cust.profileImage.trim()) {
        const su = await getSignedImageUrl(cust.profileImage.trim());
        if (su) userPayload.profileImageUrl = su;
      } else if (typeof cust.avatar === "string" && cust.avatar.trim()) {
        userPayload.profileImageUrl = cust.avatar.trim();
      }
      console.log(`✅ API Success: customer profile for userId ${userId}`);
      return c.json({ user: userPayload });
    }

    console.log(`❌ API Error (/auth/profile/${userId}): User not found`);
    return c.json({ error: "User not found" }, 404);
  } catch (error: any) {
    console.error(`❌ API Request Failed (/auth/profile/${c.req.param("userId")}):`, error.message);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// UPDATE PASSWORD (logged-in staff, KV auth)
// ============================================
authApp.post("/update-password", async (c) => {
  try {
    const { userId, password } = await c.req.json();
    if (!userId || !password) {
      return c.json({ error: "userId and password are required" }, 400);
    }

    const profile = await kv.get(`auth:user:${userId}`);
    if (!profile || typeof profile !== "object") {
      return c.json({ error: "User not found" }, 404);
    }

    await setStaffPassword(profile as StaffKvUser, String(password), false);

    const { error } = await supabaseAdmin.auth.admin.updateUserById(String(userId), {
      password: String(password),
    });
    if (error) {
      console.warn("Supabase Auth password update skipped:", error.message);
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update password error:", error);
    return c.json({ error: error.message || "Failed to update password" }, 500);
  }
});

// ============================================
// UPDATE TEMP PASSWORD FLAG
// ============================================
authApp.post("/update-temp-password", async (c) => {
  try {
    const { userId } = await c.req.json();
    const profile = await kv.get(`auth:user:${userId}`);

    if (!profile) {
      return c.json({ error: "User not found" }, 404);
    }

    await kv.set(`auth:user:${userId}`, {
      ...profile,
      tempPassword: false,
    });
    const emailLower = String((profile as StaffKvUser).email || "").trim().toLowerCase();
    if (emailLower) {
      const emailRecord = await kv.get(`user:${emailLower}`);
      if (emailRecord && typeof emailRecord === "object") {
        await kv.set(`user:${emailLower}`, { ...emailRecord, tempPassword: false });
      }
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update temp password error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// CREATE USER (by super admin)
// ============================================
authApp.post("/create-user", async (c) => {
  try {
    const { name, email, phone, role, storeId, createdBy, profileImage } = await c.req.json();
    const phoneValue = typeof phone === "string" ? phone.trim() : "";

    if (!createdBy || String(createdBy).trim() === "") {
      return c.json({ error: "createdBy is required" }, 400);
    }

    const creator = await kv.get(`auth:user:${createdBy}`);
    if (!creator || typeof creator !== "object") {
      return c.json({ error: "Unauthorized" }, 403);
    }

    const cr = String((creator as { role?: string }).role || "");
    const canCreate =
      OWNER_ROLES.has(cr) || ADMIN_TIER_ROLES.has(cr) || cr === "vendor-admin";
    if (!canCreate) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    const targetRole = String(role || "data-entry").trim();
    if (!canAssignStaffRoleBackend(cr, targetRole)) {
      return c.json({ error: "You cannot assign this role" }, 403);
    }

    const emailLower = String(email || "").trim().toLowerCase();
    if (!emailLower) {
      return c.json({ error: "Email is required" }, 400);
    }

    if (await findStaffUserByEmail(emailLower)) {
      return c.json({ error: "A user with this email already exists" }, 409);
    }
    if (await findCustomerAuthByEmail(emailLower)) {
      return c.json({ error: "This email is already used by a storefront customer account" }, 409);
    }

    // KV-backed staff auth (CloudBase Auth admin /admin/users returns not_found on TCB).
    const tempPassword = generatePassword();
    const userId =
      typeof nodeCrypto.randomUUID === "function"
        ? nodeCrypto.randomUUID()
        : `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    let profileImagePath: string | undefined;
    if (profileImage && typeof profileImage === "string" && profileImage.startsWith("data:image/")) {
      const uploaded = await uploadProfileImage(userId, profileImage);
      if (uploaded) profileImagePath = uploaded;
    }

    const kvProfile: StaffKvUser = {
      id: userId,
      email: emailLower,
      name,
      phone: phoneValue,
      role: targetRole,
      storeId: storeId || "",
      tempPassword: true,
      password: await hashPasswordPlain(tempPassword),
      createdBy,
      createdAt: new Date().toISOString(),
    };
    if (profileImagePath) kvProfile.profileImage = profileImagePath;

    await persistStaffUserRecord(kvProfile);

    // Add to users list
    const users = (await kv.get("auth:users-list")) || [];
    users.push(userId);
    await kv.set("auth:users-list", users);

    console.log(`✅ User created: ${emailLower} with role ${targetRole}`);
    const createdName = String(name || emailLower || "User").trim();
    const createdMail = emailLower;
    await appendStaffActivity(createdBy, {
      type: "user_created",
      action: "User created",
      detail: formatUserAuditDetail({ name: createdName, email: createdMail, role: targetRole }),
    });

    let profileImageUrl: string | undefined;
    if (profileImagePath) {
      const su = await getSignedImageUrl(profileImagePath);
      if (su) profileImageUrl = su;
    }

    return c.json({
      success: true,
      userId,
      tempPassword, // Return this so admin can share it
      profileImageUrl,
    });
  } catch (error: any) {
    console.error("Create user error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// GET ALL USERS
// ============================================
authApp.get("/users", async (c) => {
  try {
    const userIds = (await withTimeout(kv.get("auth:users-list"), 30000)) || [];
    const users = [];

    for (const userId of userIds) {
      const id = String(userId);
      const profile = await withTimeout(kv.get(`auth:user:${id}`), 30000);
      if (profile && typeof profile === "object") {
        const safe = { ...(profile as Record<string, unknown>) };
        delete (safe as { password?: unknown }).password;
        delete (safe as { tempPassword?: unknown }).tempPassword;
        const path = typeof safe.profileImage === "string" ? safe.profileImage.trim() : "";
        if (path) {
          const signed = await getSignedImageUrl(path);
          if (signed) (safe as { profileImageUrl?: string }).profileImageUrl = signed;
        }
        users.push(safe);
      }
    }

    return c.json(dedupeAuthProfilesByEmail(users));
  } catch (error: any) {
    console.error("Get users error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// UPLOAD PROFILE IMAGE (multipart — avoids JSON body size limits)
// ============================================
authApp.post("/user/:userId/profile-image", async (c) => {
  try {
    const userId = c.req.param("userId");
    const profile = await kv.get(`auth:user:${userId}`);
    if (!profile) {
      return c.json({ error: "User not found" }, 404);
    }

    const formData = await c.req.formData();
    const imageFile = formData.get("image") as File | null;
    if (!imageFile || typeof imageFile.arrayBuffer !== "function") {
      return c.json({ error: "No image file provided" }, 400);
    }

    const fileSizeKB = imageFile.size / 1024;
    if (fileSizeKB > 600) {
      return c.json({ error: "Image file too large. Maximum size is 500KB" }, 400);
    }

    const uploadedPath = await uploadProfileImageFile(userId, imageFile);
    if (!uploadedPath) {
      return c.json({ error: "Failed to upload profile image" }, 500);
    }

    const p = profile as Record<string, unknown> & { profileImage?: string };
    const prevImg = typeof p.profileImage === "string" ? p.profileImage.trim() : "";
    const updatedProfile: Record<string, unknown> = {
      ...p,
      profileImage: uploadedPath,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`auth:user:${userId}`, updatedProfile);
    if (typeof updatedProfile.email === "string" && updatedProfile.email.trim()) {
      const emailKey = updatedProfile.email.trim().toLowerCase();
      await kv.set(`user:${emailKey}`, {
        ...updatedProfile,
        password: (p as { password?: unknown }).password,
      });
      await kv.set(`userId:${userId}`, { email: emailKey });
    }

    if (prevImg && prevImg !== uploadedPath) {
      await deleteOwnedStorageRefs(supabaseAdmin, [prevImg]);
    }

    const signedUrl = await getSignedImageUrl(uploadedPath);
    if (signedUrl) {
      updatedProfile.profileImageUrl = signedUrl;
    }

    return c.json({
      success: true,
      profileImage: uploadedPath,
      profileImageUrl: signedUrl,
      user: updatedProfile,
    });
  } catch (error: any) {
    console.error("❌ Profile image upload error:", error);
    return c.json({ error: error.message || "Failed to upload profile image" }, 500);
  }
});

// ============================================
// UPDATE USER
// ============================================
authApp.put("/user/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    const body = await c.req.json();
    const {
      name,
      email,
      phone,
      status,
      role,
      storeId,
      profileImage,
      updatedBy,
      removeProfileImage,
      location,
      addressLine1,
      addressLine2,
      city,
      region,
      postalCode,
      country,
      bio,
    } = body;

    const profile = await kv.get(`auth:user:${userId}`);
    if (!profile) {
      return c.json({ error: "User not found" }, 404);
    }

    const p = profile as Record<string, unknown> & {
      email?: string;
      name?: string;
      phone?: string;
      role?: string;
      storeId?: string;
      profileImage?: string;
    };

    if (role !== undefined && role !== p.role) {
      if (!updatedBy || String(updatedBy).trim() === "") {
        return c.json({ error: "updatedBy is required when changing role" }, 400);
      }
      const actor = await kv.get(`auth:user:${updatedBy}`);
      const ar = actor && typeof actor === "object" ? String((actor as { role?: string }).role || "") : "";
      const newRole = String(role || "").trim();
      if (!canAssignStaffRoleBackend(ar, newRole)) {
        return c.json({ error: "You cannot assign this role" }, 403);
      }
      const prevRole = String(p.role || "");
      if (OWNER_ROLES.has(prevRole) && !OWNER_ROLES.has(ar)) {
        return c.json({ error: "Only store owners can change owner-level roles" }, 403);
      }
    }

    const hasNewImageData =
      profileImage && typeof profileImage === "string" && profileImage.startsWith("data:image/");
    const imagePayloadTooLarge =
      hasNewImageData && typeof profileImage === "string" && profileImage.length > 450_000;
    const shouldClearImage = removeProfileImage === true && !hasNewImageData;

    let uploadedPath: string | null = null;
    if (hasNewImageData && imagePayloadTooLarge) {
      console.warn("Profile image payload too large for Cloud Function; skipping image update");
    } else if (hasNewImageData) {
      uploadedPath = await uploadProfileImage(userId, profileImage);
    }

    console.log(`🔄 Updating user ${userId}:`, { name, email, phone, role, shouldClearImage });

    const updatedProfile: Record<string, unknown> = {
      ...p,
      name: name !== undefined ? name : p.name,
      email: email !== undefined ? email : p.email,
      phone: phone !== undefined ? phone : p.phone,
      status: status !== undefined ? status : (p as { status?: unknown }).status,
      role: role !== undefined ? role : p.role,
      storeId: storeId !== undefined ? storeId : p.storeId,
      updatedAt: new Date().toISOString(),
    };

    if (location !== undefined) updatedProfile.location = location;
    if (addressLine1 !== undefined) updatedProfile.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) updatedProfile.addressLine2 = addressLine2;
    if (city !== undefined) updatedProfile.city = city;
    if (region !== undefined) updatedProfile.region = region;
    if (postalCode !== undefined) updatedProfile.postalCode = postalCode;
    if (country !== undefined) updatedProfile.country = country;
    if (bio !== undefined) updatedProfile.bio = bio;

    if (shouldClearImage) {
      delete updatedProfile.profileImage;
      delete updatedProfile.profileImageUrl;
    } else if (uploadedPath) {
      updatedProfile.profileImage = uploadedPath;
    }

    await kv.set(`auth:user:${userId}`, updatedProfile);
    if (typeof updatedProfile.email === "string" && updatedProfile.email.trim()) {
      const emailKey = updatedProfile.email.trim().toLowerCase();
      await kv.set(`user:${emailKey}`, { ...updatedProfile, password: (p as { password?: unknown }).password });
      await kv.set(`userId:${userId}`, { email: emailKey });
    }
    console.log(`✅ KV profile updated successfully`);

    const prevImg = typeof p.profileImage === "string" ? p.profileImage.trim() : "";
    if (shouldClearImage && prevImg) {
      await deleteOwnedStorageRefs(supabaseAdmin, [prevImg]);
    } else if (uploadedPath && prevImg && prevImg !== uploadedPath) {
      await deleteOwnedStorageRefs(supabaseAdmin, [prevImg]);
    }

    if (typeof updatedProfile.profileImage === "string" && updatedProfile.profileImage.trim()) {
      const signedUrl = await getSignedImageUrl(String(updatedProfile.profileImage).trim());
      if (signedUrl) {
        updatedProfile.profileImageUrl = signedUrl;
      }
    } else {
      delete updatedProfile.profileImageUrl;
    }

    const actorId = typeof updatedBy === "string" && updatedBy.trim() ? updatedBy.trim() : userId;
    const targetName = String(updatedProfile.name || "").trim();
    const targetEmail = String(updatedProfile.email || "").trim();
    const targetLabel = String(targetName || targetEmail || userId).slice(0, 120);
    const detailParts: string[] = [];
    const prevRole = String(p.role || "").trim();
    const nextRole = String(updatedProfile.role || "").trim();
    if (prevRole !== nextRole) {
      detailParts.push(
        formatUserAuditDetail({
          name: targetName,
          email: targetEmail,
          role: nextRole,
        })
      );
    }
    const prevStatus = String((p as { status?: unknown }).status || "").trim().toLowerCase();
    const nextStatus = String(updatedProfile.status || "").trim().toLowerCase();
    if (prevStatus !== nextStatus && nextStatus) {
      detailParts.push(
        [targetLabel, formatAuditStatusLabel(nextStatus)].filter(Boolean).join(" | ")
      );
    }
    const prevName = String(p.name || "").trim();
    const nextName = String(updatedProfile.name || "").trim();
    if (prevName !== nextName && nextName) {
      detailParts.push(formatUserAuditDetail({ name: nextName, email: targetEmail, role: nextRole }));
    }
    const prevEmail = String(p.email || "").trim().toLowerCase();
    const nextEmail = String(updatedProfile.email || "").trim().toLowerCase();
    if (prevEmail !== nextEmail && nextEmail) {
      detailParts.push(formatUserAuditDetail({ name: targetName, email: nextEmail, role: nextRole }));
    }
    if (detailParts.length === 0) {
      detailParts.push(targetLabel);
    }
    await appendStaffActivity(actorId, {
      type: "user_updated",
      action: "User updated",
      detail: detailParts.join(" · "),
    });

    return c.json({ success: true, user: updatedProfile });
  } catch (error: any) {
    console.error("❌ Update user error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// DELETE USER
// ============================================
authApp.delete("/user/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    const deletedBy = String(c.req.query("deletedBy") || "").trim();

    const profile = await kv.get(`auth:user:${userId}`);
    if (!profile) {
      return c.json({ error: "User not found" }, 404);
    }

    const profileRole = String((profile as { role?: string }).role || "").trim();
    if (profileRole === "super-admin" || profileRole === "store-owner") {
      const blockedName = String(
        (profile as { name?: string }).name || (profile as { email?: string }).email || userId
      ).slice(0, 120);
      const blockedMail = String((profile as { email?: string }).email || "").slice(0, 120);
      await appendStaffActivity(deletedBy || undefined, {
        type: "admin_action",
        action: "User delete blocked",
        detail: formatUserAuditDetail({
          name: blockedName,
          email: blockedMail,
          role: profileRole,
        }),
      });
      return c.json({ error: "Cannot delete owner-level account" }, 400);
    }

    // Delete from Supabase Auth
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("Error deleting user from auth:", error);
    }

    // Delete from KV
    await kv.del(`auth:user:${userId}`);

    // Remove from users list
    const userIds = (await kv.get("auth:users-list")) || [];
    const filtered = userIds.filter((id: string) => id !== userId);
    await kv.set("auth:users-list", filtered);

    const staffImg =
      profile && typeof (profile as { profileImage?: string }).profileImage === "string"
        ? (profile as { profileImage: string }).profileImage.trim()
        : "";
    if (staffImg) {
      await deleteOwnedStorageRefs(supabaseAdmin, [staffImg]);
    }

    console.log(`✅ User deleted: ${profile.email}`);
    const deletedName = String(
      (profile as { name?: string }).name || (profile as { email?: string }).email || userId
    ).slice(0, 120);
    const deletedMail = String((profile as { email?: string }).email || "").slice(0, 120);
    await appendStaffActivity(deletedBy || undefined, {
      type: "user_deleted",
      action: "User deleted",
      detail: formatUserAuditDetail({
        name: deletedName,
        email: deletedMail,
        role: profileRole,
      }),
    });

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete user error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// RESET PASSWORD (generate new temp password)
// ============================================
authApp.post("/reset-password/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    let resetBy = "";
    try {
      const body = await c.req.json();
      resetBy = typeof body?.resetBy === "string" ? body.resetBy.trim() : "";
    } catch {
      resetBy = "";
    }

    const profile = await kv.get(`auth:user:${userId}`);
    if (!profile) {
      return c.json({ error: "User not found" }, 404);
    }

    // Generate new temp password
    const tempPassword = generatePassword();

    await setStaffPassword(profile as StaffKvUser, tempPassword, true);

    // Best-effort Supabase Auth sync when configured
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });
    if (error) {
      console.warn("Supabase Auth password reset skipped:", error.message);
    }

    const updatedProfile = await kv.get(`auth:user:${userId}`);

    console.log(`✅ Password reset for: ${(profile as StaffKvUser).email}`);
    await appendStaffActivity(resetBy || undefined, {
      type: "password_reset",
      action: "Password reset",
      detail: formatUserAuditDetail({
        name: (profile as { name?: string }).name,
        email: (profile as { email?: string }).email,
        role: (profile as { role?: string }).role,
      }),
    });

    return c.json({
      success: true,
      tempPassword, // Return so admin can share it
    });
  } catch (error: any) {
    console.error("Reset password error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// SEND EMAIL OTP (for password reset)
// ============================================
authApp.post("/send-email-otp", async (c) => {
  try {
    const { email, accountHint } = await c.req.json();

    if (!email) {
      return c.json({ error: "Email is required" }, 400);
    }

    const normalizedHint = String(accountHint || "auto").trim().toLowerCase() as PasswordResetAccountHint;
    const allowedHints = new Set(["auto", "staff", "vendor", "customer_kv", "cloudbase"]);
    const hint: PasswordResetAccountHint = allowedHints.has(normalizedHint)
      ? normalizedHint
      : "auto";

    console.log(`📧 Generating OTP for email: ${email} (hint=${hint})`);

    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (hint === "vendor") {
      const vendorLookup = await findVendorAuthByEmail(normalizedEmail);
      if (vendorLookup?.needsSetup) {
        return c.json({
          error: "Please complete vendor setup first to set your initial password.",
          needsSetup: true,
        }, 400);
      }
    }

    const account = await resolvePasswordResetAccount(normalizedEmail, hint);

    if (!account?.userId) {
      console.log(`❌ No user found with email: ${email}`);
      if (hint === "auto") {
        const staffUser = await findStaffUserByEmail(normalizedEmail);
        const vendorLookup = await findVendorAuthByEmail(normalizedEmail);
        if (staffUser?.id && vendorLookup?.id && !vendorLookup.needsSetup) {
          return c.json(
            {
              error:
                "This email is linked to both a super-admin/staff account and a vendor shop account. Use Forgot Password from the login page you normally use (platform admin vs vendor admin).",
              code: "AMBIGUOUS_EMAIL",
              availableAccounts: ["staff", "vendor"],
            },
            409,
          );
        }
      }
      const notFoundMessage =
        hint === "vendor"
          ? "No vendor account found with this email, or the account is not active yet."
          : hint === "staff"
            ? "No super-admin or staff account found with this email."
          : "This email is not registered. Use the email from admin setup, or contact your administrator.";
      return c.json({ error: notFoundMessage }, 404);
    }

    const userId = account.userId;
    console.log(`✅ User found: ${userId} (${email}, kind=${account.kind})`);

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    await clearPasswordResetOtpsForEmail(normalizedEmail, account.kind);

    const otpKey = otpStorageKey(normalizedEmail, account.kind);
    await kv.set(otpKey, {
      code: otp,
      expiresAt,
      userId,
      accountKind: account.kind,
      createdAt: new Date().toISOString(),
    });

    console.log(`📧 OTP stored for ${email} (expires in 10 minutes)`);

    // Send email via Tencent SES
    try {
      const sesConfig = readSesConfig();

      if (!sesConfig) {
        console.error("Tencent SES not configured — cannot send password reset email");
        return c.json({
          emailSent: false,
          deliveryConfigured: false,
          error:
            "Password reset email is not configured on the server. Ask an admin to reset your password from Settings → Users.",
        }, 503);
      }

      const fromBuilt = buildSesFromAddress(sesConfig.fromEmail, sesConfig.fromName);
      if ("error" in fromBuilt) {
        console.error("❌ Invalid TENCENT_SES_FROM_EMAIL:", fromBuilt.error);
        return c.json({
          emailSent: false,
          deliveryConfigured: true,
          error: fromBuilt.error,
          email_error: fromBuilt.error,
        }, 503);
      }

      const sendResult = await sendPasswordResetOtpEmail({
        config: sesConfig,
        from: fromBuilt.from,
        to: email,
        otp,
      });

      console.log(`✅ Email sent successfully via Tencent SES:`, sendResult.messageId);

      return c.json({
        success: true,
        emailSent: true,
        deliveryConfigured: true,
        accountKind: account.kind,
        message: "Password reset code sent to your email",
      });
    } catch (emailError: any) {
      console.error('Email sending error:', emailError);
      return c.json({
        emailSent: false,
        deliveryConfigured: true,
        error: emailError?.message || "Failed to send password reset email. Please try again later.",
        email_error: emailError?.message || "Unknown email error",
      }, 502);
    }
  } catch (error: any) {
    console.error("Send email OTP error:", error);
    return c.json({ error: error.message || "Failed to send OTP" }, 500);
  }
});

// ============================================
// VERIFY OTP AND UPDATE PASSWORD
// ============================================
authApp.post("/verify-otp-and-reset", async (c) => {
  try {
    const { email, otp, newPassword, accountHint } = await c.req.json();

    if (!email || !otp || !newPassword) {
      return c.json({ error: "Email, OTP, and new password are required" }, 400);
    }

    if (String(newPassword).length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }

    const normalizedHint = String(accountHint || "auto").trim().toLowerCase() as PasswordResetAccountHint;
    const allowedHints = new Set(["auto", "staff", "vendor", "customer_kv", "cloudbase"]);
    const hint: PasswordResetAccountHint = allowedHints.has(normalizedHint)
      ? normalizedHint
      : "auto";

    console.log(`🔐 Verifying OTP for: ${email} (hint=${hint})`);

    const normalizedEmail = email.toLowerCase().trim();
    const { data: storedOtpData, key: otpKey } = await loadStoredPasswordResetOtp(normalizedEmail, hint);

    if (!storedOtpData || !otpKey) {
      console.log(`❌ No OTP found for: ${normalizedEmail}`);
      if (hint === "auto") {
        let scopedCount = 0;
        for (const kind of ["staff", "vendor", "customer_kv", "cloudbase"] as PasswordResetAccountKind[]) {
          if (await kv.get(otpStorageKey(normalizedEmail, kind))) scopedCount += 1;
        }
        if (scopedCount > 1) {
          return c.json(
            {
              error:
                "Multiple reset codes exist for this email. Request a new code from the login page you use (super-admin vs vendor).",
              code: "AMBIGUOUS_EMAIL",
            },
            409,
          );
        }
      }
      return c.json({ error: "OTP not found or expired. Please request a new code." }, 404);
    }

    const storedKind = String(storedOtpData.accountKind || "").trim() as PasswordResetAccountKind;
    if (
      hint !== "auto" &&
      storedKind &&
      storedKind !== hint
    ) {
      return c.json(
        {
          error:
            "This reset code was issued for a different account type. Request a new code from the correct login page (super-admin vs vendor).",
          code: "ACCOUNT_HINT_MISMATCH",
        },
        409,
      );
    }

    if (Date.now() > Number(storedOtpData.expiresAt || 0)) {
      console.log(`⏰ OTP expired for: ${normalizedEmail}`);
      await kv.del(otpKey);
      return c.json({ error: "OTP has expired. Please request a new code." }, 400);
    }

    const submittedOtp = String(otp || "").trim();
    if (String(storedOtpData.code || "").trim() !== submittedOtp) {
      console.warn(`❌ Invalid OTP attempt for: ${normalizedEmail}`);
      return c.json({ error: "Invalid OTP code. Please check and try again." }, 400);
    }

    console.log(`✅ OTP verified for: ${normalizedEmail}`);

    const storedUserId = String(storedOtpData.userId || "").trim();
    if (!storedUserId) {
      return c.json({ error: "Invalid reset session. Please request a new code." }, 400);
    }

    let accountKind = storedKind as PasswordResetAccountKind | undefined;
    if (!accountKind) {
      const staffProfile = await kv.get(`auth:user:${storedUserId}`);
      if (isStaffKvProfile(staffProfile)) {
        accountKind = "staff";
      } else {
        const vendorRec = await kv.get(`vendor:${storedUserId}`);
        if (vendorRec && typeof vendorRec === "object") {
          accountKind = "vendor";
        } else {
          const customerRec = await kv.get(`customer_auth:${storedUserId}`);
          accountKind = customerRec && typeof customerRec === "object" ? "customer_kv" : "cloudbase";
        }
      }
    }

    const clearOtp = async () => {
      await kv.del(otpKey);
      if (otpKey !== legacyOtpStorageKey(normalizedEmail)) {
        await kv.del(legacyOtpStorageKey(normalizedEmail));
      }
    };

    if (accountKind === "vendor") {
      const fullVendor = (await kv.get(`vendor:${storedUserId}`)) as Record<string, unknown> | null;
      if (!fullVendor?.id || String(fullVendor.id) !== storedUserId) {
        return c.json({ error: "Vendor account not found" }, 404);
      }
      const passwordHash = await hashPasswordPlain(newPassword);
      const updatedVendor = {
        ...fullVendor,
        password: passwordHash,
        updatedAt: new Date().toISOString(),
      };
      await kv.set(`vendor:${storedUserId}`, updatedVendor);
      queueVendorReadModelSync(String(storedUserId), updatedVendor);
      await clearOtp();
      console.log(`✅ Vendor password updated for: ${normalizedEmail}`);
      return c.json({
        success: true,
        message: "Password updated successfully",
        accountKind: "vendor",
      });
    }

    if (accountKind === "staff") {
      const staffById = (await kv.get(`auth:user:${storedUserId}`)) as StaffKvUser | null;
      const staffUser = isStaffKvProfile(staffById) ? staffById : await findStaffUserByEmail(normalizedEmail);
      if (!staffUser?.id || String(staffUser.id) !== storedUserId) {
        return c.json({ error: "Staff account not found" }, 404);
      }
      await setStaffPassword(staffUser, newPassword, false);
      await clearOtp();
      console.log(`✅ KV staff password updated for: ${normalizedEmail}`);
      return c.json({
        success: true,
        message: "Password updated successfully",
        accountKind: "staff",
      });
    }

    if (accountKind === "customer_kv") {
      const customerRec = (await kv.get(`customer_auth:${storedUserId}`)) as CustomerAuthRecord | null;
      if (!customerRec?.id) {
        return c.json({ error: "Customer account not found" }, 404);
      }
      await setCustomerAuthPassword(customerRec, newPassword);
      await clearOtp();
      console.log(`✅ KV customer password updated for: ${normalizedEmail}`);
      return c.json({
        success: true,
        message: "Password updated successfully",
        accountKind: "customer_kv",
      });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      storedUserId,
      { password: newPassword }
    );

    if (error) {
      console.error("Error updating password:", error);
      return c.json({ error: "Failed to update password: " + error.message }, 500);
    }

    await clearOtp();

    console.log(`✅ Password updated successfully for: ${normalizedEmail}`);

    return c.json({
      success: true,
      message: "Password updated successfully",
      accountKind: "cloudbase",
    });
  } catch (error: any) {
    console.error("Verify OTP error:", error);
    return c.json({ error: error.message || "Failed to verify OTP" }, 500);
  }
});

// ============================================
// DEBUG: LIST ALL REGISTERED EMAILS (for password reset)
// ============================================
authApp.get("/list-emails", async (c) => {
  try {
    console.log("📧 Listing all registered emails...");
    
    const { data: authUsers, error } = await supabaseAdmin.auth.admin.listUsers();

    if (error) {
      console.error("Error listing users:", error);
      return c.json({ error: error.message }, 500);
    }

    const emails = authUsers.users.map(u => ({
      email: u.email,
      role: u.user_metadata?.role || 'N/A',
      created: u.created_at,
    }));

    console.log(`📊 Found ${emails.length} registered emails`);

    return c.json({
      success: true,
      total: emails.length,
      emails: emails,
    });
  } catch (error: any) {
    console.error("List emails error:", error);
    return c.json({ error: error.message }, 500);
  }
});

function buildStaffLoginPayload(staffUser: Record<string, unknown>) {
  const { password: _password, ...safeUser } = staffUser;
  return {
    id: String(safeUser.id || ""),
    email: String(safeUser.email || "").trim().toLowerCase(),
    name: String(safeUser.name || ""),
    role: String(safeUser.role || ""),
    phone: safeUser.phone,
    tempPassword: Boolean(safeUser.tempPassword),
    storeId: safeUser.storeId,
    profileImage: safeUser.profileImage,
    profileImageUrl: safeUser.profileImageUrl,
    createdAt: safeUser.createdAt,
    updatedAt: safeUser.updatedAt,
  };
}

// ============================================
// ADMIN PORTAL: STAFF LOGIN (owner / administrators)
// ============================================
authApp.post("/staff/login", async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    const staffResult = await tryStaffLogin(email, password);
    if (!staffResult) {
      return c.json({ error: "Invalid email or password" }, 401);
    }
    if ("error" in staffResult) {
      return c.json({ error: staffResult.error }, 401);
    }

    const user = buildStaffLoginPayload(staffResult.user);
    if (!user.id) {
      return c.json({ error: "Invalid staff account" }, 401);
    }

    console.log(`✅ Staff login successful: ${user.email} (${user.role})`);

    return c.json({
      success: true,
      user,
    });
  } catch (error: any) {
    console.error("Staff login error:", error);
    return c.json({ error: error.message || "Login failed" }, 500);
  }
});

// ============================================
// STOREFRONT: LOGIN (for customers)
// ============================================
authApp.post("/login", async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email or phone and password are required" }, 400);
    }

    const emailLower = String(email || "").trim().toLowerCase();

    console.log(`🔐 Customer login attempt: ${email}`);

    const authenticated = await authenticateStorefrontCustomer(email, password);
    if (!authenticated) {
      const staffUser = await findStaffUserByEmail(emailLower);
      if (staffUser?.id && staffUser.password) {
        const staffOk = await verifyPasswordPlain(password, staffUser.password);
        if (staffOk) {
          return c.json(
            {
              error:
                "This account is for staff. Sign in through the admin portal. To shop here, register a separate customer account.",
              code: "STAFF_NOT_STOREFRONT",
            },
            403
          );
        }
      }

      return c.json({ error: "Invalid email or password" }, 401);
    }

    const { authUser, loginEmail, authSession } = authenticated;
    console.log(`✅ Auth successful for ${email} → ${loginEmail}, user ID: ${authUser.id}`);

    // Find or create customer record
    let customer = null;
    
    // Try to find existing customer by userId
    customer = await findStorefrontCustomerByUserId(authUser.id);
    let allCustomers: any[] | null = null;
    if (!customer) {
      allCustomers = await withTimeout(kv.getByPrefix("customer:"), 30000);
      customer = Array.isArray(allCustomers)
        ? allCustomers.find((c: any) => c != null && c.userId === authUser!.id)
        : null;
    }

    // If no customer found, create one
    if (!customer) {
      console.log(`📝 Creating new customer record for user: ${authUser.id}`);
      
      const customerId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const userName = authUser.user_metadata?.name || loginEmail.split('@')[0];
      const loginPhone = normalizeMyanmarPhone(String(email || ""));
      const userPhoneRaw = authUser.user_metadata?.phone || loginPhone || "";
      const userPhone = normalizeMyanmarPhone(String(userPhoneRaw)) || String(userPhoneRaw).trim();
      const profileImage = authUser.user_metadata?.profileImage || null;
      const displayEmail = isSyntheticAuthEmail(loginEmail) ? "" : loginEmail;
      
      // 🔥 CHECK FOR DUPLICATE EMAIL (should never happen since auth succeeded, but double-check)
      const duplicateEmail = displayEmail
        ? await findCustomerByEmailFromReadModel(displayEmail)
        : null;
      const duplicateEmailConflict =
        duplicateEmail && duplicateEmail.userId !== authUser.id
          ? duplicateEmail
          : null;
      
      if (duplicateEmailConflict) {
        console.error(`❌ CRITICAL: Customer with email ${displayEmail} already exists but has different userId!`);
        console.error(`   Existing customer: ${duplicateEmailConflict.id} (userId: ${duplicateEmailConflict.userId})`);
        console.error(`   Current auth user: ${authUser.id}`);
        return c.json({ 
          error: "Account conflict detected. Please contact support.",
          details: "Another customer account is using this email address."
        }, 409);
      }
      
      // 🔥 CHECK FOR DUPLICATE PHONE (if phone is provided)
      if (userPhone && userPhone.trim() !== "") {
        const normalizedPhone = normalizeMyanmarPhone(userPhone) || userPhone.replace(/\s+/g, '');
        const duplicatePhone = await findCustomerByPhone(normalizedPhone);
        const duplicatePhoneConflict =
          duplicatePhone && duplicatePhone.userId !== authUser.id ? duplicatePhone : null;
        
        if (duplicatePhoneConflict) {
          console.error(`❌ Phone number ${userPhone} is already registered to another customer: ${duplicatePhoneConflict.id}`);
          return c.json({ 
            error: "This phone number is already registered to another account.",
            details: `Phone ${userPhone} is already in use.`
          }, 409);
        }
      }
      
      customer = {
        id: customerId,
        userId: authUser.id,
        name: userName,
        email: displayEmail,
        phone: userPhone,
        location: "",
        address: "",
        city: "",
        region: "",
        status: "active",
        tier: "new",
        avatar: profileImage 
          ? await getSignedImageUrl(profileImage) || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(userName)}`
          : `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(userName)}`,
        joinDate: new Date().toISOString().split('T')[0],
        totalOrders: 0,
        totalSpent: 0,
        lastVisit: new Date().toISOString().split('T')[0],
        avgOrderValue: 0,
        tags: ["new-customer"],
        engagementScore: 0,
        lifetimeValue: 0,
        rfmScore: {
          recency: 5,
          frequency: 1,
          monetary: 1,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await withTimeout(kv.set(`customer:${customerId}`, customer), 5000);
      queueCustomerReadModelSync(customerId, customer);
      console.log(`✅ Customer record created: ${customerId}`);
    } else {
      customer = await enrichCustomerFromAuthUser(customer, authUser);
      // Update last visit
      customer.lastVisit = new Date().toISOString().split('T')[0];
      customer.updatedAt = new Date().toISOString();
      await withTimeout(kv.set(`customer:${customer.id}`, customer), 5000);
      queueCustomerReadModelSync(String(customer.id), customer);
      console.log(`✅ Customer record updated: ${customer.id}`);
    }

    // Prepare user object for frontend - IMPORTANT: Ensure id is the Supabase userId (UUID)
    // so profile fetching works correctly. Store the customerId separately.
    const userResponse = buildStorefrontUserResponse(
      customer,
      authUser.id,
      String(authUser.email || "").trim().toLowerCase()
    );

    return c.json({
      success: true,
      user: userResponse,
      session: {
        access_token: authSession?.access_token,
        refresh_token: authSession?.refresh_token,
      },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    return c.json({ error: error.message || "Login failed" }, 500);
  }
});

// ============================================
// UPLOAD CUSTOMER PROFILE IMAGE (multipart — avoids JSON body size limits)
// ============================================
authApp.post("/customer/:userId/profile-image", async (c) => {
  try {
    const userId = c.req.param("userId").trim();
    if (!userId) {
      return c.json({ error: "userId required" }, 400);
    }

    const customer = await findStorefrontCustomerByUserId(userId);
    if (!customer?.id) {
      return c.json({ error: "Customer not found" }, 404);
    }

    const formData = await c.req.formData();
    const imageFile = formData.get("image") as File | null;
    if (!imageFile || typeof imageFile.arrayBuffer !== "function") {
      return c.json({ error: "No image file provided" }, 400);
    }

    if (imageFile.size / 1024 > 600) {
      return c.json({ error: "Image file too large. Maximum size is 500KB" }, 400);
    }

    const uploadedPath = await uploadProfileImageFile(userId, imageFile);
    if (!uploadedPath) {
      return c.json({ error: "Failed to upload profile image" }, 500);
    }

    const prevImg =
      typeof customer.profileImage === "string"
        ? customer.profileImage.trim()
        : "";

    const signedUrl =
      (await getSignedImageUrl(uploadedPath)) ||
      `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(String(customer.name || userId))}`;

    const updatedCustomer = {
      ...customer,
      profileImage: uploadedPath,
      avatar: signedUrl,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`customer:${customer.id}`, updatedCustomer);
    queueCustomerReadModelSync(String(customer.id), updatedCustomer);

    if (prevImg && prevImg !== uploadedPath) {
      await deleteOwnedStorageRefs(supabaseAdmin, [prevImg]);
    }

    const userResponse = buildStorefrontUserResponse(
      updatedCustomer,
      userId,
      String(customer.email || "").trim().toLowerCase()
    );
    if (signedUrl) {
      (userResponse as Record<string, unknown>).profileImageUrl = signedUrl;
    }

    return c.json({
      success: true,
      profileImage: uploadedPath,
      profileImageUrl: signedUrl,
      user: userResponse,
    });
  } catch (error: any) {
    console.error("❌ Customer profile image upload error:", error);
    return c.json({ error: error.message || "Failed to upload profile image" }, 500);
  }
});

// ============================================
// STOREFRONT: REGISTER (for customers)
// ============================================
authApp.post("/register", async (c) => {
  try {
    const { email, password, name, phone, profileImage } = await c.req.json();

    if (!password || !name || !phone?.trim()) {
      return c.json({ error: "Phone number, password, and name are required" }, 400);
    }

    const normalizedPhone = normalizeMyanmarPhone(phone);
    if (!normalizedPhone) {
      return c.json({
        error: "Phone must be Myanmar format: +959XXXXXXXXX (12 digits) or 09XXXXXXXXX (11 digits)",
      }, 400);
    }

    const emailTrimmed = String(email || "").trim();
    let authEmail = emailTrimmed;
    let displayEmail = emailTrimmed;

    if (emailTrimmed) {
      const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(emailTrimmed)) {
        return c.json({ error: "Please enter a valid email address (e.g., name@example.com)" }, 400);
      }
    } else {
      authEmail = phoneToAuthEmail(normalizedPhone);
      displayEmail = "";
    }

    console.log(`📝 Customer registration attempt: phone=${normalizedPhone} authEmail=${authEmail}`);

    const allCustomers = await withTimeout(kv.getByPrefix("customer:"), 30000);

    const duplicatePhone = await findCustomerByPhone(normalizedPhone);
    if (duplicatePhone) {
      console.log(`❌ Phone number already registered: ${normalizedPhone}`);
      return c.json({
        error: "This phone number is already registered. Please sign in or use a different number.",
      }, 409);
    }

    if (displayEmail) {
      if (await authUserExistsByEmail(displayEmail)) {
        console.log(`❌ Email already registered: ${displayEmail}`);
        return c.json({
          error: "This email is already registered. Please use a different email or sign in instead.",
        }, 409);
      }

      const duplicateEmail = Array.isArray(allCustomers)
        ? allCustomers.find(
            (cust: any) =>
              cust != null &&
              cust.email &&
              !isSyntheticAuthEmail(cust.email) &&
              cust.email.toLowerCase() === displayEmail.toLowerCase()
          )
        : null;

      if (duplicateEmail) {
        console.log(`❌ Email already exists in customer records: ${displayEmail}`);
        return c.json({
          error: "This email is already registered. Please use a different email or sign in instead.",
        }, 409);
      }
    } else if (await authUserExistsByEmail(authEmail)) {
      return c.json({
        error: "This phone number is already registered. Please sign in instead.",
      }, 409);
    }

    let authAccount: { userId: string; provider: "cloudbase" | "kv" };
    try {
      authAccount = await createStorefrontAuthUser({
        authEmail: authEmail.toLowerCase(),
        password,
        name,
        phone: normalizedPhone,
      });
    } catch (regErr: unknown) {
      const msg = regErr instanceof Error ? regErr.message : "Registration failed";
      console.error(`❌ Registration failed for ${authEmail}:`, regErr);
      return c.json({ error: msg }, 500);
    }

    console.log(`✅ Auth user created (${authAccount.provider}): ${authAccount.userId}`);

    // Upload profile image if provided (small data URLs only — large images use multipart endpoint)
    let uploadedImagePath = null;
    if (profileImage && typeof profileImage === "string" && profileImage.startsWith("data:image/")) {
      if (profileImage.length <= 450_000) {
        uploadedImagePath = await uploadProfileImage(authAccount.userId, profileImage);
      } else {
        console.warn(
          "[auth] profileImage skipped in register JSON — use POST /auth/customer/:userId/profile-image"
        );
      }
    }

    // Create customer record
    const customerId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const customer = {
      id: customerId,
      userId: authAccount.userId,
      name: name,
      email: displayEmail,
      phone: normalizedPhone,
      location: "",
      address: "",
      city: "",
      region: "",
      status: "active",
      tier: "new",
      avatar: uploadedImagePath
        ? await getSignedImageUrl(uploadedImagePath) || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(name)}`
        : `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(name)}`,
      joinDate: new Date().toISOString().split('T')[0],
      totalOrders: 0,
      totalSpent: 0,
      lastVisit: new Date().toISOString().split('T')[0],
      avgOrderValue: 0,
      tags: ["new-customer"],
      engagementScore: 0,
      lifetimeValue: 0,
      rfmScore: {
        recency: 5,
        frequency: 1,
        monetary: 1,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await withTimeout(kv.set(`customer:${customerId}`, customer), 5000);
    queueCustomerReadModelSync(customerId, customer);
    console.log(`✅ Customer record created: ${customerId}`);

    // Prepare user object for frontend - IMPORTANT: Ensure id is the Supabase userId (UUID)
    // so profile fetching works correctly. Store the customerId separately.
    const userResponse = buildStorefrontUserResponse(
      customer,
      authAccount.userId,
      authEmail.toLowerCase()
    );

    return c.json({
      success: true,
      user: userResponse,
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    return c.json({ error: error.message || "Registration failed" }, 500);
  }
});

// Aggregated staff actions — reads single global feed (cheap); ?since= for incremental poll
authApp.get("/staff-activities", async (c) => {
  try {
    const since = String(c.req.query("since") || "").trim();
    const activities = await getGlobalStaffActivityFeed(since || undefined);
    return c.json({ activities });
  } catch (error: any) {
    console.error("staff-activities GET:", error);
    return c.json({ activities: [] });
  }
});

// Clear all staff activity logs — store owner / super-admin only (for fresh testing)
authApp.delete("/staff-activities", async (c) => {
  try {
    const clearedBy = String(c.req.query("clearedBy") || "").trim();
    if (!isValidStaffActorId(clearedBy)) {
      return c.json({ error: "Invalid actor" }, 400);
    }

    const profile = await kv.get(`auth:user:${clearedBy}`);
    if (!profile || typeof profile !== "object") {
      return c.json({ error: "Unauthorized" }, 403);
    }

    const role = String((profile as { role?: string }).role || "").trim();
    if (!OWNER_ROLES.has(role)) {
      return c.json({ error: "Only store owner can clear activity log" }, 403);
    }

    const deletedKeys = await clearAllStaffActivities();
    return c.json({ success: true, deletedKeys });
  } catch (error: any) {
    console.error("staff-activities DELETE:", error);
    return c.json({ error: error.message || "Failed to clear activities" }, 500);
  }
});

// Recent staff actions (product create/update/delete) for profile timeline
authApp.get("/staff-activity/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    if (!isValidStaffActorId(userId)) {
      return c.json({ activities: [] });
    }
    const data = await kv.get(`staff:activity:${userId.trim()}`);
    const activities = Array.isArray(data) ? data : [];
    return c.json({ activities });
  } catch (error: any) {
    console.error("staff-activity GET:", error);
    return c.json({ activities: [] });
  }
});

export default authApp;