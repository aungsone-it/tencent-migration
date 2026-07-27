import { useState, useEffect, useMemo, useRef } from "react";
import { Search, Plus, Edit, Trash2, FolderOpen, Info, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { VendorAdminCategoryForm } from "./VendorAdminCategoryForm";
import { cacheManager } from "../../utils/cacheManager";
import { toast } from "sonner";
import { projectId, publicAnonKey, cloudbaseApiBaseUrl, cloudbasePublishableKey, getCloudBaseRequestHeaders } from "../../../../utils/supabase/info";
import { ADMIN_PRODUCTS_INITIAL_PAGE_SIZE, filterVendorCreatedCategories, broadcastVendorCategoryAssignmentChanged, invalidateVendorStorefrontCatalogCachesAfterProductLinkChange, notifyVendorFreeShippingChanged, VENDOR_FREE_SHIPPING_CHANGED_EVENT } from "../../utils/module-cache";
import { VendorAdminListingPagination } from "./VendorAdminListingPagination";
import { useLanguage } from "../../contexts/LanguageContext";
import { resolveCategoryFreeShippingToggleTarget } from "../../utils/freeShipping";
import { API_BASE_URL } from "../../../utils/api-client";

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  images: string[];
  category: string;
  inventory: number;
  status: string;
  freeShipping?: boolean;
}

interface CategoryInfo {
  id: string;
  name: string;
  productCount: number;
  products: Product[];
  activeProducts: number;
  description: string;
  coverPhoto?: string;
  status: "active" | "hide";
  productIds: string[];
  createdAt: string;
  freeShippingEnabledCount?: number;
  freeShippingTotalCount?: number;
}

interface VendorAdminCategoriesProps {
  vendorId: string;
  vendorName: string;
  vendorStoreSlug?: string;
  /** When false, load failures are logged only (avoids toasts while this tab is hidden / preloaded). */
  reportLoadErrors?: boolean;
  isActive?: boolean;
}

export function VendorAdminCategories({
  vendorId,
  vendorName,
  vendorStoreSlug,
  reportLoadErrors = true,
  isActive = true,
}: VendorAdminCategoriesProps) {
  const { t } = useLanguage();
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryInfo | null>(null);
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(ADMIN_PRODUCTS_INITIAL_PAGE_SIZE);
  const [vendorFreeShippingAccess, setVendorFreeShippingAccess] = useState(false);
  const [freeShippingToggleCategoryId, setFreeShippingToggleCategoryId] = useState<string | null>(null);
  const wasActiveRef = useRef(false);

  const cleanupImportedCategories = async () => {
    try {
      await fetch(
        `${cloudbaseApiBaseUrl}/vendor/categories/cleanup-imported`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getCloudBaseRequestHeaders(),

            ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
          },
          body: JSON.stringify({ vendorId }),
        }
      );
    } catch (error) {
      console.warn("Imported vendor category cleanup skipped:", error);
    }
  };

  // Register cache invalidation
  useEffect(() => {
    const clearCache = () => {
      console.log("🗑️ Clearing categories cache for vendor:", vendorId);
      loadCategories(true);
    };

    cacheManager.registerInvalidation(`vendor:${vendorId}:categories`, clearCache);
    
    // Listen for vendor data updates
    const handleVendorUpdate = (event: CustomEvent) => {
      if (event.detail.vendorId === vendorId) {
        clearCache();
      }
    };
    
    window.addEventListener('vendorDataUpdated', handleVendorUpdate as EventListener);
    
    return () => {
      window.removeEventListener('vendorDataUpdated', handleVendorUpdate as EventListener);
    };
  }, [vendorId]);

  const normalizeCategory = (cat: any): CategoryInfo => {
    const productIds = Array.isArray(cat?.productIds)
      ? cat.productIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    const products = Array.isArray(cat?.products) ? cat.products : [];
    const activeProducts = products.length
      ? products.filter((p: Product) => String(p?.status || "").toLowerCase() === "active").length
      : Number(cat?.activeProducts ?? cat?.productCount ?? productIds.length ?? 0);
    return {
      id: String(cat?.id || ""),
      name: String(cat?.name || ""),
      description: String(cat?.description || ""),
      coverPhoto: typeof cat?.coverPhoto === "string" ? cat.coverPhoto : "",
      status: cat?.status === "hide" ? "hide" : "active",
      productIds,
      products,
      productCount: activeProducts,
      activeProducts,
      createdAt: String(cat?.createdAt || ""),
      freeShippingEnabledCount: Number(cat?.freeShippingEnabledCount ?? 0),
      freeShippingTotalCount: Number(cat?.freeShippingTotalCount ?? productIds.length),
    };
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/vendor-auth/profile/${encodeURIComponent(vendorId)}`,
          {
            headers: {
              ...getCloudBaseRequestHeaders(),
              ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
            },
          }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setVendorFreeShippingAccess(data?.user?.freeShippingEnabled === true);
        }
      } catch {
        if (!cancelled) setVendorFreeShippingAccess(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  const getCategoryFreeShippingChecked = (category: CategoryInfo) => {
    const total = category.freeShippingTotalCount ?? category.productIds.length;
    const enabled = category.freeShippingEnabledCount ?? 0;
    return total > 0 && enabled === total;
  };

  const isCategoryFreeShippingPartial = (category: CategoryInfo) => {
    const total = category.freeShippingTotalCount ?? category.productIds.length;
    const enabled = category.freeShippingEnabledCount ?? 0;
    return total > 0 && enabled > 0 && enabled < total;
  };

  const handleToggleCategoryFreeShipping = async (category: CategoryInfo, next: boolean) => {
    if (!vendorFreeShippingAccess) {
      toast.error(t("products.freeShippingAccessRequired"));
      return;
    }
    const total = category.freeShippingTotalCount ?? category.productIds.length;
    if (total === 0) {
      toast.error(t("categories.freeShippingNoProducts"));
      return;
    }

    setFreeShippingToggleCategoryId(category.id);
    try {
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/vendor/categories/${encodeURIComponent(category.id)}/bulk-free-shipping`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getCloudBaseRequestHeaders(),
            ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
          },
          body: JSON.stringify({ vendorId, enabled: next }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : t("categories.freeShippingUpdateFailed"));
      }

      const updatedCount = Number(data.updatedCount ?? total);
      const enabledCount = Number(data.freeShippingEnabledCount ?? (next ? updatedCount : 0));
      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === category.id
            ? {
                ...cat,
                freeShippingEnabledCount: enabledCount,
                freeShippingTotalCount: Number(data.freeShippingTotalCount ?? total),
                products: cat.products.map((product) => ({ ...product, freeShipping: next })),
              }
            : cat
        )
      );
      notifyVendorFreeShippingChanged(vendorId);
      invalidateVendorStorefrontCatalogCachesAfterProductLinkChange(vendorId, [vendorName, vendorStoreSlug]);
      if (!next && updatedCount < total) {
        toast.warning(
          t("categories.freeShippingPartialSync").replace("{count}", String(updatedCount)).replace("{total}", String(total))
        );
      } else {
        toast.success(
          next ? t("categories.freeShippingEnabledForCategory") : t("categories.freeShippingDisabledForCategory")
        );
      }
      void loadCategories(true, false);
    } catch (error: any) {
      console.error("Failed to toggle category free shipping:", error);
      toast.error(error?.message || t("categories.freeShippingUpdateFailed"));
    } finally {
      setFreeShippingToggleCategoryId(null);
    }
  };

  const loadCategories = async (forceRefresh = false, showFullLoading = categories.length === 0) => {
    setListRefreshing(forceRefresh);
    if (showFullLoading) setLoading(true);
    try {
      console.log("🔄 Loading vendor-owned categories for vendor:", vendorId);
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/vendor/categories-details/${vendorId}`,
        {
          headers: {
            ...getCloudBaseRequestHeaders(),

            ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
          },
        }
      );
      if (!response.ok) {
        throw new Error("Failed to load categories");
      }
      const data = await response.json();
      const rows: CategoryInfo[] = filterVendorCreatedCategories(data.categories || [], vendorId)
        .map(normalizeCategory)
        .filter((cat: CategoryInfo) => cat.id && cat.name);
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setCategories(rows);
      console.log(`✅ Loaded ${rows.length} vendor-owned categories for vendor ${vendorId}`);
    } catch (error: any) {
      console.error("Failed to load categories:", error);
      if (!reportLoadErrors) return;
      if (error.name === "AbortError") {
        toast.error("Request timed out.");
      } else {
        toast.error("Failed to load categories");
      }
    } finally {
      setLoading(false);
      setListRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isActive) {
      wasActiveRef.current = false;
      return;
    }
    const isRevisit = wasActiveRef.current;
    wasActiveRef.current = true;
    loadCategories(isRevisit, categories.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, isActive]);

  useEffect(() => {
    const onFreeShippingChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ vendorId?: string }>).detail;
      if (detail?.vendorId && detail.vendorId !== vendorId) return;
      void loadCategories(true, false);
    };
    window.addEventListener(VENDOR_FREE_SHIPPING_CHANGED_EVENT, onFreeShippingChanged);
    return () => window.removeEventListener(VENDOR_FREE_SHIPPING_CHANGED_EVENT, onFreeShippingChanged);
  }, [vendorId]);

  const filteredCategories = useMemo(
    () =>
      categories.filter((category) =>
        category.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [categories, searchQuery]
  );

  useEffect(() => {
    setListPage(1);
  }, [searchQuery]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(filteredCategories.length / listPageSize) || 1);
    setListPage((p) => Math.min(p, tp));
  }, [filteredCategories.length, listPageSize]);

  const pagedCategories = useMemo(() => {
    const start = (listPage - 1) * listPageSize;
    return filteredCategories.slice(start, start + listPageSize);
  }, [filteredCategories, listPage, listPageSize]);

  const handleCreateCategory = () => {
    setEditingCategory(null);
    setIsFormOpen(true);
  };

  const handleEditCategory = (category: CategoryInfo) => {
    setEditingCategory(category);
    setIsFormOpen(true);
  };

  const handleCategorySaved = (savedCategory?: any) => {
    setIsFormOpen(false);
    setEditingCategory(null);
    if (savedCategory?.id) {
      const nextCategory = normalizeCategory(savedCategory);
      setCategories((prev) => {
        const exists = prev.some((cat) => cat.id === nextCategory.id);
        const next = exists
          ? prev.map((cat) => (cat.id === nextCategory.id ? { ...cat, ...nextCategory } : cat))
          : [nextCategory, ...prev];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      return;
    }
    loadCategories(true, false);
  };

  const handleDeleteCategory = async (category: CategoryInfo) => {
    const assignedCount = category.productIds.length;
    const confirmMessage =
      assignedCount > 0
        ? `Delete "${category.name}"? ${assignedCount} product(s) will be removed from this category but will stay in your catalog.`
        : `Delete "${category.name}"? This cannot be undone.`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/vendor/categories/${encodeURIComponent(category.id)}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...getCloudBaseRequestHeaders(),

            ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
          },
          body: JSON.stringify({ vendorId }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete category");
      }
      const cleared = Number(data.unassignedProductCount ?? assignedCount) || 0;
      toast.success(
        cleared > 0
          ? `Category deleted. ${cleared} product(s) removed from this category.`
          : "Category deleted successfully"
      );
      broadcastVendorCategoryAssignmentChanged(vendorId, [vendorName, vendorStoreSlug]);
      setCategories((prev) => prev.filter((cat) => cat.id !== category.id));
    } catch (error: any) {
      console.error("Failed to delete category:", error);
      toast.error(error.message || "Failed to delete category");
    }
  };

  if (isFormOpen) {
    return (
      <VendorAdminCategoryForm
        vendorId={vendorId}
        vendorName={vendorName}
        vendorStoreSlug={vendorStoreSlug}
        editingCategory={editingCategory}
        onBack={() => {
          setIsFormOpen(false);
          setEditingCategory(null);
        }}
        onSave={handleCategorySaved}
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <Skeleton className="h-10 w-48" />
        </div>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-12 w-full" />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-white">
                  <th className="py-3 px-4"><Skeleton className="h-4 w-24" /></th>
                  <th className="py-3 px-4"><Skeleton className="h-4 w-24" /></th>
                  <th className="py-3 px-4"><Skeleton className="h-4 w-32" /></th>
                  <th className="py-3 px-4"><Skeleton className="h-4 w-20" /></th>
                  <th className="py-3 px-4"><Skeleton className="h-4 w-16" /></th>
                  <th className="py-3 px-4"><Skeleton className="h-4 w-20" /></th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {[...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </td>
                    <td className="py-3 px-4"><Skeleton className="h-6 w-20" /></td>
                    <td className="py-3 px-4"><Skeleton className="h-4 w-40" /></td>
                    <td className="py-3 px-4"><Skeleton className="h-4 w-8" /></td>
                    <td className="py-3 px-4"><Skeleton className="h-6 w-16" /></td>
                    <td className="py-3 px-4"><Skeleton className="h-8 w-8 rounded" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t("categories.title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-slate-300"
            disabled={listRefreshing || loading}
            onClick={() => loadCategories(true)}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${listRefreshing ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
          <Button
            type="button"
            className="bg-slate-900 hover:bg-slate-800"
            onClick={handleCreateCategory}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Category
          </Button>
        </div>
      </div>

      {/* Info Banner */}
      <Card className="p-4 bg-slate-50 border-slate-200">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-slate-900 font-medium">
              Vendor-owned categories
            </p>
            <p className="text-sm text-slate-600 mt-1">
              Products assigned to this vendor are available to organize, but super-admin product categories are no longer imported here.
            </p>
            {vendorFreeShippingAccess && (
              <p className="text-sm text-slate-600 mt-2">
                {t("categories.freeShippingVendorScopedHint")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          type="text"
          placeholder={t("categories.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-white border-slate-200"
        />
      </div>

      {/* Categories Table */}
      {filteredCategories.length === 0 ? (
        <Card className="p-12 text-center border-slate-200">
          <FolderOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            {searchQuery ? t("categories.noCategoriesFound") : t("categories.noCategoriesYet")}
          </h3>
          <p className="text-slate-600">
            {searchQuery 
              ? t("products.tryAdjustSearch")
              : "Create your first category and assign your vendor products to organize your storefront."}
          </p>
          {!searchQuery && (
            <Button className="mt-6 bg-slate-900 hover:bg-slate-800" onClick={handleCreateCategory}>
              <Plus className="w-4 h-4 mr-2" />
              Create Category
            </Button>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-white">
                  <th className="text-left py-3 px-4 font-medium text-slate-600 text-sm">{t("categories.category")}</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 text-sm">{t("products.vendor")}</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 text-sm">{t("categories.description")}</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 text-sm">{t("categories.products")}</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600 text-sm">{t("categories.status")}</th>
                  {vendorFreeShippingAccess && (
                    <th className="text-left py-3 px-4 font-medium text-slate-600 text-sm">{t("products.freeShipping")}</th>
                  )}
                  <th className="text-left py-3 px-4 font-medium text-slate-600 text-sm">{t("categories.actions")}</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {pagedCategories.map((category) => (
                  <tr key={category.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                          <FolderOpen className="w-5 h-5 text-blue-400" />
                        </div>
                        <span className="font-medium text-slate-900">{category.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="secondary" className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 font-medium">
                        {vendorName}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-blue-600">{category.description}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm text-slate-700">
                        <span>{category.activeProducts}</span>
                        {category.productIds.length > category.activeProducts && (
                          <span className="ml-1 text-xs text-slate-500">
                            visible / {category.productIds.length} selected
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {category.status === "hide" ? (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100">
                          {t("categories.hidden")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
                          {t("categories.active")}
                        </Badge>
                      )}
                    </td>
                    {vendorFreeShippingAccess && (
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={getCategoryFreeShippingChecked(category)}
                            disabled={
                              freeShippingToggleCategoryId === category.id ||
                              (category.freeShippingTotalCount ?? category.productIds.length) === 0
                            }
                            onCheckedChange={(checked) =>
                              void handleToggleCategoryFreeShipping(
                                category,
                                resolveCategoryFreeShippingToggleTarget(category, checked)
                              )
                            }
                          />
                          {isCategoryFreeShippingPartial(category) && (
                            <span className="text-xs text-amber-700">{t("categories.freeShippingPartial")}</span>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                          title="Edit category"
                          onClick={() => handleEditCategory(category)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title="Delete category"
                          onClick={() => handleDeleteCategory(category)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <VendorAdminListingPagination
            variant="cardFooter"
            page={listPage}
            pageSize={listPageSize}
            totalCount={filteredCategories.length}
            onPageChange={setListPage}
            onPageSizeChange={setListPageSize}
            itemLabel={t("categories.title").toLowerCase()}
            loading={loading || listRefreshing}
          />
        </Card>
      )}
    </div>
  );
}