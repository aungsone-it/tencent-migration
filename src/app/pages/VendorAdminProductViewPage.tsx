import { useState, useEffect, useCallback } from "react";
import "../utils/adminStyles";
import { useNavigate, useLocation } from "react-router";
import { pathnameUnderAdmin } from "../utils/vendorSubdomainHooks";
import {
  useVendorAdminRouteParams,
  useVendorHostCleanAdmin,
} from "../utils/vendorAdminRouteParams";
import { ArrowLeft, Package, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import {
  fetchVendorCategories,
  getCachedProductById,
} from "../utils/module-cache";
import { useVendorAuth } from "../contexts/VendorAuthContext";
import { useLanguage } from "../contexts/LanguageContext";
import {
  buildVendorProductCategoryLabels,
  parseProductMoney,
  resolveVendorProductCategoryLabel,
} from "../utils/vendorProductCategoryLabels";

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  compareAtPrice?: number;
  costPerItem?: number;
  description: string;
  images: string[];
  category: string;
  inventory: number;
  status: string;
  vendor?: string;
  hasVariants?: boolean;
  variants?: any[];
  variantOptions?: { name: string; values: string[] }[];
  tags?: string[];
  productType?: string;
  weight?: string;
  barcode?: string;
  trackQuantity?: boolean;
  continueSellingOutOfStock?: boolean;
  commissionRate?: number;
  createdAt?: string;
  updatedAt?: string;
}

function stripHtml(html: string) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

function productBelongsToVendor(raw: Record<string, unknown>, vendorId: string): boolean {
  const vid = String(vendorId || "").trim();
  if (!vid) return false;
  if (String(raw.vendorId ?? "") === vid) return true;
  const sel = raw.selectedVendors;
  if (Array.isArray(sel) && sel.some((v) => String(v).trim() === vid)) return true;
  return false;
}

function mapProductDetailFromApi(
  raw: Record<string, unknown>,
  categoryLabel: string,
): Product {
  const images = Array.isArray(raw.images)
    ? (raw.images as unknown[])
        .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : typeof raw.image === "string" && raw.image.trim()
      ? [raw.image.trim()]
      : [];

  const compareAt = raw.compareAtPrice;
  const cost = raw.costPerItem;
  const commission = raw.commissionRate;

  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? raw.title ?? ""),
    sku: String(raw.sku ?? ""),
    price: parseProductMoney(raw.price),
    compareAtPrice:
      compareAt != null && compareAt !== "" ? parseProductMoney(compareAt) : undefined,
    costPerItem: cost != null && cost !== "" ? parseProductMoney(cost) : undefined,
    description: String(raw.description ?? ""),
    images,
    category: categoryLabel,
    inventory: Number(raw.inventory ?? raw.stock ?? 0) || 0,
    status: String(raw.status ?? "Active"),
    hasVariants: Boolean(raw.hasVariants),
    variants: Array.isArray(raw.variants) ? raw.variants : [],
    variantOptions: Array.isArray(raw.variantOptions) ? raw.variantOptions : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    productType: String(raw.productType ?? "").trim(),
    weight: String(raw.weight ?? "").trim(),
    barcode: String(raw.barcode ?? "").trim(),
    trackQuantity: raw.trackQuantity !== false,
    continueSellingOutOfStock: Boolean(raw.continueSellingOutOfStock),
    commissionRate:
      commission != null && commission !== ""
        ? Number(commission) || 0
        : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
  };
}

export function VendorAdminProductViewPage() {
  const { storeName, productId } = useVendorAdminRouteParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { clean: vendorHostCleanAdmin } = useVendorHostCleanAdmin();
  const onVendorHostCleanAdmin =
    vendorHostCleanAdmin && pathnameUnderAdmin(location.pathname);
  const adminPrefix = onVendorHostCleanAdmin ? null : "vendor";
  const { vendor } = useVendorAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProduct = useCallback(async () => {
    if (!vendor?.vendorId || !productId) return;

    setLoading(true);
    try {
      const [productRes, categories] = await Promise.all([
        getCachedProductById(productId),
        fetchVendorCategories(vendor.vendorId).catch(() => []),
      ]);

      const raw = ((productRes as { product?: Record<string, unknown> })?.product ??
        productRes) as Record<string, unknown>;

      if (!raw?.id || !productBelongsToVendor(raw, vendor.vendorId)) {
        setProduct(null);
        return;
      }

      const categoryMap = buildVendorProductCategoryLabels(categories);
      const categoryLabel = resolveVendorProductCategoryLabel(
        String(raw.id),
        String(raw.category ?? ""),
        categoryMap,
        t("products.uncategorized"),
      );

      setProduct(mapProductDetailFromApi(raw, categoryLabel));
    } catch (error) {
      console.error("Failed to load product:", error);
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [productId, t, vendor?.vendorId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  const handleBack = () => {
    if (onVendorHostCleanAdmin) {
      navigate("/admin/products");
      return;
    }
    if (adminPrefix && storeName) {
      navigate(`/${adminPrefix}/${storeName}/admin/products`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-purple-600 mx-auto" />
          <p className="text-slate-600 font-medium">Loading product details...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center space-y-4">
          <Package className="w-16 h-16 text-slate-300 mx-auto" />
          <h2 className="text-2xl font-bold text-slate-900">Product Not Found</h2>
          <p className="text-slate-600">The product you're looking for doesn't exist.</p>
          <Button onClick={handleBack} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Products
          </Button>
        </div>
      </div>
    );
  }

  const statusLabel =
    product.status === "off-shelf"
      ? t("products.offShelf")
      : product.status === "active" || product.status === "Active"
        ? t("products.active")
        : product.status;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Products
              </Button>
              <div className="h-6 w-px bg-slate-200" />
              <h1 className="text-2xl font-bold text-slate-900">Product Details</h1>
            </div>
            <Badge
              variant="secondary"
              className={
                product.status === "active" || product.status === "Active"
                  ? "bg-green-100 text-green-700 border-green-200 text-sm px-3 py-1"
                  : "bg-slate-100 text-slate-700 border-slate-200 text-sm px-3 py-1"
              }
            >
              {statusLabel}
            </Badge>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {product.images.length > 0 && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Product Images</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {product.images.map((img, idx) => (
                    <img
                      key={`${img}-${idx}`}
                      src={img}
                      alt={`${product.name} - ${idx + 1}`}
                      className="w-full h-48 object-cover rounded-lg border border-slate-200"
                    />
                  ))}
                </div>
              </Card>
            )}

            <Card className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Basic Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Product Name
                  </label>
                  <p className="text-base font-semibold text-slate-900 mt-1">{product.name}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    SKU
                  </label>
                  <p className="text-base font-mono text-slate-900 mt-1">{product.sku || "—"}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Category
                  </label>
                  <p className="text-base text-slate-900 mt-1">{product.category}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Product Type
                  </label>
                  <p className="text-base text-slate-900 mt-1">{product.productType || "—"}</p>
                </div>
              </div>
            </Card>

            {product.description && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Description</h3>
                <div className="prose max-w-none">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {stripHtml(product.description)}
                  </p>
                </div>
              </Card>
            )}

            {product.hasVariants && product.variants.length > 0 && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Variants</h3>
                <div className="space-y-3">
                  {product.variants.map((variant: any, idx: number) => (
                    <div
                      key={variant.id ?? idx}
                      className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200"
                    >
                      {variant.image && (
                        <img
                          src={variant.image}
                          alt={variant.name}
                          className="w-16 h-16 rounded object-cover border border-slate-200"
                        />
                      )}
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{variant.name}</p>
                        <p className="text-sm text-slate-500">SKU: {variant.sku || "—"}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900">
                          {Math.round(parseProductMoney(variant.price)).toLocaleString()} MMK
                        </p>
                        <p className="text-sm text-slate-500">
                          Stock: {Number(variant.inventory ?? variant.stock ?? 0) || 0}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {product.tags.length > 0 && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {product.tags.map((tag, idx) => (
                    <Badge key={`${tag}-${idx}`} variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Pricing</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Price
                  </label>
                  <p className="text-2xl font-bold text-slate-900 mt-1">
                    {Math.round(product.price).toLocaleString()} MMK
                  </p>
                </div>
                {product.compareAtPrice != null && product.compareAtPrice > 0 && (
                  <div>
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      Compare At Price
                    </label>
                    <p className="text-lg text-slate-600 mt-1 line-through">
                      {Math.round(product.compareAtPrice).toLocaleString()} MMK
                    </p>
                  </div>
                )}
                {product.costPerItem != null && product.costPerItem > 0 && (
                  <div>
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      Cost Per Item
                    </label>
                    <p className="text-lg text-slate-900 mt-1">
                      {Math.round(product.costPerItem).toLocaleString()} MMK
                    </p>
                  </div>
                )}
                {product.commissionRate != null && product.commissionRate > 0 && (
                  <div>
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      Commission Rate
                    </label>
                    <p className="text-lg text-slate-900 mt-1">{product.commissionRate}%</p>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Inventory</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Available
                  </label>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{product.inventory} units</p>
                </div>
                {product.barcode && (
                  <div>
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      Barcode
                    </label>
                    <p className="text-base font-mono text-slate-900 mt-1">{product.barcode}</p>
                  </div>
                )}
                {product.weight && (
                  <div>
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      Weight
                    </label>
                    <p className="text-base text-slate-900 mt-1">{product.weight}</p>
                  </div>
                )}
              </div>
            </Card>

            {(product.createdAt || product.updatedAt) && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Timestamps</h3>
                <div className="space-y-3">
                  {product.createdAt && (
                    <div>
                      <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                        Created
                      </label>
                      <p className="text-sm text-slate-900 mt-1">
                        {new Date(product.createdAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {product.updatedAt && (
                    <div>
                      <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                        Last Updated
                      </label>
                      <p className="text-sm text-slate-900 mt-1">
                        {new Date(product.updatedAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
