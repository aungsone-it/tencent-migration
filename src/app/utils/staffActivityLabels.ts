type TranslateFn = (key: string) => string;

/** Exact backend / audit action strings → translation keys */
const ACTION_KEY_MAP: Record<string, string> = {
  "product created": "activity.productCreated",
  "product updated": "activity.productUpdated",
  "product deleted": "activity.productDeleted",
  "order status updated": "activity.orderStatusUpdated",
  "order updated": "activity.orderUpdated",
  "user created": "activity.userCreated",
  "user updated": "activity.userUpdated",
  "user deleted": "activity.userDeleted",
  "user delete blocked": "activity.userDeleteBlocked",
  "password reset": "activity.passwordReset",
  "customer deleted": "activity.customerDeleted",
  "vendor approved": "activity.vendorApproved",
  "vendor rejected": "activity.vendorRejected",
  "vendor deleted": "activity.vendorDeleted",
  "vendor application approved": "activity.vendorApproved",
  "vendor application rejected": "activity.vendorRejected",
};

const RESOURCE_KEY_MAP: Record<string, string> = {
  product: "activity.resource.product",
  order: "activity.resource.order",
  "order status": "activity.resource.orderStatus",
  user: "activity.resource.user",
  customer: "activity.resource.customer",
  categorie: "activity.resource.category",
  category: "activity.resource.category",
  categories: "activity.resource.category",
  "blog post": "activity.resource.blogPost",
  discount: "activity.resource.discount",
  inventory: "activity.resource.inventory",
  campaign: "activity.resource.campaign",
  setting: "activity.resource.setting",
  settings: "activity.resource.settings",
  notification: "activity.resource.notification",
  notifications: "activity.resource.notifications",
  collaborator: "activity.resource.collaborator",
  collaborators: "activity.resource.collaborators",
  "vendor application": "activity.resource.vendorApplication",
  "vendor storefront": "activity.resource.vendorStorefront",
  "vendor custom domain": "activity.resource.vendorCustomDomain",
  domain: "activity.resource.domain",
  announcement: "activity.resource.announcement",
  "appearance settings": "activity.resource.appearanceSettings",
  auth: "activity.resource.auth",
};

const DETAIL_STATUS_KEY_MAP: Record<string, string> = {
  cancelled: "orders.cancelled",
  canceled: "orders.cancelled",
  pending: "orders.pending",
  processing: "orders.processing",
  shipped: "orders.shipped",
  delivered: "orders.delivered",
  completed: "orders.completed",
  approved: "activity.detail.approved",
  rejected: "activity.detail.rejected",
  deleted: "activity.detail.deleted",
  active: "common.active",
  inactive: "common.inactive",
};

export function translateStaffActivityAction(action: string, t: TranslateFn): string {
  const raw = String(action || "").trim();
  if (!raw) return raw;

  const exactKey = ACTION_KEY_MAP[raw.toLowerCase()];
  if (exactKey) {
    const translated = t(exactKey);
    if (translated !== exactKey) return translated;
  }

  const match = raw.match(/^(.+?)\s+(created|updated|deleted)$/i);
  if (match) {
    const resource = match[1].trim();
    const verb = match[2].toLowerCase();
    const resourceKey = RESOURCE_KEY_MAP[resource.toLowerCase()];
    const templateKey = `activity.template.${verb}`;
    if (resourceKey) {
      const resourceLabel = t(resourceKey);
      const template = t(templateKey);
      if (template !== templateKey) {
        return template.replace("{resource}", resourceLabel);
      }
    }
  }

  return raw;
}

export function translateActivityDetailPiece(piece: string, t: TranslateFn): string {
  const raw = String(piece || "").trim();
  if (!raw) return raw;

  const statusMatch = raw.match(/^status\s*[-:]\s*(.+)$/i);
  const statusValue = statusMatch ? statusMatch[1].trim() : raw;
  const statusKey = DETAIL_STATUS_KEY_MAP[statusValue.toLowerCase()];
  if (statusKey) {
    const translated = t(statusKey);
    if (translated !== statusKey) {
      return statusMatch
        ? `${t("activity.detail.status")}: ${translated}`
        : translated;
    }
  }

  return raw;
}
