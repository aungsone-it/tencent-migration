const apiBaseUrl =
  process.env.CLOUDBASE_API_BASE_URL ||
  process.env.TENCENT_API_BASE_URL ||
  process.env.VITE_CLOUDBASE_API_BASE_URL ||
  "";
const publishableKey =
  process.env.CLOUDBASE_PUBLISHABLE_KEY ||
  process.env.TCB_PUBLISHABLE_KEY ||
  process.env.VITE_CLOUDBASE_PUBLISHABLE_KEY ||
  "";
const adminSecret = process.env.EDGE_ADMIN_OPERATION_SECRET || process.env.VITE_ADMIN_OPERATION_SECRET || "";

if (!apiBaseUrl || !adminSecret) {
  console.error(
    [
      "Missing validation env.",
      "Required: CLOUDBASE_API_BASE_URL, EDGE_ADMIN_OPERATION_SECRET.",
      "Example:",
      "CLOUDBASE_API_BASE_URL=https://api.example.com/make-server-16010b6f EDGE_ADMIN_OPERATION_SECRET=... npm run validate:read-model",
    ].join("\n")
  );
  process.exit(2);
}

const base = apiBaseUrl.replace(/\/$/, "");

async function requestJson(path) {
  const response = await fetch(`${base}${path}`, {
    headers: {
      ...(publishableKey ? { Authorization: `Bearer ${publishableKey}` } : {}),
      "x-admin-operation-secret": adminSecret,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const readModel = await requestJson("/read-model/validate");
const monitoring = await requestJson("/monitoring/summary");

console.log("Read model validation:");
console.log(JSON.stringify(readModel, null, 2));
console.log("\nMonitoring summary:");
console.log(JSON.stringify(
  {
    uptimeSeconds: monitoring.uptimeSeconds,
    requests: monitoring.requests,
    readModels: monitoring.readModels,
    realtime: monitoring.realtime,
  },
  null,
  2
));

const status = String(readModel.status || readModel.summary?.status || "").toLowerCase();
if (status && !["ok", "healthy"].includes(status)) {
  console.error(`Read model validation status is ${status}.`);
  process.exit(1);
}
