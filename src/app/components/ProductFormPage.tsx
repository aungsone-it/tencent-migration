import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Upload, X, Plus, Calendar as CalendarIcon, ChevronDown, Image as ImageIcon, Sparkles, Loader2, Trash2, GripVertical, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Checkbox } from "./ui/checkbox";
import { toast } from "sonner";
import { compressImageToDataURL, compressImageToFile } from "../../utils/imageCompression";
import { RichTextEditor } from "./RichTextEditor";
import { productsApi } from "../../utils/api";
import { apiCache } from "../utils/cache";
import { CategorySelect } from "./CategorySelect";
import { useLanguage } from "../contexts/LanguageContext";
import { IMAGE_CONFIG } from "../../constants";
import {
  applyImageToOptionValue,
  generateProductFormVariants,
  findDuplicateVariantSkus,
  LIVE_VARIANT_SKU_CHECK_LIMIT,
  optionValueImageKey,
  optionValueImagesFromVariants,
  sanitizeVariantOptions,
  sharedImageForOptionValue,
  variantOptionSlotIndex,
  visualOptionIndex,
} from "../utils/productFormVariants";
import { projectId, publicAnonKey, cloudbaseApiBaseUrl, cloudbasePublishableKey, getCloudBaseRequestHeaders } from "../../../utils/supabase/info";

// Separator Component
function Separator() {
  return <div className="border-t border-slate-200" />;
}

interface Variant {
  id: string;
  option1: string;
  option2?: string;
  option3?: string;
  price: string;
  compareAtPrice?: string;
  sku: string;
  barcode?: string;
  inventory: number;
  weight?: string;
  image?: string;
}

const MAX_PRODUCT_IMAGES = IMAGE_CONFIG.MAX_IMAGES_PER_PRODUCT;

/** Parse stored/display prices ($, MMK, commas) for validation and save. */
function parsePriceInput(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^\d.-]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatPriceForForm(value: unknown): string {
  const n = parsePriceInput(value);
  return n > 0 ? String(n) : "";
}

function normalizeVariantForForm(raw: Record<string, unknown>, idx: number): Variant {
  return {
    id: String(raw.id ?? `variant-${idx}`),
    option1: String(raw.option1 ?? ""),
    option2: raw.option2 != null ? String(raw.option2) : undefined,
    option3: raw.option3 != null ? String(raw.option3) : undefined,
    price: formatPriceForForm(raw.price),
    compareAtPrice:
      raw.compareAtPrice != null ? formatPriceForForm(raw.compareAtPrice) : undefined,
    sku: String(raw.sku ?? ""),
    barcode: raw.barcode != null ? String(raw.barcode) : undefined,
    inventory: Number(raw.inventory) || 0,
    weight: raw.weight != null ? String(raw.weight) : undefined,
    image: raw.image != null ? String(raw.image) : undefined,
  };
}

function variantsMatchOptions(a: Variant, b: Variant): boolean {
  return (
    a.option1 === b.option1 &&
    (a.option2 ?? "") === (b.option2 ?? "") &&
    (a.option3 ?? "") === (b.option3 ?? "")
  );
}

function mergeVariantsWithInitial(
  current: Variant[],
  initial: unknown[] | undefined
): Variant[] {
  if (!Array.isArray(initial) || initial.length === 0) return current;
  const initialNorm = initial.map((v, i) =>
    normalizeVariantForForm(v as Record<string, unknown>, i)
  );
  return current.map((v) => {
    const match =
      initialNorm.find((init) => init.id && v.id && init.id === v.id) ||
      initialNorm.find((init) => variantsMatchOptions(v, init));
    if (!match) return v;
    return {
      ...v,
      price: parsePriceInput(v.price) > 0 ? v.price : match.price || v.price,
      sku: v.sku?.trim() ? v.sku : match.sku || v.sku,
      inventory: v.inventory ?? match.inventory,
      weight: v.weight?.trim() ? v.weight : match.weight,
      compareAtPrice:
        v.compareAtPrice?.trim() ? v.compareAtPrice : match.compareAtPrice,
      image: v.image?.trim() ? v.image : match.image,
    };
  });
}

function deriveVariantOptionsFromVariants(
  variantRows: Array<{ option1?: string; option2?: string; option3?: string }>,
): { name: string; values: string[] }[] {
  const optionValues: string[][] = [[], [], []];
  for (const row of variantRows) {
    const values = [row.option1, row.option2, row.option3];
    values.forEach((value, index) => {
      const trimmed = String(value || "").trim();
      if (!trimmed) return;
      if (!optionValues[index].includes(trimmed)) {
        optionValues[index].push(trimmed);
      }
    });
  }
  return optionValues
    .map((values, index) => ({
      name: `Option ${index + 1}`,
      values,
    }))
    .filter((option) => option.values.length > 0);
}

interface ProductFormPageProps {
  mode: "add" | "edit" | "view";
  initialData?: any;
  onSave?: (data: any) => void;
  onCancel?: () => void;
}

export function ProductFormPage({ mode, initialData, onSave, onCancel }: ProductFormPageProps) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(initialData?.name || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [specifications, setSpecifications] = useState<{ label: string; value: string }[]>(() => {
    const raw = initialData?.specifications;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((s: { label?: string; value?: string }) => ({
        label: String(s.label ?? ""),
        value: String(s.value ?? ""),
      }));
    }
    return [{ label: "", value: "" }];
  });
  const [price, setPrice] = useState(() => formatPriceForForm(initialData?.price) || "");
  const [compareAtPrice, setCompareAtPrice] = useState(() => formatPriceForForm(initialData?.compareAtPrice) || "");
  const [costPerItem, setCostPerItem] = useState(() => formatPriceForForm(initialData?.costPerItem) || "");
  const [commissionRate, setCommissionRate] = useState(initialData?.commissionRate?.toString() || ""); // 🔥 Commission rate
  const [sku, setSku] = useState(initialData?.sku || "");
  const [barcode, setBarcode] = useState(initialData?.barcode || "");
  const [inventory, setInventory] = useState(initialData?.inventory || 0);
  const [weight, setWeight] = useState(initialData?.weight || "");
  const [category, setCategory] = useState(initialData?.category || "");
  const [selectedVendors, setSelectedVendors] = useState<string[]>(initialData?.selectedVendors || []); // 🔥 Multi-select vendors
  const [status, setStatus] = useState(initialData?.status || "active");
  const [trackQuantity, setTrackQuantity] = useState(initialData?.trackQuantity !== undefined ? initialData.trackQuantity : true);
  const [continueSellingOutOfStock, setContinueSellingOutOfStock] = useState(initialData?.continueSellingOutOfStock || false);
  const [isSaving, setIsSaving] = useState(false);
  
  // 🔥 NEW: Dynamic vendor list from backend (only approved vendors)
  const [vendors, setVendors] = useState<any[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  
  // SKU validation states
  const [skuError, setSkuError] = useState<string>("");
  const [isCheckingSku, setIsCheckingSku] = useState(false);
  const [variantSkuErrors, setVariantSkuErrors] = useState<{ [key: string]: string }>({});
  
  // Variants
  const [hasVariants, setHasVariants] = useState(false);
  const [variantOptions, setVariantOptions] = useState<{ name: string; values: string[] }[]>([
    { name: "", values: [""] },
  ]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [optionValueImages, setOptionValueImages] = useState<Record<string, string>>({});
  const [isInitializing, setIsInitializing] = useState(true); // 🔥 NEW: Track if we're loading initial data
  const variantsRef = useRef<Variant[]>([]);
  const variantOptionsRef = useRef(variantOptions);
  const defaultPriceRef = useRef(price);
  variantsRef.current = variants;

  const patchVariant = (id: string, patch: Partial<Variant>) => {
    setVariants((prev) => prev.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)));
  };
  const visualUiIndex = visualOptionIndex(variantOptions);
  const visualSlot = variantOptionSlotIndex(variantOptions, visualUiIndex);
  const visualOptionName = variantOptions[visualUiIndex]?.name?.trim() || "this option";
  
  // Initialize variants from initialData when editing
  useEffect(() => {
    if (mode === "edit" && initialData) {
      console.log("📝 ====== EDIT MODE INITIALIZATION ======");
      console.log("📝 Initial Data:", JSON.stringify(initialData, null, 2));
      console.log("📝 Has Variants?:", initialData.hasVariants);
      console.log("📝 Variants Data:", JSON.stringify(initialData.variants, null, 2));
      console.log("📝 Variant Options:", JSON.stringify(initialData.variantOptions, null, 2));
      
      // Check if product has variants
      if (initialData.hasVariants && initialData.variants && initialData.variants.length > 0) {
        console.log("📝 Loading existing variants - Count:", initialData.variants.length);
        
        // Log each variant
        initialData.variants.forEach((v: any, idx: number) => {
          console.log(`📝 Variant ${idx}:`, {
            id: v.id,
            option1: v.option1,
            option2: v.option2,
            option3: v.option3,
            price: v.price,
            sku: v.sku,
            inventory: v.inventory,
            weight: v.weight
          });
        });
        
        setHasVariants(true);
        
        // Set variants FIRST before variantOptions to preserve data
        const loadedVariants = initialData.variants.map(
          (v: Record<string, unknown>, idx: number) => normalizeVariantForForm(v, idx)
        );
        setVariants(loadedVariants);
        console.log("✅ Set variants state with", initialData.variants.length, "variants");
        
        // Reconstruct variant options from variants
        if (initialData.variantOptions && initialData.variantOptions.length > 0) {
          console.log("📝 Loading variant options:", initialData.variantOptions);
          setVariantOptions(initialData.variantOptions);
          variantOptionsRef.current = initialData.variantOptions;
          setOptionValueImages(
            optionValueImagesFromVariants(initialData.variantOptions, loadedVariants)
          );
          console.log("✅ Set variantOptions state");
        } else {
          const derivedOptions = deriveVariantOptionsFromVariants(initialData.variants);
          if (derivedOptions.length > 0) {
            console.log("📝 Derived variant options from variants:", derivedOptions);
            setVariantOptions(derivedOptions);
            variantOptionsRef.current = derivedOptions;
            setOptionValueImages(optionValueImagesFromVariants(derivedOptions, loadedVariants));
          } else {
            console.log("⚠️ No variantOptions found, will not auto-generate");
          }
        }
      } else if (initialData.hasVariants) {
        // Has variants flag but no variants data - enable the section
        console.log("⚠️ Product has variants flag but no variant data");
        setHasVariants(true);
      }
      
      console.log("📝 ====== END INITIALIZATION ======");
    }
    
    // 🔥 Mark initialization as complete after a brief delay
    setTimeout(() => {
      setIsInitializing(false);
      console.log("✅ Initialization complete - isInitializing set to false");
    }, 100);
  }, [mode, initialData]);
  
  // Media
  const [images, setImages] = useState<string[]>(() => {
    // Handle both image (singular) and images (array) from initialData
    if (initialData?.images && Array.isArray(initialData.images)) {
      return initialData.images;
    }
    if (initialData?.image) {
      return [initialData.image];
    }
    return []; // Start with empty array - first uploaded image becomes cover
  });
  const [uploadingImages, setUploadingImages] = useState(false);

  // Tags
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [tagInput, setTagInput] = useState("");

  // Product organization
  const [productType, setProductType] = useState(initialData?.productType || "");
  const [collections, setCollections] = useState<string[]>(initialData?.collections || []);

  const isReadOnly = mode === "view";

  // Debounced SKU validation for main product
  useEffect(() => {
    if (!sku || !sku.trim() || isReadOnly || hasVariants) {
      setSkuError("");
      setIsCheckingSku(false);
      return;
    }

    setIsCheckingSku(true);
    const timeoutId = setTimeout(async () => {
      try {
        const result = await productsApi.checkSku(sku, initialData?.id);
        if (!result.isUnique) {
          setSkuError(
            t("addProduct.skuAlreadyExists").replace(
              "{name}",
              result.existingProduct?.name || t("addProduct.anotherProduct")
            )
          );
        } else {
          setSkuError("");
        }
      } catch (error) {
        console.error("Error checking SKU:", error);
        setSkuError("");
      } finally {
        setIsCheckingSku(false);
      }
    }, 600); // Wait 600ms after user stops typing

    return () => clearTimeout(timeoutId);
  }, [sku, isReadOnly, hasVariants, initialData?.id, t]);

  // Debounced SKU validation for variants
  useEffect(() => {
    if (!hasVariants || isReadOnly || variants.length === 0) {
      setVariantSkuErrors({});
      return;
    }

    const timeoutId = setTimeout(async () => {
      const errors: { [key: string]: string } = {};
      const duplicateSkus = findDuplicateVariantSkus(variants);
      duplicateSkus.forEach((_, variantId) => {
        const skuValue = variants.find((v) => v.id === variantId)?.sku?.trim() || "";
        errors[variantId] = t("addProduct.duplicateSku").replace("{sku}", skuValue);
      });

      const uniqueSkus = [
        ...new Set(
          variants
            .filter((variant) => !errors[variant.id] && variant.sku?.trim())
            .map((variant) => variant.sku.trim())
        ),
      ];

      // Per-keystroke remote checks explode at 5×15 (75 SKUs). Local dupes still show;
      // the save API verifies uniqueness for the full set.
      if (uniqueSkus.length > 0 && uniqueSkus.length <= LIVE_VARIANT_SKU_CHECK_LIMIT) {
        const remote = await Promise.all(
          uniqueSkus.map(async (value) => {
            try {
              const result = await productsApi.checkSku(value, initialData?.id);
              return { value, result };
            } catch (error) {
              console.error(`Error checking SKU ${value}:`, error);
              return null;
            }
          })
        );
        const taken = new Map<string, string>();
        for (const row of remote) {
          if (!row || row.result.isUnique) continue;
          taken.set(
            row.value.toLowerCase(),
            t("addProduct.skuExistsIn").replace(
              "{name}",
              row.result.existingProduct?.name || t("addProduct.anotherProduct")
            )
          );
        }
        for (const variant of variants) {
          if (errors[variant.id]) continue;
          const message = taken.get(variant.sku.trim().toLowerCase());
          if (message) errors[variant.id] = message;
        }
      }

      setVariantSkuErrors(errors);
    }, 600);

    return () => clearTimeout(timeoutId);
  }, [
    variants.map((variant) => `${variant.id}:${variant.sku}`).join("|"),
    hasVariants,
    isReadOnly,
    initialData?.id,
    t,
  ]);

  // 🔥 Fetch approved vendors on mount
  useEffect(() => {
    const fetchVendors = async () => {
      setLoadingVendors(true);
      try {
        const response = await fetch(
          `${cloudbaseApiBaseUrl}/vendors`,
          {
            headers: {
              ...getCloudBaseRequestHeaders(),

              ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
            },
          }
        );
        
        if (response.ok) {
          const data = await response.json();
          // 🔥 Filter to only show ACTIVE (approved) vendors
          const approvedVendors = (data.vendors || []).filter((v: any) => v.status === 'active');
          setVendors(approvedVendors);
          console.log(`✅ MULTI-SELECT VENDORS: Loaded ${approvedVendors.length} approved vendors`, approvedVendors);
        }
      } catch (error) {
        console.error('❌ Failed to fetch vendors:', error);
      } finally {
        setLoadingVendors(false);
      }
    };
    
    fetchVendors();
  }, []);


  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  // Helper function to parse price for display (removes $ and currency symbols)
  const parsePriceForDisplay = (price: string | number | undefined | null): string => {
    if (price === undefined || price === null || price === '') return '';
    
    try {
      const priceStr = String(price);
      // Remove $ and other currency symbols, extract just the number
      const numericPrice = priceStr.replace(/[$,MMK\s]/g, '').trim();
      
      // Validate it's a valid number
      if (numericPrice === '' || isNaN(Number(numericPrice))) {
        return '';
      }
      
      return numericPrice;
    } catch (error) {
      console.error('Error parsing price for display:', error, 'value:', price);
      return '';
    }
  };

  const addVariantOption = () => {
    if (variantOptions.length < 3) {
      setVariantOptions([...variantOptions, { name: `Option ${variantOptions.length + 1}`, values: [""] }]);
    }
  };

  const updateVariantOptionName = (index: number, name: string) => {
    const updated = [...variantOptions];
    updated[index].name = name;
    setVariantOptions(updated);
  };

  const updateVariantOptionValues = (index: number, values: string) => {
    const updated = [...variantOptions];
    updated[index].values = values.split(",").map(v => v.trim()).filter(v => v);
    setVariantOptions(updated);
  };

  const removeVariantOption = (index: number) => {
    setVariantOptions(variantOptions.filter((_, i) => i !== index));
  };

  // New functions for individual variant value management
  const addSingleVariantValue = (optionIndex: number) => {
    const updated = [...variantOptions];
    updated[optionIndex].values.push('');
    setVariantOptions(updated);
  };

  const updateSingleVariantValue = (optionIndex: number, valueIndex: number, newValue: string) => {
    const updated = [...variantOptions];
    updated[optionIndex].values[valueIndex] = newValue;
    setVariantOptions(updated);
  };

  const removeSingleVariantValue = (optionIndex: number, valueIndex: number) => {
    const updated = [...variantOptions];
    updated[optionIndex].values = updated[optionIndex].values.filter((_, i) => i !== valueIndex);
    setVariantOptions(updated);
  };

  // Auto-generate variants when variant options change
  useEffect(() => {
    if (isInitializing && mode === "edit") {
      return;
    }

    if (!hasVariants || variantOptions.length === 0) {
      if (!(mode === "edit" && variantsRef.current.length > 0) && variantsRef.current.length > 0) {
        setVariants([]);
      }
      variantOptionsRef.current = variantOptions;
      defaultPriceRef.current = price;
      return;
    }

    const validOptions = variantOptions.filter((opt) => opt.values.some((v) => v.trim() !== ""));
    if (validOptions.length === 0) {
      if (!(mode === "edit" && variantsRef.current.length > 0)) {
        setVariants([]);
      }
      variantOptionsRef.current = variantOptions;
      defaultPriceRef.current = price;
      return;
    }

    const nextVariants = generateProductFormVariants({
      options: variantOptions,
      previous: variantsRef.current,
      previousOptions: variantOptionsRef.current,
      optionValueImages,
      defaultPrice: price,
      previousDefaultPrice: defaultPriceRef.current,
    });
    variantOptionsRef.current = variantOptions;
    defaultPriceRef.current = price;
    setVariants(nextVariants);
  }, [hasVariants, variantOptions, isInitializing, mode, optionValueImages, price]);

  const handleProductStatusChange = (newStatus: string) => {
    setStatus(newStatus);
  };

  const handleSubmit = async () => {
    // Validation: Check required fields based on whether variants are enabled
    if (!title) {
      toast.error(t("addProduct.fillTitle"));
      return;
    }

    if (isCheckingSku) {
      toast.error(t("addProduct.waitSkuValidation"));
      return;
    }
    if (skuError) {
      toast.error(t("addProduct.fixSkuError"));
      return;
    }
    if (Object.values(variantSkuErrors).some(Boolean)) {
      toast.error(t("addProduct.fixVariantSkuErrors"));
      return;
    }

    const isOffShelf = status === "off-shelf";
    const variantsForSave =
      mode === "edit"
        ? mergeVariantsWithInitial(variants, initialData?.variants)
        : variants;
    if (hasVariants) {
      const duplicateSkus = findDuplicateVariantSkus(variantsForSave);
      if (duplicateSkus.size > 0) {
        const nextErrors: { [key: string]: string } = {};
        duplicateSkus.forEach((_, variantId) => {
          const skuValue = variantsForSave.find((v) => v.id === variantId)?.sku?.trim() || "";
          nextErrors[variantId] = t("addProduct.duplicateSku").replace("{sku}", skuValue);
        });
        setVariantSkuErrors((prev) => ({ ...prev, ...nextErrors }));
        toast.error(t("addProduct.duplicateSkusNotAllowed"));
        return;
      }
    }

    // Off-shelf products can be saved without price/SKU checks (hide from storefront only)
    if (!isOffShelf) {
      if (hasVariants) {
        if (variantsForSave.length === 0) {
          toast.error(t("addProduct.addAtLeastOneVariant"));
          return;
        }
        const hasValidVariant = variantsForSave.some((v) => v.sku && v.sku.trim() !== "");
        if (!hasValidVariant) {
          toast.error(t("addProduct.fillVariantSku"));
          return;
        }
        const hasVariantWithPrice = variantsForSave.some((v) => parsePriceInput(v.price) > 0);
        if (!hasVariantWithPrice) {
          toast.error(t("addProduct.fillVariantPrice"));
          return;
        }
      } else {
        if (parsePriceInput(price) <= 0) {
          toast.error(t("addProduct.fillRequiredFields"));
          return;
        }
        if (!sku?.trim()) {
          toast.error(t("addProduct.fillRequiredFields"));
          return;
        }
      }
    }
    
    setIsSaving(true);
    
    try {
      // Log the images being saved
      console.log(`💾 Saving product with ${images.length} images`);
      if (images.length > 0) {
        const firstImagePreview = images[0].substring(0, 50);
        console.log(`📸 First image preview: ${firstImagePreview}...`);
      }
      
      // Calculate summary data for variant products
      let finalPrice = price;
      let finalInventory = inventory;
      let finalSku = sku;
      
      if (hasVariants && variantsForSave.length > 0) {
        // Calculate total inventory from all variants
        finalInventory = variantsForSave.reduce((sum, v) => sum + (v.inventory || 0), 0);
        
        // Get the lowest price from variants (for display)
        const variantPrices = variantsForSave
          .map((v) => parsePriceInput(v.price))
          .filter((p) => p > 0);
        
        if (variantPrices.length > 0) {
          finalPrice = Math.min(...variantPrices).toString();
        } else {
          finalPrice = "0";
        }
        
        // Use first variant's SKU as the base SKU
        finalSku = variantsForSave[0]?.sku || "";
        
        console.log(`📊 Variant Summary: ${variantsForSave.length} variants, Total inventory: ${finalInventory}, Base price: $${finalPrice}`);
      }
      
      // Upload inline images separately so the JSON payload stays under CloudBase limits
      const hasInlineImages =
        images.some((img) => typeof img === "string" && img.startsWith("data:image/")) ||
        (hasVariants &&
          variantsForSave.some(
            (v) => typeof (v as { image?: string }).image === "string" &&
              (v as { image: string }).image.startsWith("data:image/")
          ));
      if (hasInlineImages) {
        toast.info(t("addProduct.uploadingProductImages"), { duration: 3000 });
      }

      const specificationsForSave = specifications
        .map((s) => ({ label: s.label.trim(), value: s.value.trim() }))
        .filter((s) => s.label.length > 0);

      const data = {
        name: title,
        description,
        specifications: specificationsForSave,
        price: `$${finalPrice}`,
        compareAtPrice,
        costPerItem,
        ...(commissionRate.trim() !== ""
          ? { commissionRate: parseFloat(commissionRate) }
          : {}),
        sku: finalSku,
        barcode,
        inventory: finalInventory,
        weight,
        category,
        selectedVendors,
        status,
        trackQuantity,
        continueSellingOutOfStock,
        hasVariants,
        variantOptions: hasVariants ? sanitizeVariantOptions(variantOptions) : [],
        variants: hasVariants ? variantsForSave : [],
        images,
        tags,
        productType,
        collections,
        salesVolume: initialData?.salesVolume || 0,
        createDate: initialData?.createdAt || new Date().toISOString(),
      };
      
      // 🔍 DEBUG: Log what we're sending to the API
      console.log('🚀 SUBMITTING PRODUCT DATA:', {
        hasVariants,
        variantOptionsCount: variantOptions.length,
        variantsCount: variants.length,
        variantOptions: hasVariants ? variantOptions : 'DISABLED',
        variants: hasVariants ? variants : 'DISABLED'
      });
      
      // Log payload size
      const payloadSize = JSON.stringify(data).length;
      const sizeInMB = (payloadSize / (1024 * 1024)).toFixed(2);
      console.log(`📦 Total payload size: ${(payloadSize / 1024).toFixed(2)} KB (${sizeInMB} MB)`);
      
      // Warn if payload is too large
      if (payloadSize > 4 * 1024 * 1024) { // 4MB warning threshold
        toast.warning(t("addProduct.largeUpload").replace("{size}", sizeInMB), { duration: 3000 });
      }
      
      // If editing, pass the product ID as the first argument
      if (mode === "edit" && initialData?.id) {
        await onSave?.(initialData.id, data);
      } else {
        await onSave?.(data);
      }
    } catch (error) {
      console.error("Error saving product:", error);
      toast.error(error instanceof Error ? error.message : t("addProduct.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setUploadingImages(true);
      toast.info(t("addProduct.compressingImages"), { duration: 2000 });
      
      try {
        // Convert FileList to Array and filter only images
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        
        if (imageFiles.length === 0) {
          toast.error(t("addProduct.noValidImages"));
          setUploadingImages(false);
          return;
        }
        
        // Compress locally only — same as description editor. Storage upload happens on Save.
        const dataUrls: string[] = [];
        const availableSlots = Math.max(0, MAX_PRODUCT_IMAGES - images.length);
        const filesToProcess = imageFiles.slice(0, availableSlots);
        if (filesToProcess.length === 0) {
          toast.error(t("addProduct.maxImages").replace("{count}", String(MAX_PRODUCT_IMAGES)));
          setUploadingImages(false);
          return;
        }
        for (const file of filesToProcess) {
          dataUrls.push(await compressImageToDataURL(file, 500));
        }

        setImages((prev) => [...dataUrls, ...prev].slice(0, MAX_PRODUCT_IMAGES));
        toast.success(t("addProduct.imagesAdded").replace("{count}", String(dataUrls.length)));
      } catch (error) {
        console.error("Error uploading images:", error);
        toast.error(
          error instanceof Error ? error.message : t("addProduct.failedToUpload")
        );
      } finally {
        setUploadingImages(false);
        e.target.value = ''; // Reset input
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0 && images.length < MAX_PRODUCT_IMAGES) {
      setUploadingImages(true);
      toast.info(t("addProduct.compressingImages"), { duration: 2000 });
      
      try {
        // Convert FileList to Array and filter only images
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        
        if (imageFiles.length === 0) {
          toast.error(t("addProduct.noValidImages"));
          setUploadingImages(false);
          return;
        }
        
        // Limit to available slots
        const availableSlots = MAX_PRODUCT_IMAGES - images.length;
        const filesToProcess = imageFiles.slice(0, availableSlots);
        
        // Compress locally only — uploads to storage when you Save
        const dataUrls: string[] = [];
        for (const file of filesToProcess) {
          dataUrls.push(await compressImageToDataURL(file, 500));
        }

        setImages((prev) => [...dataUrls, ...prev]);
        toast.success(t("addProduct.imagesAdded").replace("{count}", String(dataUrls.length)));
      } catch (error) {
        console.error("Error uploading images:", error);
        toast.error(
          error instanceof Error ? error.message : t("addProduct.failedToUpload")
        );
      } finally {
        setUploadingImages(false);
      }
    }
  };

  const setAsMainImage = (index: number) => {
    const newImages = [...images];
    const [selectedImage] = newImages.splice(index, 1);
    newImages.unshift(selectedImage);
    setImages(newImages);
  };
  
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('addProduct.back')}
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  {mode === "add" ? t('addProduct.title') : mode === "edit" ? t('addProduct.editTitle') : t('addProduct.viewTitle')}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!isReadOnly && (
                <>
                  <Button variant="outline" onClick={onCancel} disabled={isSaving}>
                    {t('addProduct.cancel')}
                  </Button>
                  <Button 
                    onClick={handleSubmit} 
                    disabled={isSaving}
                    className="bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-50"
                  >
                    {isSaving && <Sparkles className="w-4 h-4 mr-2 animate-spin" />}
                    {isSaving ? t('addProduct.saving') : t('addProduct.save')}
                  </Button>
                </>
              )}
              {isReadOnly && (
                <Button variant="outline" onClick={onCancel}>
                  {t('addProduct.close')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="flex gap-6">
          {/* Left Column - Main Form */}
          <div className="flex-1 space-y-6">
            {/* Title & Description */}
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="title">{t('addProduct.productTitle')}</Label>
                    <Input
                      id="title"
                      placeholder={t('addProduct.titlePlaceholder')}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={isReadOnly}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="description">{t('addProduct.description')}</Label>
                    <div className="mt-2">
                      <RichTextEditor
                        value={description}
                        onChange={setDescription}
                        placeholder={t('addProduct.descriptionPlaceholder')}
                        readOnly={isReadOnly}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {t('addProduct.detailsHint')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Specifications */}
            <Card>
              <CardHeader>
                <CardTitle>{t('addProduct.specifications')}</CardTitle>
                <CardDescription>{t('addProduct.specificationsCardHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-slate-500">{t('addProduct.specificationsHint')}</p>
                <div className="space-y-2">
                  {specifications.map((spec, index) => (
                    <div key={index} className="flex gap-2 items-start">
                      <Input
                        placeholder={t('addProduct.specLabelPlaceholder')}
                        value={spec.label}
                        onChange={(e) => {
                          const next = [...specifications];
                          next[index] = { ...next[index], label: e.target.value };
                          setSpecifications(next);
                        }}
                        disabled={isReadOnly}
                        className="flex-1"
                      />
                      <Input
                        placeholder={t('addProduct.specValuePlaceholder')}
                        value={spec.value}
                        onChange={(e) => {
                          const next = [...specifications];
                          next[index] = { ...next[index], value: e.target.value };
                          setSpecifications(next);
                        }}
                        disabled={isReadOnly}
                        className="flex-1"
                      />
                      {!isReadOnly && specifications.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-slate-500 hover:text-red-600"
                          onClick={() => setSpecifications(specifications.filter((_, i) => i !== index))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {!isReadOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSpecifications([...specifications, { label: "", value: "" }])}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {t('addProduct.addSpecification')}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Media */}
            <Card>
              <CardHeader>
                <CardTitle>{t('addProduct.media')}</CardTitle>
                <CardDescription>
                  {t('addProduct.mediaHint').replace('{count}', String(MAX_PRODUCT_IMAGES))}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Upload Zone */}
                {!isReadOnly && (
                  <div className="relative min-h-[11rem] rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 transition-colors hover:border-purple-400">
                    {uploadingImages ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
                        <Loader2 className="h-10 w-10 animate-spin text-purple-600" />
                        <p className="text-sm font-medium text-slate-700">{t('addProduct.uploadingImages')}</p>
                      </div>
                    ) : (
                      <label
                        htmlFor="image-upload"
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 p-8 text-center"
                      >
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-100">
                          <ImageIcon className="h-7 w-7 text-purple-600" />
                        </div>
                        <div>
                          <span className="text-sm font-medium text-purple-600 hover:text-purple-700">
                            {t('addProduct.clickToUpload')}
                          </span>
                          <span className="text-sm text-slate-500">{t('addProduct.orDragAndDrop')}</span>
                          <p className="mt-1 text-xs text-slate-500">
                            {t('addProduct.uploadFormats')
                              .replace('{count}', String(MAX_PRODUCT_IMAGES - images.length))
                              .replace(
                                '{unit}',
                                MAX_PRODUCT_IMAGES - images.length === 1
                                  ? t('addProduct.slot')
                                  : t('addProduct.slots')
                              )}
                          </p>
                        </div>
                      </label>
                    )}
                    <input
                      id="image-upload"
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="sr-only"
                      disabled={images.length >= MAX_PRODUCT_IMAGES || uploadingImages}
                    />
                  </div>
                )}
                
                {/* Image Grid */}
                {images.length > 0 && (
                  <div className="grid grid-cols-4 gap-4">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative group aspect-square">
                        <img
                          src={img}
                          alt={`Product ${idx + 1}`}
                          className="w-full h-full object-cover rounded-lg border-2 border-slate-200 group-hover:border-purple-400 transition-colors"
                        />
                        
                        {/* Overlay Controls */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                          {!isReadOnly && idx > 0 && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setAsMainImage(idx)}
                              className="h-8 text-xs"
                            >
                              {t('addProduct.setAsMain')}
                            </Button>
                          )}
                          {!isReadOnly && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setImages(images.filter((_, i) => i !== idx))}
                              className="h-8"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                        
                        {/* Main Badge */}
                        {idx === 0 && (
                          <Badge className="absolute top-2 left-2 bg-purple-600 text-white border-0 shadow-md">
                            {t('addProduct.mainImage')}
                          </Badge>
                        )}
                        
                        {/* Image Number */}
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                          {idx + 1} / {images.length}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Helper Text */}
                {images.length === 0 && isReadOnly && (
                  <div className="text-center py-8 text-slate-400">
                    <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">{t('addProduct.noImages')}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pricing */}
            <Card>
              <CardHeader>
                <CardTitle>{t('addProduct.pricing')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="price">{t('addProduct.price')}</Label>
                    <div className="relative mt-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                      <Input
                        id="price"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={price}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value) || 0;
                          setPrice(Math.max(0, value).toString());
                        }}
                        onKeyDown={(e) => {
                          // Prevent minus key and 'e' (exponential notation)
                          if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                            e.preventDefault();
                          }
                        }}
                        disabled={isReadOnly}
                        className="pl-7"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="compareAtPrice">{t('addProduct.compareAtPrice')}</Label>
                    <div className="relative mt-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                      <Input
                        id="compareAtPrice"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={compareAtPrice}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value) || 0;
                          setCompareAtPrice(Math.max(0, value).toString());
                        }}
                        onKeyDown={(e) => {
                          // Prevent minus key and 'e' (exponential notation)
                          if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                            e.preventDefault();
                          }
                        }}
                        disabled={isReadOnly}
                        className="pl-7"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor="costPerItem">{t('addProduct.costPerItem')}</Label>
                  <div className="relative mt-2">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <Input
                      id="costPerItem"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={costPerItem}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value) || 0;
                        setCostPerItem(Math.max(0, value).toString());
                      }}
                      onKeyDown={(e) => {
                        // Prevent minus key and 'e' (exponential notation)
                        if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                          e.preventDefault();
                        }
                      }}
                      disabled={isReadOnly}
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{t('addProduct.costPerItemHint')}</p>
                </div>
                
                {/* 🔥 Commission Rate Field */}
                <div>
                  <Label htmlFor="commissionRate">{t('addProduct.commissionRate')}</Label>
                  <div className="relative mt-2">
                    <Input
                      id="commissionRate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="0"
                      value={commissionRate}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value) || 0;
                        setCommissionRate(Math.min(100, Math.max(0, value)).toString());
                      }}
                      onKeyDown={(e) => {
                        // Prevent minus key and 'e' (exponential notation)
                        if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                          e.preventDefault();
                        }
                      }}
                      disabled={isReadOnly}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">%</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{t('addProduct.commissionRateHint')}</p>
                </div>
                
                {compareAtPrice && parseFloat(compareAtPrice) > parseFloat(price) && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-green-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-green-900">
                        {t('addProduct.savings')
                          .replace('${amount}', `$${(parseFloat(compareAtPrice) - parseFloat(price)).toFixed(2)}`)
                          .replace('{percent}', (((parseFloat(compareAtPrice) - parseFloat(price)) / parseFloat(compareAtPrice)) * 100).toFixed(0))}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Variants */}
            <Card>
              <CardHeader>
                <CardTitle>{t('addProduct.variants')}</CardTitle>
                <CardDescription>
                  {t('addProduct.variantsHint')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="hasVariants"
                    checked={hasVariants}
                    onCheckedChange={(checked) => setHasVariants(checked as boolean)}
                    disabled={isReadOnly}
                  />
                  <Label htmlFor="hasVariants" className="cursor-pointer font-normal">
                    {t('addProduct.hasMultipleOptions')}
                  </Label>
                </div>

                {hasVariants && (
                  <div className="space-y-5 pt-3">
                    <div className="space-y-5">
                    {variantOptions.map((option, optionIdx) => (
                      <div key={optionIdx} className="space-y-3">
                        <div className="flex items-end gap-3">
                          <div className="flex-1">
                            <div className="mb-1.5">
                              <Label className="text-sm font-medium text-slate-800">{t('addProduct.optionName')}</Label>
                            </div>
                            <Input
                              placeholder={t('addProduct.optionNamePlaceholder')}
                              value={option.name}
                              onChange={(e) => updateVariantOptionName(optionIdx, e.target.value)}
                              disabled={isReadOnly}
                            />
                          </div>
                          {!isReadOnly && variantOptions.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeVariantOption(optionIdx)}
                              className="mb-0.5 h-9 w-9 shrink-0 text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>

                        <div>
                          <Label className="text-sm text-slate-600">{t('addProduct.optionValues')}</Label>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {t('addProduct.optionValuesHint').replace(
                              '{name}',
                              option.name.trim() || t('addProduct.optionValueFallback')
                            )}
                          </p>
                          <div className="mt-2 divide-y divide-dotted divide-slate-400 rounded-lg border-2 border-dotted border-slate-400 bg-white">
                          {option.values.map((value, valueIdx) => {
                            const slot = variantOptionSlotIndex(variantOptions, optionIdx);
                            const assignedImage =
                              optionValueImages[optionValueImageKey(optionIdx, value)] ||
                              sharedImageForOptionValue(variants, slot, value);
                            return (
                            <div key={valueIdx} className="space-y-2 px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <Input
                                  placeholder={t('addProduct.optionValuePlaceholder')}
                                  value={value}
                                  onChange={(e) => updateSingleVariantValue(optionIdx, valueIdx, e.target.value)}
                                  disabled={isReadOnly}
                                  className="h-9 flex-1 border-dotted border-slate-300 bg-slate-50/80 shadow-none"
                                />
                                {!isReadOnly && option.values.length > 1 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removeSingleVariantValue(optionIdx, valueIdx)}
                                    className="h-8 w-8 shrink-0 text-slate-400 hover:text-red-600"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                              {value.trim() && images.length > 0 && slot >= 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {images.map((url, imgIdx) => (
                                    <button
                                      key={imgIdx}
                                      type="button"
                                      title={t('addProduct.matchImageTo').replace('{value}', value)}
                                      onClick={() => {
                                        if (isReadOnly) return;
                                        setOptionValueImages((prev) => ({
                                          ...prev,
                                          [optionValueImageKey(optionIdx, value)]: url,
                                        }));
                                        setVariants((prev) =>
                                          applyImageToOptionValue(prev, slot, value, url)
                                        );
                                      }}
                                      disabled={isReadOnly}
                                      className={`h-9 w-9 overflow-hidden rounded-md border border-dotted transition-all ${
                                        assignedImage === url
                                          ? "border-solid border-blue-600 ring-2 ring-blue-100"
                                          : "border-slate-300 hover:border-slate-400"
                                      } ${isReadOnly ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                                    >
                                      <img src={url} alt="" className="h-full w-full object-cover" />
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            );
                          })}
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={() => addSingleVariantValue(optionIdx)}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                            >
                              <Plus className="h-4 w-4" />
                              {t('addProduct.addAnotherValue')}
                            </button>
                          )}
                          </div>
                        </div>
                      </div>
                    ))}
                    </div>

                    {!isReadOnly && variantOptions.length < 3 && (
                      <Button
                        variant="ghost"
                        onClick={addVariantOption}
                        className="w-full border-2 border-dotted border-slate-400 text-slate-600 hover:border-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        {t('addProduct.addAnotherOption')}
                      </Button>
                    )}

                    <Separator />

                    {/* Variant List */}
                    <div>
                      <h4 className="font-semibold mb-1">{t('addProduct.variantDetails')}</h4>
                      <p className="text-xs text-slate-500 mb-3">
                        {(variants.length === 1
                          ? t('addProduct.combinationCount')
                          : t('addProduct.combinationsCount')
                        ).replace('{count}', String(variants.length))}
                      </p>
                      <div className="overflow-hidden rounded-lg border-2 border-dotted border-slate-400 divide-y divide-dotted divide-slate-400">
                        {variants.map((variant) => {
                          const variantName = [variant.option1, variant.option2, variant.option3]
                            .filter(Boolean)
                            .join(' / ');
                          const imageOptionValue =
                            visualSlot >= 0
                              ? [variant.option1, variant.option2, variant.option3][visualSlot]
                              : undefined;
                          const imageOptionName = visualOptionName;
                          
                          return (
                            <div key={variant.id} className="bg-white px-4 py-3">
                              <div className="mb-2 flex items-center gap-2">
                                <GripVertical className="h-4 w-4 text-slate-300" />
                                <span className="text-sm font-medium text-slate-900">{variantName}</span>
                              </div>
                              
                              {/* Variant Image Selector */}
                              {images.length > 0 && (
                                <div className="mb-3 flex flex-wrap items-center gap-2 pl-6">
                                    <div className="flex flex-wrap gap-1.5">
                                      {images.map((url, imgIdx) => (
                                        <button
                                          key={imgIdx}
                                          type="button"
                                          onClick={() => {
                                            if (!isReadOnly) {
                                              patchVariant(variant.id, { image: url });
                                            }
                                          }}
                                          disabled={isReadOnly}
                                          className={`h-10 w-10 overflow-hidden rounded-md border border-dotted transition-all ${
                                            variant.image === url
                                              ? 'border-solid border-blue-600 ring-2 ring-blue-100'
                                              : 'border-slate-300 hover:border-slate-400'
                                          } ${isReadOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                        >
                                          <img
                                            src={url}
                                            alt={`Option ${imgIdx + 1}`}
                                            className="h-full w-full object-cover"
                                          />
                                        </button>
                                      ))}
                                    </div>
                                    {variant.image && !isReadOnly && (
                                      <div className="flex items-center gap-1">
                                        {imageOptionValue ? (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              if (!variant.image || visualSlot < 0 || !imageOptionValue) return;
                                              setOptionValueImages((prev) => ({
                                                ...prev,
                                                [optionValueImageKey(visualUiIndex, String(imageOptionValue))]:
                                                  variant.image || "",
                                              }));
                                              setVariants((prev) =>
                                                applyImageToOptionValue(
                                                  prev,
                                                  visualSlot,
                                                  String(imageOptionValue),
                                                  variant.image || ""
                                                )
                                              );
                                            }}
                                            className="h-7 px-2 text-xs text-slate-600"
                                          >
                                            {t('addProduct.applyToAll')
                                              .replace('{name}', String(imageOptionName || ''))
                                              .replace('{value}', String(imageOptionValue))}
                                          </Button>
                                        ) : null}
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => patchVariant(variant.id, { image: "" })}
                                          className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                        >
                                          {t('addProduct.clear')}
                                        </Button>
                                      </div>
                                    )}
                                </div>
                              )}
                              
                              <div className="grid grid-cols-4 gap-3 pl-6">
                                <div>
                                  <Label className="text-xs">{t('addProduct.price')}</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={parsePriceForDisplay(variant.price)}
                                    onChange={(e) => {
                                      const value = parseFloat(e.target.value) || 0;
                                      patchVariant(variant.id, { price: Math.max(0, value).toString() });
                                    }}
                                    onKeyDown={(e) => {
                                      // Prevent minus key and 'e' (exponential notation)
                                      if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                                        e.preventDefault();
                                      }
                                    }}
                                    disabled={isReadOnly}
                                    className="mt-1 h-9"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">{t('addProduct.sku')}</Label>
                                  <Input
                                    placeholder="ABC-123"
                                    value={variant.sku || ''}
                                    onChange={(e) => patchVariant(variant.id, { sku: e.target.value })}
                                    disabled={isReadOnly}
                                    className="mt-1 h-9"
                                  />
                                  {variantSkuErrors[variant.id] && <p className="text-xs text-red-500 mt-1.5">{variantSkuErrors[variant.id]}</p>}
                                </div>
                                <div>
                                  <Label className="text-xs">{t('addProduct.quantity')}</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={variant.inventory ?? 0}
                                    onChange={(e) => {
                                      const value = parseInt(e.target.value) || 0;
                                      patchVariant(variant.id, { inventory: Math.max(0, value) });
                                    }}
                                    onKeyDown={(e) => {
                                      // Prevent minus key and 'e' (exponential notation)
                                      if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                                        e.preventDefault();
                                      }
                                    }}
                                    disabled={isReadOnly}
                                    className="mt-1 h-9"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">{t('addProduct.weight')}</Label>
                                  <Input
                                    placeholder={t('addProduct.weightPlaceholder')}
                                    value={variant.weight || ''}
                                    onChange={(e) => patchVariant(variant.id, { weight: e.target.value })}
                                    disabled={isReadOnly}
                                    className="mt-1 h-9"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Inventory - Only show when no variants */}
            {!hasVariants && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('addProduct.inventory')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="sku">{t('addProduct.skuFull')}</Label>
                      <Input
                        id="sku"
                        placeholder="ABC-12345"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        disabled={isReadOnly}
                        className="mt-2"
                      />
                      <p className="text-xs text-slate-500 mt-1.5">
                        <AlertCircle className="w-3 h-3 inline mr-1" />
                        {t('addProduct.skuHint')}
                      </p>
                      {isCheckingSku && <p className="text-xs text-slate-500 mt-1.5">{t('addProduct.checkingSku')}</p>}
                      {skuError && <p className="text-xs text-red-500 mt-1.5">{skuError}</p>}
                    </div>
                    <div>
                      <Label htmlFor="barcode">{t('addProduct.barcode')}</Label>
                      <Input
                        id="barcode"
                        placeholder="123456789012"
                        value={barcode}
                        onChange={(e) => setBarcode(e.target.value)}
                        disabled={isReadOnly}
                        className="mt-2"
                      />
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Checkbox
                        id="trackQuantity"
                        checked={trackQuantity}
                        onCheckedChange={(checked) => setTrackQuantity(checked as boolean)}
                        disabled={isReadOnly}
                      />
                      <Label htmlFor="trackQuantity" className="cursor-pointer font-normal">
                        {t('addProduct.trackQuantity')}
                      </Label>
                    </div>
                    {trackQuantity && (
                      <div>
                        <Label htmlFor="inventory">{t('addProduct.quantity')}</Label>
                        <Input
                          id="inventory"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={inventory}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 0;
                            // Only allow positive numbers (0 or greater)
                            setInventory(Math.max(0, value));
                          }}
                          onKeyDown={(e) => {
                            // Prevent minus key and 'e' (exponential notation)
                            if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                          disabled={isReadOnly}
                          className="mt-2"
                        />
                        <p className="text-xs text-slate-500 mt-1.5">
                          {t('addProduct.quantityHint')}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="continueSellingOutOfStock"
                      checked={continueSellingOutOfStock}
                      onCheckedChange={(checked) => setContinueSellingOutOfStock(checked as boolean)}
                      disabled={isReadOnly}
                    />
                    <Label htmlFor="continueSellingOutOfStock" className="cursor-pointer font-normal">
                      {t('addProduct.continueSelling')}
                    </Label>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Shipping */}
            <Card>
              <CardHeader>
                <CardTitle>{t('addProduct.shipping')}</CardTitle>
                <CardDescription>{t('addProduct.shippingHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="weight">{t('addProduct.weight')}</Label>
                  <Input
                    id="weight"
                    placeholder="0.0"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    disabled={isReadOnly}
                    className="mt-2"
                  />
                  <p className="text-xs text-slate-500 mt-1">{t('addProduct.weightHint')}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Sidebar */}
          <div className="w-96 space-y-6">
            {/* Product Status */}
            <Card>
              <CardHeader>
                <CardTitle>{t('addProduct.productStatus')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Select
                  value={status}
                  onValueChange={handleProductStatusChange}
                  disabled={isReadOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t('products.active')}</SelectItem>
                    <SelectItem value="off-shelf">{t('products.offShelf')}</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Product Organization */}
            <Card>
              <CardHeader>
                <CardTitle>{t('addProduct.productOrganization')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="productType">{t('addProduct.productType')}</Label>
                  <Input
                    id="productType"
                    placeholder={t('addProduct.productTypePlaceholder')}
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                    disabled={isReadOnly}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="category">{t('addProduct.categoryLabel')}</Label>
                  <CategorySelect 
                    value={category} 
                    onValueChange={setCategory} 
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="vendor" className="text-sm font-medium text-slate-700 mb-2 block">
                    {t('addProduct.vendorLabel')} {selectedVendors.length > 0 && <span className="text-slate-500">{t('addProduct.selectedCount').replace('{count}', String(selectedVendors.length))}</span>}
                  </Label>
                  {loadingVendors ? (
                    <div className="h-10 border border-slate-300 rounded-md flex items-center justify-center text-sm text-slate-500">
                      {t('addProduct.loadingVendors')}
                    </div>
                  ) : vendors.length === 0 ? (
                    <div className="h-10 border border-slate-300 rounded-md flex items-center justify-center text-sm text-slate-500">
                      {t('addProduct.noVendors')}
                    </div>
                  ) : (
                    <div className="border border-slate-300 rounded-md max-h-48 overflow-y-auto">
                      {vendors.map((v) => (
                        <div 
                          key={v.id} 
                          className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-200 last:border-b-0"
                          onClick={() => {
                            if (!isReadOnly) {
                              // 🔥 Use vendor ID instead of name (IDs never change when vendor renames)
                              const vendorId = v.id;
                              const vendorName = v.name || v.businessName;
                              
                              setSelectedVendors(prev => {
                                // Remove both ID and name (if they exist) for clean state
                                const cleaned = prev.filter(item => 
                                  item !== vendorId && 
                                  item !== vendorName && 
                                  item !== v.businessName
                                );
                                
                                // If currently selected, just return cleaned (deselect)
                                if (prev.includes(vendorId) || prev.includes(vendorName)) {
                                  return cleaned;
                                }
                                
                                // Otherwise add the vendor ID (not name)
                                return [...cleaned, vendorId];
                              });
                            }
                          }}
                        >
                          <Checkbox
                            id={`vendor-${v.id}`}
                            checked={
                              selectedVendors.includes(v.id) || 
                              selectedVendors.includes(v.name) || 
                              selectedVendors.includes(v.businessName)
                            }
                            onCheckedChange={() => {
                              if (!isReadOnly) {
                                // 🔥 Use vendor ID instead of name (IDs never change when vendor renames)
                                const vendorId = v.id;
                                const vendorName = v.name || v.businessName;
                                
                                setSelectedVendors(prev => {
                                  // Remove both ID and name (if they exist) for clean state
                                  const cleaned = prev.filter(item => 
                                    item !== vendorId && 
                                    item !== vendorName && 
                                    item !== v.businessName
                                  );
                                  
                                  // If currently selected, just return cleaned (deselect)
                                  if (prev.includes(vendorId) || prev.includes(vendorName)) {
                                    return cleaned;
                                  }
                                  
                                  // Otherwise add the vendor ID (not name)
                                  return [...cleaned, vendorId];
                                });
                              }
                            }}
                            disabled={isReadOnly}
                          />
                          <Label htmlFor={`vendor-${v.id}`} className="cursor-pointer font-normal text-sm flex-1">
                            {v.name || v.businessName || v.id}
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Tags */}
            <Card>
              <CardHeader>
                <CardTitle>{t('addProduct.tags')}</CardTitle>
                <CardDescription>{t('addProduct.tagsHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!isReadOnly && (
                  <div className="flex gap-2">
                    <Input
                      placeholder={t('addProduct.enterTag')}
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addTag()}
                    />
                    <Button onClick={addTag} variant="outline" size="sm">
                      {t('addProduct.add')}
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      {!isReadOnly && (
                        <button
                          onClick={() => removeTag(tag)}
                          className="ml-1 hover:text-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}