// ============================================
// REFACTORED API SERVICE LAYER WITH TYPES
// Version: 2.0 - Blog Engagement Features Added
// ============================================

import { API_TIMEOUTS } from '../constants';
import { apiClient, API_BASE_URL } from './api-client';
import { chatMessageTextForSend, sanitizeOptionalHttpUrl } from './chatConversation';
import {
  projectId,
  publicAnonKey,
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
} from '../../utils/supabase/info';
import type {
  // Product types
  ProductsResponse,
  ProductResponse,
  Product,
  SkuCheckResponse,
  
  // Order types
  OrdersResponse,
  OrderResponse,
  Order,
  
  // Customer types
  CustomersResponse,
  CustomerResponse,
  Customer,
  
  // Category types
  Category,
  
  // Vendor & Collaborator types
  Vendor,
  Collaborator,
  
  // Blog types
  BlogPost,
  
  // Auth types
  AuthResponse,
  ProfileResponse,
  RegisterData,
  
  // Wishlist types
  WishlistResponse,
  
  // Stats types
  StatsResponse,
  
  // Common types
  ApiResponse,
} from '../types';

// ============================================
// PRODUCTS API
// ============================================

const PRODUCT_IMAGE_DATA_URL_RE = /^data:image\/(png|jpg|jpeg|gif|webp);base64,/i;

function dataUrlToUploadMeta(dataUrl: string): { mime: string; ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid product image format");
  }

  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
  return { mime, ext, bytes };
}

/** Upload one gallery image; returns a storage URL (not base64). */
export async function uploadProductGalleryImage(dataUrl: string): Promise<string> {
  if (!PRODUCT_IMAGE_DATA_URL_RE.test(dataUrl)) {
    return dataUrl;
  }

  const { ext } = dataUrlToUploadMeta(dataUrl);
  const fileName = `product-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;

  // JSON upload via existing chat route — works on current CloudBase deploy (signed URLs, no multipart).
  const chatRes = await apiClient.post<{ success?: boolean; imageUrl?: string; error?: string }>(
    "/chat/upload-image",
    {
      imageData: dataUrl,
      fileName,
      conversationId: "products",
    }
  );

  if (chatRes.imageUrl && typeof chatRes.imageUrl === "string") {
    return chatRes.imageUrl;
  }

  throw new Error(chatRes.error || "Failed to upload product image");
}

async function uploadProductImageDataUrl(dataUrl: string): Promise<string> {
  return uploadProductGalleryImage(dataUrl);
}

async function resolveProductImageRef(src: unknown): Promise<unknown> {
  if (typeof src !== "string" || !src.trim()) return src;
  if (!PRODUCT_IMAGE_DATA_URL_RE.test(src)) return src;
  return uploadProductImageDataUrl(src);
}

/** Upload inline base64 gallery/variant images so JSON create/update stays under CloudBase limits. */
async function prepareProductPayloadForSave<T extends Partial<Product>>(
  data: T
): Promise<T> {
  const next: Partial<Product> = { ...data };

  if (Array.isArray(next.images) && next.images.length > 0) {
    next.images = await Promise.all(next.images.map((img) => resolveProductImageRef(img))) as string[];
  }

  if (Array.isArray(next.variants) && next.variants.length > 0) {
    next.variants = await Promise.all(
      next.variants.map(async (variant) => {
        if (!variant || typeof variant !== "object") return variant;
        const v = variant as Record<string, unknown>;
        if (typeof v.image !== "string" || !PRODUCT_IMAGE_DATA_URL_RE.test(v.image)) {
          return variant;
        }
        return {
          ...variant,
          image: await uploadProductImageDataUrl(v.image),
        };
      })
    ) as Product["variants"];
  }

  return next as T;
}

export const productsApi = {
  /**
   * Get all products
   */
  getAll: async (): Promise<ProductsResponse> => {
    return apiClient.get<ProductsResponse>('/products');
  },

  /**
   * Get a single product by ID
   */
  getById: async (id: string): Promise<ProductResponse> => {
    return apiClient.get<ProductResponse>(`/products/${id}`);
  },

  /**
   * Create a new product (`performedByUserId`: CloudBase Auth UUID of acting staff — for audit timeline)
   */
  create: async (data: Partial<Product> & { performedByUserId?: string }): Promise<ApiResponse<Product>> => {
    const prepared = await prepareProductPayloadForSave(data);
    return apiClient.post<ApiResponse<Product>>('/products', prepared);
  },

  /**
   * Update an existing product
   */
  update: async (
    id: string,
    data: Partial<Product> & { performedByUserId?: string }
  ): Promise<ApiResponse<Product>> => {
    const prepared = await prepareProductPayloadForSave(data);
    return apiClient.put<ApiResponse<Product>>(`/products/${id}`, prepared);
  },

  /**
   * Delete a product (`performedByUserId` logged on staff timeline when provided)
   */
  delete: async (id: string, performedByUserId?: string): Promise<ApiResponse> => {
    const q =
      performedByUserId && String(performedByUserId).trim()
        ? `?performedByUserId=${encodeURIComponent(String(performedByUserId).trim())}`
        : "";
    return apiClient.delete<ApiResponse>(`/products/${id}${q}`);
  },

  /**
   * Check if SKU is unique
   */
  checkSku: async (
    sku: string,
    excludeProductId?: string
  ): Promise<SkuCheckResponse> => {
    const queryParam = excludeProductId
      ? `?excludeProductId=${excludeProductId}`
      : '';
    return apiClient.get<SkuCheckResponse>(
      `/check-sku/${encodeURIComponent(sku)}${queryParam}`
    );
  },

  /**
   * Seed sample products for testing/demo
   */
  seedSampleProducts: async (): Promise<ApiResponse<{ count: number; products: Array<{ sku: string; name: string }>; coupons?: Array<{ code: string; discount: string; minAmount: string }> }>> => {
    return apiClient.post<ApiResponse<{ count: number; products: Array<{ sku: string; name: string }>; coupons?: Array<{ code: string; discount: string; minAmount: string }> }>>('/seed-products', {});
  },
};

// ============================================
// ORDERS API
// ============================================

export const ordersApi = {
  /**
   * Get all orders with retry logic
   */
  getAll: async (): Promise<OrdersResponse> => {
    return apiClient.getWithRetry<OrdersResponse>('/orders');
  },

  /**
   * Get a single order by ID
   */
  getById: async (id: string): Promise<OrderResponse> => {
    return apiClient.getWithRetry<OrderResponse>(`/orders/${id}`);
  },

  /**
   * Get normalized refund status/log for an order.
   */
  getRefundStatus: async (
    id: string,
    opts?: { sync?: boolean }
  ): Promise<
    ApiResponse<{
      orderId: string;
      orderNumber: string;
      merchantOrderId: string;
      paymentMethod: string;
      paymentStatus: string;
      status: string;
      refund: {
        status: string;
        refundRequestNo: string;
        amount: number;
        providerStatus: string;
        endpointUsed: string;
        refundedAt: string;
        failedAt: string;
        networkError: string;
        details: Record<string, unknown>;
      } | null;
    }>
  > => {
    return apiClient.get<
      ApiResponse<{
        orderId: string;
        orderNumber: string;
        merchantOrderId: string;
        paymentMethod: string;
        paymentStatus: string;
        status: string;
        refund: {
          status: string;
          refundRequestNo: string;
          amount: number;
          providerStatus: string;
          endpointUsed: string;
          refundedAt: string;
          failedAt: string;
          networkError: string;
          details: Record<string, unknown>;
        } | null;
      }>
    >(`/orders/${id}/refund-status${opts?.sync === false ? "?sync=0" : ""}`, {
      timeout: API_TIMEOUTS.DEFAULT,
      silent: true,
    });
  },

  /**
   * Create a new order
   */
  create: async (orderData: Partial<Order>): Promise<ApiResponse<Order>> => {
    return apiClient.post<ApiResponse<Order>>('/orders', orderData);
  },

  /**
   * Update an existing order
   */
  update: async (
    id: string,
    orderData: Partial<Order>
  ): Promise<ApiResponse<Order>> => {
    const keys = Object.keys(orderData ?? {});
    const statusOnly = keys.length === 1 && keys[0] === 'status';
    if (statusOnly) {
      return apiClient.put<ApiResponse<Order>>(`/orders/${id}`, orderData, {
        keepalive: true,
        timeout: API_TIMEOUTS.ORDER_STATUS,
      });
    }
    return apiClient.putWithRetry<ApiResponse<Order>>(`/orders/${id}`, orderData, {
      /** Survives tab refresh/navigation so status changes persist server-side. */
      keepalive: true,
    });
  },

  /**
   * Delete a single order
   */
  delete: async (id: string): Promise<ApiResponse<void>> => {
    return apiClient.deleteWithRetry<ApiResponse<void>>(`/orders/${id}`);
  },

  /**
   * Delete ALL orders (for testing/cleanup)
   */
  deleteAll: async (): Promise<ApiResponse<{ deletedCount: number }>> => {
    return apiClient.deleteWithRetry<ApiResponse<{ deletedCount: number }>>('/orders');
  },
};

// ============================================
// CATEGORIES API
// ============================================

export const categoriesApi = {
  /**
   * Get all categories
   */
  getAll: async (): Promise<ApiResponse<Category[]>> => {
    return apiClient.get<ApiResponse<Category[]>>('/categories');
  },

  /**
   * Get a single category by ID
   */
  getById: async (id: string): Promise<ApiResponse<Category>> => {
    return apiClient.get<ApiResponse<Category>>(`/categories/${id}`);
  },

  /**
   * Create a new category
   */
  create: async (categoryData: Partial<Category>): Promise<ApiResponse<Category>> => {
    return apiClient.post<ApiResponse<Category>>('/categories', categoryData);
  },

  /**
   * Update an existing category
   */
  update: async (
    id: string,
    categoryData: Partial<Category>
  ): Promise<ApiResponse<Category>> => {
    return apiClient.put<ApiResponse<Category>>(`/categories/${id}`, categoryData);
  },

  /**
   * Delete a single category
   */
  delete: async (id: string): Promise<ApiResponse<void>> => {
    return apiClient.delete<ApiResponse<void>>(`/categories/${id}`);
  },

  /**
   * Bulk delete categories
   */
  bulkDelete: async (ids: string[]): Promise<ApiResponse<void>> => {
    return apiClient.post<ApiResponse<void>>('/categories/bulk-delete', { ids });
  },

  /**
   * Delete all categories (cleanup)
   */
  deleteAll: async (): Promise<ApiResponse<void>> => {
    return apiClient.delete<ApiResponse<void>>('/categories/all');
  },
};

// ============================================
// CUSTOMERS API
// ============================================

export const customersApi = {
  /**
   * Get all customers
   */
  getAll: async (): Promise<CustomersResponse> => {
    return apiClient.get<CustomersResponse>('/customers');
  },

  /**
   * Get a single customer by ID
   */
  getById: async (id: string): Promise<CustomerResponse> => {
    return apiClient.get<CustomerResponse>(`/customers/${id}`);
  },

  /**
   * Create a new customer
   */
  create: async (
    customerData: Partial<Customer>
  ): Promise<ApiResponse<Customer>> => {
    return apiClient.post<ApiResponse<Customer>>('/customers', customerData);
  },

  /**
   * Update an existing customer
   */
  update: async (
    id: string,
    customerData: Partial<Customer>
  ): Promise<ApiResponse<Customer>> => {
    return apiClient.put<ApiResponse<Customer>>(
      `/customers/${id}`,
      customerData
    );
  },
};

// ============================================
// VENDORS API
// ============================================

export const vendorsApi = {
  /**
   * Get all vendors
   */
  getAll: async (): Promise<ApiResponse<Vendor[]>> => {
    return apiClient.get<ApiResponse<Vendor[]>>('/vendors');
  },

  /**
   * Create a new vendor
   */
  create: async (vendorData: Partial<Vendor>): Promise<ApiResponse<Vendor>> => {
    return apiClient.post<ApiResponse<Vendor>>('/vendors', vendorData);
  },

  /**
   * Update an existing vendor
   */
  update: async (
    id: string,
    vendorData: Partial<Vendor>
  ): Promise<ApiResponse<Vendor>> => {
    return apiClient.put<ApiResponse<Vendor>>(`/vendors/${id}`, vendorData);
  },
};

// ============================================
// SOCIAL PROFILE PREVIEW API
// ============================================

import type { SocialProfilePreview } from "../app/utils/socialProfile";

export const socialProfilesApi = {
  previewBatch: async (
    profiles: { platform: string; url: string }[],
    refreshKey = 0
  ): Promise<{ success: boolean; profiles: SocialProfilePreview[] }> => {
    return apiClient.post(
      `/social-profiles/preview?_=${refreshKey || Date.now()}`,
      { profiles, _t: Date.now() },
      { silent: true, cache: "no-store" }
    );
  },
};

// ============================================
// VENDOR APPLICATIONS API
// ============================================

export const vendorApplicationsApi = {
  /**
   * Get all vendor applications (silent mode - no error toasts)
   */
  getAll: async (): Promise<ApiResponse<any[]>> => {
    try {
      return await apiClient.get<ApiResponse<any[]>>('/vendor-applications', { silent: true });
    } catch (error) {
      // Silently fail and return empty applications
      console.debug('Vendor applications not loaded (endpoint may not be initialized yet)');
      return { success: true, data: [] };
    }
  },

  /**
   * Get single vendor application
   */
  getById: async (id: string): Promise<ApiResponse<any>> => {
    return apiClient.get<ApiResponse<any>>(`/vendor-applications/${id}`);
  },

  /**
   * Update vendor application status
   */
  updateStatus: async (
    id: string,
    status: string,
    reviewNotes?: string,
    performedByUserId?: string,
    reviewedBy?: string
  ): Promise<ApiResponse<any>> => {
    return apiClient.put<ApiResponse<any>>(`/vendor-applications/${id}`, {
      status,
      reviewNotes,
      performedByUserId:
        performedByUserId && String(performedByUserId).trim()
          ? String(performedByUserId).trim()
          : undefined,
      reviewedBy: reviewedBy?.trim() || "Admin",
    });
  },
};

// ============================================
// COLLABORATORS API
// ============================================

export const collaboratorsApi = {
  /**
   * Get all collaborators
   */
  getAll: async (): Promise<ApiResponse<Collaborator[]>> => {
    return apiClient.get<ApiResponse<Collaborator[]>>('/collaborators');
  },

  /**
   * Create a new collaborator
   */
  create: async (
    collaboratorData: Partial<Collaborator>
  ): Promise<ApiResponse<Collaborator>> => {
    return apiClient.post<ApiResponse<Collaborator>>(
      '/collaborators',
      collaboratorData
    );
  },

  /**
   * Update an existing collaborator
   */
  update: async (
    id: string,
    collaboratorData: Partial<Collaborator>
  ): Promise<ApiResponse<Collaborator>> => {
    return apiClient.put<ApiResponse<Collaborator>>(
      `/collaborators/${id}`,
      collaboratorData
    );
  },
};

// ============================================
// BLOG POSTS API
// ============================================

export const blogApi = {
  /**
   * Get all blog posts
   */
  getAll: async (): Promise<ApiResponse<BlogPost[]>> => {
    return apiClient.get<ApiResponse<BlogPost[]>>('/blog-posts');
  },

  /**
   * Create a new blog post
   */
  create: async (
    blogData: Partial<BlogPost>
  ): Promise<ApiResponse<BlogPost>> => {
    return apiClient.post<ApiResponse<BlogPost>>('/blog-posts', blogData);
  },

  /**
   * Update an existing blog post
   */
  update: async (
    id: string,
    blogData: Partial<BlogPost>
  ): Promise<ApiResponse<BlogPost>> => {
    return apiClient.put<ApiResponse<BlogPost>>(`/blog-posts/${id}`, blogData);
  },

  /**
   * Delete a blog post
   */
  delete: async (id: string): Promise<ApiResponse> => {
    return apiClient.delete<ApiResponse>(`/blog-posts/${id}`);
  },
};

// ============================================
// BLOG ENGAGEMENT API (Comments, Likes, Notifications)
// ============================================

export const blogCommentsApi = {
  /**
   * Get comments for a blog post
   */
  getComments: async (postId: string): Promise<ApiResponse<any[]>> => {
    return apiClient.get<ApiResponse<any[]>>(`/blog-posts/${postId}/comments`);
  },

  /**
   * Create a comment on a blog post
   */
  createComment: async (postId: string, commentData: {
    author: string;
    authorAvatar?: string;
    content: string;
    parentId?: string | null;
  }): Promise<ApiResponse<any>> => {
    return apiClient.post<ApiResponse<any>>(`/blog-posts/${postId}/comments`, commentData);
  },

  /**
   * Update a comment
   */
  updateComment: async (commentId: string, content: string): Promise<ApiResponse<any>> => {
    return apiClient.put<ApiResponse<any>>(`/comments/${commentId}`, { content });
  },

  /**
   * Delete a comment
   */
  deleteComment: async (commentId: string): Promise<ApiResponse> => {
    return apiClient.delete<ApiResponse>(`/comments/${commentId}`);
  },

  /**
   * Like/Unlike a comment
   */
  toggleLike: async (commentId: string): Promise<ApiResponse<any>> => {
    return apiClient.post<ApiResponse<any>>(`/comments/${commentId}/like`, {});
  },
};

export const blogLikesApi = {
  /**
   * Like/Unlike a blog post
   */
  toggleLike: async (postId: string, userId?: string): Promise<ApiResponse<{ likes: number; isLiked: boolean }>> => {
    return apiClient.post<ApiResponse<{ likes: number; isLiked: boolean }>>(`/blog-posts/${postId}/like`, { userId: userId || 'anonymous' });
  },
};

export const notificationsApi = {
  /**
   * Get all notifications
   */
  getAll: async (): Promise<ApiResponse<any[]> & { unreadCount: number }> => {
    return apiClient.get<ApiResponse<any[]> & { unreadCount: number }>('/notifications');
  },

  /**
   * Mark notification as read
   */
  markAsRead: async (id: string): Promise<ApiResponse<any>> => {
    return apiClient.put<ApiResponse<any>>(`/notifications/${id}/read`, {});
  },

  /**
   * Mark all notifications as read
   */
  markAllAsRead: async (): Promise<ApiResponse> => {
    return apiClient.put<ApiResponse>('/notifications/read-all', {});
  },

  /**
   * Delete a notification
   */
  delete: async (id: string): Promise<ApiResponse> => {
    return apiClient.delete<ApiResponse>(`/notifications/${id}`);
  },
};

// ============================================
// DASHBOARD STATS API
// ============================================

export const statsApi = {
  /**
   * Get dashboard statistics
   */
  getStats: async (): Promise<StatsResponse> => {
    return apiClient.get<StatsResponse>('/stats');
  },
};

// ============================================
// CHAT API
// ============================================

export const chatApi = {
  /**
   * Get all chat conversations (silent mode - no error toasts)
   */
  getConversations: async () => {
    try {
      return await apiClient.get('/chat/conversations', { silent: true });
    } catch (error) {
      // Silently fail and return empty conversations
      console.debug('Chat conversations not loaded (endpoint may not be initialized yet)');
      return { conversations: [] };
    }
  },

  /**
   * Get messages for a specific conversation
   */
  getMessages: async (
    conversationId: string,
    customerEmail?: string,
    options?: { vendorId?: string; vendorSource?: string }
  ) => {
    const params = new URLSearchParams();
    if (customerEmail && String(customerEmail).trim()) {
      params.set("customerEmail", String(customerEmail).trim());
    }
    if (options?.vendorId && String(options.vendorId).trim()) {
      params.set("vendorId", String(options.vendorId).trim());
    }
    if (options?.vendorSource && String(options.vendorSource).trim()) {
      params.set("vendorSource", String(options.vendorSource).trim());
    }
    const q = params.toString() ? `?${params.toString()}` : "";
    return apiClient.get(`/chat/messages/${conversationId}${q}`, { silent: true });
  },

  /**
   * Cross-device thread history keyed by signed-in customer email (+ optional vendor).
   */
  getHistory: async (params: {
    customerEmail: string;
    vendorId?: string;
    vendorSource?: string;
  }) => {
    const search = new URLSearchParams();
    search.set("customerEmail", String(params.customerEmail).trim());
    if (params.vendorId?.trim()) search.set("vendorId", params.vendorId.trim());
    if (params.vendorSource?.trim()) search.set("vendorSource", params.vendorSource.trim());
    return apiClient.get(`/chat/history?${search.toString()}`, { silent: true });
  },

  /**
   * Send a new message
   */
  sendMessage: async (data: {
    conversationId?: string;
    text: string;
    sender: 'customer' | 'admin';
    senderName: string;
    customerEmail?: string;
    /** When sender is admin, pass the customer's display name so the thread header stays correct */
    customerName?: string;
    imageUrl?: string;
    vendorId?: string;
    /** Persisted thread label / token hint (vendor storefront vs SECURE) — keep in sync with server */
    vendorSource?: string;
    customerProfileImage?: string;
  }) => {
    const imageUrl = sanitizeOptionalHttpUrl(data.imageUrl);
    const customerProfileImage = sanitizeOptionalHttpUrl(data.customerProfileImage);
    const text = chatMessageTextForSend(data.text, imageUrl);
    return apiClient.post(
      '/chat/messages',
      {
        ...data,
        text,
        imageUrl,
        customerProfileImage,
      },
      { timeout: API_TIMEOUTS.CHAT }
    );
  },

  /**
   * Mark conversation messages as read
   */
  markAsRead: async (conversationId: string) => {
    return apiClient.put(`/chat/messages/${conversationId}/read`);
  },

  /**
   * Star / unstar a conversation
   */
  setStarred: async (conversationId: string, starred: boolean) => {
    return apiClient.put(`/chat/conversations/${conversationId}/star`, { starred });
  },

  /**
   * Delete a single conversation (and its messages)
   */
  deleteConversation: async (conversationId: string) => {
    return apiClient.delete(`/chat/conversations/${conversationId}`);
  },

  /**
   * Upload image for chat
   */
  uploadImage: async (imageData: string, fileName: string, conversationId?: string) => {
    return apiClient.post(
      '/chat/upload-image',
      {
        imageData,
        fileName,
        conversationId,
      },
      { timeout: API_TIMEOUTS.FILE_UPLOAD }
    );
  },
  
  // Export credentials for direct API calls
  projectId,
  publicAnonKey,
};

// ============================================
// AUTH API
// ============================================

async function uploadCustomerProfileImageDataUrl(
  userId: string,
  profileImage: string
): Promise<void> {
  const match = profileImage.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return;

  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";

  const formData = new FormData();
  formData.append("image", new Blob([bytes], { type: mime }), `profile.${ext}`);

  const headers: Record<string, string> = {
    ...getCloudBaseRequestHeaders(),
    ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
  };

  const uploadRes = await fetch(
    `${API_BASE_URL}/auth/customer/${encodeURIComponent(userId)}/profile-image`,
    { method: "POST", headers, body: formData }
  );

  if (!uploadRes.ok) {
    const errorData = await uploadRes.json().catch(() => ({ error: uploadRes.statusText }));
    throw new Error(errorData.error || `Failed to upload profile image: ${uploadRes.statusText}`);
  }
}

export const authApi = {
  /**
   * Register a new user
   */
  register: async (
    email: string | undefined,
    password: string,
    name?: string,
    phone?: string,
    profileImage?: string
  ): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/register', {
      email: email?.trim() || "",
      password,
      name,
      phone,
    });

    const userId = response.user?.id;
    if (profileImage && userId && profileImage.startsWith("data:image/")) {
      try {
        await uploadCustomerProfileImageDataUrl(String(userId), profileImage);
        const refreshed = await apiClient.get<ProfileResponse>(`/auth/profile/${userId}`);
        if (refreshed.user) {
          response.user = { ...response.user, ...refreshed.user };
        }
      } catch (uploadErr) {
        console.warn("Profile image upload failed after registration:", uploadErr);
      }
    }

    return response;
  },

  /**
   * Login user
   */
  login: async (email: string, password: string): Promise<AuthResponse> => {
    return apiClient.post<AuthResponse>('/auth/login', { email, password });
  },

  /**
   * Get user profile
   */
  getProfile: async (userId: string): Promise<ProfileResponse> => {
    return apiClient.get<ProfileResponse>(`/auth/profile/${userId}`);
  },

  /**
   * Update user profile
   */
  updateProfile: async (
    userId: string,
    profileData: any
  ): Promise<ApiResponse> => {
    return apiClient.put<ApiResponse>(`/auth/profile/${userId}`, profileData);
  },

  /**
   * Change user password
   */
  changePassword: async (
    email: string,
    currentPassword: string,
    newPassword: string
  ): Promise<ApiResponse> => {
    return apiClient.post<ApiResponse>('/auth/change-password', {
      email,
      currentPassword,
      newPassword,
    });
  },
};

// ============================================
// WISHLIST API
// ============================================

export const wishlistApi = {
  /**
   * Get user wishlist
   */
  get: async (userId: string): Promise<WishlistResponse> => {
    return apiClient.get<WishlistResponse>(`/wishlist/${userId}`);
  },

  /**
   * Update user wishlist
   */
  update: async (
    userId: string,
    productIds: string[]
  ): Promise<ApiResponse> => {
    return apiClient.put<ApiResponse>(`/wishlist/${userId}`, { productIds });
  },

  /**
   * Add product to wishlist
   */
  add: async (userId: string, productId: string): Promise<ApiResponse> => {
    return apiClient.post<ApiResponse>(
      `/wishlist/${userId}/add/${productId}`
    );
  },

  /**
   * Remove product from wishlist
   */
  remove: async (userId: string, productId: string): Promise<ApiResponse> => {
    return apiClient.delete<ApiResponse>(
      `/wishlist/${userId}/remove/${productId}`
    );
  },
};

// ============================================
// EXPORT API CLIENT FOR DIRECT ACCESS
// ============================================
export { apiClient };