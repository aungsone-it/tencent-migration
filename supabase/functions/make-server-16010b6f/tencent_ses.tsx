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
    const safeName = (fromName || "Migoo Marketplace").replace(/[<>]/g, "").trim();
    return { from: `${safeName} <${plainEmail}>` };
  }

  return {
    error:
      "Invalid TENCENT_SES_FROM_EMAIL. Set a plain address like noreply@yourdomain.com (recommended), not only a display name.",
  };
}

export function readSesConfig(): SesConfig | null {
  const secretId = String(Deno.env.get("TENCENT_SECRET_ID") || "").trim();
  const secretKey = String(Deno.env.get("TENCENT_SECRET_KEY") || "").trim();
  const fromEmail = String(Deno.env.get("TENCENT_SES_FROM_EMAIL") || "").trim();
  const fromName = String(Deno.env.get("TENCENT_SES_FROM_NAME") || "Migoo Marketplace").trim();
  const replyTo = String(Deno.env.get("TENCENT_SES_REPLY_TO") || "").trim();

  if (!secretId || !secretKey || !fromEmail) return null;

  return {
    secretId,
    secretKey,
    region: resolveSesRegion(),
    fromEmail,
    fromName,
    replyTo: replyTo || undefined,
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
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, hashedRequestPayload].join("\n");
  const credentialScope = `${date}/${SES_SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const secretDate = hmacSha256(`TC3${config.secretKey}`, date);
  const secretService = hmacSha256(secretDate, SES_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256(secretSigning, stringToSign).toString("hex");
  const authorization = [
    "TC3-HMAC-SHA256",
    `Credential=${config.secretId}/${credentialScope}`,
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

export async function sendSesEmail(params: {
  config: SesConfig;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  triggerType?: 0 | 1;
}): Promise<{ messageId: string }> {
  const simple: Record<string, string> = {
    Html: Buffer.from(params.html, "utf8").toString("base64"),
  };
  if (params.text) {
    simple.Text = Buffer.from(params.text, "utf8").toString("base64");
  }

  const payload: Record<string, unknown> = {
    FromEmailAddress: params.from,
    Destination: params.to,
    Subject: params.subject,
    Simple: simple,
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

export function buildPasswordResetOtpEmailHtml(otp: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #0f172a; background: #f1f5f9; margin: 0; padding: 24px; }
      .container { max-width: 600px; margin: 0 auto; }
      .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08); }
      .header { background: linear-gradient(135deg, #1a1d29 0%, #0f172a 55%, #1e3a8a 100%); color: #ffffff; padding: 28px 30px; text-align: center; }
      .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.02em; }
      .content { padding: 32px 30px; color: #334155; }
      .content p { margin: 0 0 16px; }
      .otp-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px 20px; text-align: center; margin: 24px 0; }
      .otp-label { margin: 0; color: #64748b; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; }
      .otp-code { font-size: 36px; font-weight: 700; color: #0f172a; letter-spacing: 8px; margin: 12px 0; font-variant-numeric: tabular-nums; }
      .otp-expiry { margin: 0; color: #64748b; font-size: 13px; }
      .content ul { margin: 0 0 16px; padding-left: 20px; color: #475569; }
      .content li { margin-bottom: 6px; }
      .footer { text-align: center; margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }
      .footer p { margin: 0 0 6px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <div class="header">
          <h1>Password Reset</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>You requested to reset your password for your Migoo account. Use the verification code below:</p>
          <div class="otp-box">
            <p class="otp-label">Your verification code</p>
            <div class="otp-code">${otp}</div>
            <p class="otp-expiry">Valid for 10 minutes</p>
          </div>
          <p><strong>Important:</strong></p>
          <ul>
            <li>This code expires in <strong>10 minutes</strong></li>
            <li>Do not share this code with anyone</li>
            <li>If you didn't request this, please ignore this email</li>
          </ul>
          <div class="footer">
            <p>© 2026 Migoo Marketplace — Myanmar's Premier E-Commerce Platform</p>
            <p>This is an automated email, please do not reply.</p>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}
