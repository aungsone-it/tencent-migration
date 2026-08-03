/** Tencent Cloud SMS — registration OTP via approved template (SendSms API). */

import crypto from "node:crypto";

const SMS_API_VERSION = "2021-01-11";
const SMS_SERVICE = "sms";
const SMS_INTL_HOST = "sms.intl.tencentcloudapi.com";
const SMS_DOMESTIC_HOST = "sms.tencentcloudapi.com";

export type TencentSmsConfig = {
  secretId: string;
  secretKey: string;
  region: string;
  sdkAppId: string;
  signName: string;
  registerTemplateId: string;
  /** Optional Sender ID for international SMS (Global SMS). */
  senderId?: string;
  /** Use mainland China SMS endpoint when true (default: international). */
  useDomesticEndpoint: boolean;
};

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

function resolveSmsRegion(): string {
  return (
    stripEnvQuotes(String(Deno.env.get("TENCENT_SMS_REGION") || "")) ||
    stripEnvQuotes(String(Deno.env.get("TENCENT_SES_REGION") || "")) ||
    stripEnvQuotes(String(Deno.env.get("CLOUDBASE_REGION") || "")) ||
    "ap-singapore"
  );
}

function useDomesticSmsEndpoint(): boolean {
  const raw = stripEnvQuotes(String(Deno.env.get("TENCENT_SMS_USE_DOMESTIC") || "")).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function readTencentSmsConfig(): TencentSmsConfig | null {
  const secretId = stripEnvQuotes(String(Deno.env.get("TENCENT_SECRET_ID") || ""));
  const secretKey = stripEnvQuotes(String(Deno.env.get("TENCENT_SECRET_KEY") || ""));
  const sdkAppId = stripEnvQuotes(String(Deno.env.get("TENCENT_SMS_SDK_APP_ID") || ""));
  const signName = stripEnvQuotes(String(Deno.env.get("TENCENT_SMS_SIGN_NAME") || ""));
  const registerTemplateId = stripEnvQuotes(
    String(Deno.env.get("TENCENT_SMS_REGISTER_TEMPLATE_ID") || ""),
  );
  const senderId = stripEnvQuotes(String(Deno.env.get("TENCENT_SMS_SENDER_ID") || ""));

  if (!secretId || !secretKey || !sdkAppId || !signName || !registerTemplateId) {
    return null;
  }

  return {
    secretId,
    secretKey,
    region: resolveSmsRegion(),
    sdkAppId,
    signName,
    registerTemplateId,
    senderId: senderId || undefined,
    useDomesticEndpoint: useDomesticSmsEndpoint(),
  };
}

export function validateTencentSmsConfig(config: TencentSmsConfig | null): string[] {
  const issues: string[] = [];
  if (!config) {
    issues.push("Missing TENCENT_SECRET_ID");
    issues.push("Missing TENCENT_SECRET_KEY");
    issues.push("Missing TENCENT_SMS_SDK_APP_ID");
    issues.push("Missing TENCENT_SMS_SIGN_NAME");
    issues.push("Missing TENCENT_SMS_REGISTER_TEMPLATE_ID");
    return issues;
  }
  if (!config.secretId) issues.push("Missing TENCENT_SECRET_ID");
  if (!config.secretKey) issues.push("Missing TENCENT_SECRET_KEY");
  if (!config.sdkAppId) issues.push("Missing TENCENT_SMS_SDK_APP_ID");
  if (!config.signName) issues.push("Missing TENCENT_SMS_SIGN_NAME");
  if (!config.registerTemplateId) issues.push("Missing TENCENT_SMS_REGISTER_TEMPLATE_ID");
  return issues;
}

async function signedSmsRequest(
  config: TencentSmsConfig,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  const host = config.useDomesticEndpoint ? SMS_DOMESTIC_HOST : SMS_INTL_HOST;
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
  const credentialScope = `${date}/${SMS_SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const secretDate = hmacSha256(`TC3${config.secretKey}`, date);
  const secretService = hmacSha256(secretDate, SMS_SERVICE);
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
      "X-TC-Version": SMS_API_VERSION,
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
    return { ok: false, error: `Tencent SMS HTTP ${response.status}`, status: response.status || 502 };
  }

  const responseBody = (result.Response || result) as Record<string, unknown>;
  const apiError = responseBody?.Error as { Code?: string; Message?: string } | undefined;
  if (apiError?.Message) {
    const code = apiError.Code ? `${apiError.Code}: ` : "";
    return { ok: false, error: `${code}${apiError.Message}`, status: response.status || 502 };
  }
  if (!response.ok) {
    return { ok: false, error: `Tencent SMS HTTP ${response.status}`, status: response.status || 502 };
  }

  const sendStatusSet = responseBody.SendStatusSet;
  if (Array.isArray(sendStatusSet) && sendStatusSet.length > 0) {
    const first = sendStatusSet[0] as Record<string, unknown>;
    const code = String(first.Code || "").trim();
    if (code && code !== "Ok") {
      const message = String(first.Message || code).trim();
      return { ok: false, error: message || `Tencent SMS send failed (${code})`, status: 502 };
    }
  }

  return { ok: true, data: responseBody };
}

/** Send registration OTP using an approved SMS template (TemplateParamSet[0] = OTP). */
export async function sendTencentRegistrationOtpSms(params: {
  config: TencentSmsConfig;
  toPhone: string;
  otp: string;
}): Promise<{ messageId: string }> {
  const payload: Record<string, unknown> = {
    PhoneNumberSet: [params.toPhone],
    SmsSdkAppId: params.config.sdkAppId,
    SignName: params.config.signName,
    TemplateId: params.config.registerTemplateId,
    TemplateParamSet: [params.otp],
  };

  if (params.config.senderId && !params.config.useDomesticEndpoint) {
    payload.SenderId = params.config.senderId;
  }

  const result = await signedSmsRequest(params.config, "SendSms", payload);
  if (!result.ok) throw new Error(result.error);

  const sendStatusSet = result.data.SendStatusSet;
  const firstStatus =
    Array.isArray(sendStatusSet) && sendStatusSet.length > 0
      ? (sendStatusSet[0] as Record<string, unknown>)
      : null;
  const messageId = String(
    firstStatus?.SerialNo || result.data.RequestId || "",
  ).trim();

  if (!messageId) throw new Error("Tencent SMS did not return a SerialNo");
  return { messageId };
}
