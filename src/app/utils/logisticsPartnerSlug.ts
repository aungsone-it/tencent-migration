import type { DeliveryPartner } from "../../utils/api";

export function logisticsPartnerToSlug(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function findPartnerBySlug(
  partners: DeliveryPartner[],
  slug: string
): DeliveryPartner | undefined {
  const norm = decodeURIComponent(slug).trim().toLowerCase();
  const byId = partners.find((p) => p.id.toLowerCase() === norm);
  if (byId) return byId;
  return partners.find((p) => logisticsPartnerToSlug(p.name) === norm);
}

export function logisticsPartnerProfilePath(partner: Pick<DeliveryPartner, "id" | "name">): string {
  const slug = logisticsPartnerToSlug(partner.name) || partner.id;
  return `/admin/logistics/${encodeURIComponent(slug)}`;
}

export function logisticsPartnerEditPath(partner: Pick<DeliveryPartner, "id" | "name">): string {
  return `${logisticsPartnerProfilePath(partner)}/edit`;
}

export const LOGISTICS_PARTNER_CREATE_PATH = "/admin/logistics/new";

export function formatLogisticsPartnerSlugLabel(slug: string): string {
  return decodeURIComponent(slug)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
