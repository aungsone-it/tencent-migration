// Compatibility shim retained for existing imports during the Tencent migration.
// Values now come from Tencent CloudBase env variables, not Supabase.

export {
  cloudbaseApiBaseUrl,
  cloudbaseEnvId,
  cloudbasePublishableKey,
  cloudbaseRegion,
  getCloudBaseRequestHeaders,
  projectId,
  publicAnonKey,
} from "../tencent/cloudbase";