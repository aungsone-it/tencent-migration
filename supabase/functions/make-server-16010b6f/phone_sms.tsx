/** SMS delivery for phone OTP — Tencent Cloud SMS (primary), Twilio fallback, dev bypass. */

import { readTencentSmsConfig, sendTencentRegistrationOtpSms } from "./tencent_sms.tsx";

function stripEnvQuotes(value: string): string {
  const v = String(value || "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

export type TwilioSmsConfig = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};

export type SmsProvider = "tencent" | "twilio" | "dev";

function readTwilioSmsConfig(): TwilioSmsConfig | null {
  const accountSid = stripEnvQuotes(String(Deno.env.get("TWILIO_ACCOUNT_SID") || ""));
  const authToken = stripEnvQuotes(String(Deno.env.get("TWILIO_AUTH_TOKEN") || ""));
  const fromNumber = stripEnvQuotes(String(Deno.env.get("TWILIO_PHONE_NUMBER") || ""));

  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

export function readSmsConfig(): { provider: SmsProvider } | null {
  if (readTencentSmsConfig()) return { provider: "tencent" };
  if (readTwilioSmsConfig()) return { provider: "twilio" };
  return null;
}

export function isSmsDevMode(): boolean {
  const raw = stripEnvQuotes(String(Deno.env.get("SMS_DEV_MODE") || "")).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export type SendSmsResult = {
  sent: boolean;
  messageId?: string;
  devMode?: boolean;
  provider?: SmsProvider;
};

async function sendTwilioRegistrationOtpSms(
  config: TwilioSmsConfig,
  toPhone: string,
  otp: string,
): Promise<SendSmsResult> {
  const body = `Your MIGOO verification code is ${otp}. Valid for 10 minutes. Do not share this code.`;
  const credentials = btoa(`${config.accountSid}:${config.authToken}`);
  const params = new URLSearchParams({
    To: toPhone,
    From: config.fromNumber,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message?: string }).message)
        : `Twilio error (${response.status})`;
    throw new Error(errMsg || "Failed to send SMS");
  }

  const messageId =
    typeof data === "object" && data && "sid" in data
      ? String((data as { sid?: string }).sid || "")
      : undefined;

  return { sent: true, messageId, provider: "twilio" };
}

export async function sendRegistrationOtpSms(
  toPhone: string,
  otp: string,
): Promise<SendSmsResult> {
  const tencentConfig = readTencentSmsConfig();
  if (tencentConfig) {
    const result = await sendTencentRegistrationOtpSms({
      config: tencentConfig,
      toPhone,
      otp,
    });
    return { sent: true, messageId: result.messageId, provider: "tencent" };
  }

  const twilioConfig = readTwilioSmsConfig();
  if (twilioConfig) {
    return sendTwilioRegistrationOtpSms(twilioConfig, toPhone, otp);
  }

  if (isSmsDevMode()) {
    console.log(`[sms-dev] OTP for ${toPhone}: ${otp}`);
    return { sent: true, devMode: true, provider: "dev" };
  }

  throw new Error("SMS is not configured on the server");
}
