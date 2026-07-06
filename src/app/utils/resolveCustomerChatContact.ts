import { chatApi } from "../../utils/api";
import { apiClient } from "../../utils/api-client";
import {
  cloudbaseApiBaseUrl,
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
} from "../../../utils/supabase/info";

export type CustomerChatContact = {
  name: string;
  email: string;
  avatar?: string;
  customerId?: string;
};

/**
 * Resolve an email for admin chat handoff when the customer row is missing email
 * (common for phone-only signups). Falls back to auth profile, customer GET, then inbox match by name.
 */
export async function resolveCustomerChatContact(customer: {
  id: string;
  name?: string;
  email?: string;
  avatar?: string;
  phone?: string;
}): Promise<CustomerChatContact | null> {
  const name = (customer.name || "Customer").trim() || "Customer";
  const avatar = customer.avatar?.trim() || undefined;
  let email = (customer.email || "").trim();

  if (!email) {
    try {
      const profile = await apiClient.get<{ user?: { email?: string }; email?: string }>(
        `/auth/profile/${encodeURIComponent(customer.id)}`,
        { silent: true }
      );
      email = (profile?.user?.email || profile?.email || "").trim();
    } catch {
      /* no linked auth user */
    }
  }

  if (!email) {
    try {
      const headers: Record<string, string> = {
        ...getCloudBaseRequestHeaders(),
        ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
      };
      const res = await fetch(`${cloudbaseApiBaseUrl}/customers/${encodeURIComponent(customer.id)}`, {
        headers,
      });
      if (res.ok) {
        const data = (await res.json()) as { customer?: { email?: string }; email?: string };
        email = String(data?.customer?.email || data?.email || "").trim();
      }
    } catch {
      /* ignore */
    }
  }

  if (!email) {
    try {
      const response = await chatApi.getConversations();
      const nameNorm = name.toLowerCase();
      const convs = (response.conversations || []) as Array<{
        customerName?: string;
        customerEmail?: string;
        customerProfileImage?: string;
      }>;
      const match =
        convs.find((c) => (c.customerName || "").trim().toLowerCase() === nameNorm) ||
        convs.find(
          (c) =>
            nameNorm.length >= 2 &&
            (c.customerName || "").trim().toLowerCase().includes(nameNorm)
        );
      if (match?.customerEmail?.trim()) {
        return {
          name: (match.customerName || name).trim(),
          email: match.customerEmail.trim(),
          avatar: avatar || match.customerProfileImage?.trim() || undefined,
          customerId: customer.id,
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (!email) return null;
  return { name, email, avatar, customerId: customer.id };
}
