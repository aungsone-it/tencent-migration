/** Tencent Cloud SES (Simple Email Service) — password reset OTP and transactional mail. */

import crypto from "node:crypto";

const EMAIL_ADDR_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SES_API_VERSION = "2020-10-02";
const SES_SERVICE = "ses";

export type SesConfig = {
  secretId: string;
  secretKey: string;
  region: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  /** Approved SES template ID (required — inline HTML is not permitted on most accounts). */
  passwordResetTemplateId?: number;
  /** Template variable name for the OTP, must match {{otp_code}} (or similar) in the SES template. */
  passwordResetTemplateOtpVar: string;
};

export type SesFromAddress = { from: string } | { error: string };

function stripEnvQuotes(value: string): string {
  const v = String(value || "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function sha256Hex(message: string): string {
  return crypto.createHash("sha256").update(message, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, message: string): Buffer {
  return crypto.createHmac("sha256", key).update(message, "utf8").digest();
}

function resolveSesRegion(): string {
  return (
    String(Deno.env.get("TENCENT_SES_REGION") || "").trim() ||
    String(Deno.env.get("CLOUDBASE_REGION") || "").trim() ||
    "ap-singapore"
  );
}

/** Build SES `FromEmailAddress` — plain email or full `Name <email@domain>`. */
export function buildSesFromAddress(fromEmailRaw: string, fromNameRaw: string): SesFromAddress {
  const fromEmail = stripEnvQuotes(fromEmailRaw);
  const fromName = stripEnvQuotes(fromNameRaw);

  const namedMatch = fromEmail.match(/^(.+?)\s*<([^<>]+)>$/);
  if (namedMatch) {
    const addr = namedMatch[2].trim();
    if (!EMAIL_ADDR_RE.test(addr)) {
      return { error: `Invalid TENCENT_SES_FROM_EMAIL address: ${addr}` };
    }
    return { from: fromEmail };
  }

  const plainEmail = fromEmail.replace(/^<|>$/g, "").trim();
  if (EMAIL_ADDR_RE.test(plainEmail)) {
    const safeName = (fromName || "Nexa Marketplace").replace(/[<>]/g, "").trim();
    return { from: `${safeName} <${plainEmail}>` };
  }

  return {
    error:
      "Invalid TENCENT_SES_FROM_EMAIL. Set a plain address like noreply@yourdomain.com (recommended), not only a display name.",
  };
}

export function readSesConfig(): SesConfig | null {
  const secretId = stripEnvQuotes(String(Deno.env.get("TENCENT_SECRET_ID") || ""));
  const secretKey = stripEnvQuotes(String(Deno.env.get("TENCENT_SECRET_KEY") || ""));
  const fromEmail = stripEnvQuotes(String(Deno.env.get("TENCENT_SES_FROM_EMAIL") || ""));
  const fromName = stripEnvQuotes(String(Deno.env.get("TENCENT_SES_FROM_NAME") || "Nexa Marketplace"));
  const replyTo = stripEnvQuotes(String(Deno.env.get("TENCENT_SES_REPLY_TO") || ""));
  const templateIdRaw = stripEnvQuotes(String(Deno.env.get("TENCENT_SES_PASSWORD_RESET_TEMPLATE_ID") || ""));
  const templateId = templateIdRaw ? Number(templateIdRaw) : undefined;
  const passwordResetTemplateOtpVar = stripEnvQuotes(
    String(Deno.env.get("TENCENT_SES_TEMPLATE_OTP_VAR") || "otp_code"),
  );

  if (!secretId || !secretKey || !fromEmail) return null;

  return {
    secretId,
    secretKey,
    region: resolveSesRegion(),
    fromEmail,
    fromName,
    replyTo: replyTo || undefined,
    passwordResetTemplateId: Number.isFinite(templateId) ? templateId : undefined,
    passwordResetTemplateOtpVar,
  };
}

export function validateSesConfig(config: SesConfig | null): string[] {
  const issues: string[] = [];
  if (!config) {
    issues.push("Missing TENCENT_SECRET_ID");
    issues.push("Missing TENCENT_SECRET_KEY");
    issues.push("Missing TENCENT_SES_FROM_EMAIL");
    return issues;
  }
  if (!config.secretId) issues.push("Missing TENCENT_SECRET_ID");
  if (!config.secretKey) issues.push("Missing TENCENT_SECRET_KEY");
  if (!config.fromEmail) issues.push("Missing TENCENT_SES_FROM_EMAIL");
  const fromBuilt = buildSesFromAddress(config.fromEmail, config.fromName);
  if ("error" in fromBuilt) issues.push(fromBuilt.error);
  if (!config.passwordResetTemplateId) {
    issues.push("Missing TENCENT_SES_PASSWORD_RESET_TEMPLATE_ID (approved SES template required)");
  }
  return issues;
}

async function signedSesRequest(
  config: SesConfig,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  const host = `${SES_SERVICE}.${config.region}.tencentcloudapi.com`;
  const endpoint = `https://${host}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payloadStr = JSON.stringify(payload);
  const hashedRequestPayload = sha256Hex(payloadStr);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join("\n");
  const credentialScope = `${date}/${SES_SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const secretDate = hmacSha256(`TC3${config.secretKey}`, date);
  const secretService = hmacSha256(secretDate, SES_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256(secretSigning, stringToSign).toString("hex");
  const authorization = [
    `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Version": SES_API_VERSION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": config.region,
      Authorization: authorization,
    },
    body: payloadStr,
  });

  let result: Record<string, unknown> = {};
  try {
    result = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `Tencent SES HTTP ${response.status}`, status: response.status || 502 };
  }

  const responseBody = (result.Response || result) as Record<string, unknown>;
  const apiError = responseBody?.Error as { Code?: string; Message?: string } | undefined;
  if (apiError?.Message) {
    const code = apiError.Code ? `${apiError.Code}: ` : "";
    return { ok: false, error: `${code}${apiError.Message}`, status: response.status || 502 };
  }
  if (!response.ok) {
    return { ok: false, error: `Tencent SES HTTP ${response.status}`, status: response.status || 502 };
  }

  return { ok: true, data: responseBody };
}

export async function sendSesTemplateEmail(params: {
  config: SesConfig;
  from: string;
  to: string[];
  subject: string;
  templateId: number;
  templateData: Record<string, string>;
  triggerType?: 0 | 1;
}): Promise<{ messageId: string }> {
  const payload: Record<string, unknown> = {
    FromEmailAddress: params.from,
    Destination: params.to,
    Subject: params.subject,
    Template: {
      TemplateID: params.templateId,
      TemplateData: JSON.stringify(params.templateData),
    },
    TriggerType: params.triggerType ?? 1,
  };
  if (params.config.replyTo) {
    payload.ReplyToAddresses = params.config.replyTo;
  }

  const result = await signedSesRequest(params.config, "SendEmail", payload);
  if (!result.ok) throw new Error(result.error);

  const messageId = String(result.data.MessageId || result.data.RequestId || "").trim();
  if (!messageId) throw new Error("Tencent SES did not return a MessageId");
  return { messageId };
}

/** Send password-reset OTP using an approved SES template (TemplateID + {{otp_code}}). */
export async function sendPasswordResetOtpEmail(params: {
  config: SesConfig;
  from: string;
  to: string;
  otp: string;
}): Promise<{ messageId: string }> {
  const templateId = params.config.passwordResetTemplateId;
  if (!templateId) {
    throw new Error("Missing TENCENT_SES_PASSWORD_RESET_TEMPLATE_ID");
  }
  const otpVar = params.config.passwordResetTemplateOtpVar || "otp_code";
  return sendSesTemplateEmail({
    config: params.config,
    from: params.from,
    to: [params.to],
    subject: "Password Reset Code - Nexa Marketplace",
    templateId,
    templateData: { [otpVar]: params.otp },
    triggerType: 1,
  });
}
