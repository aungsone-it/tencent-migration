import { useState, useEffect } from "react";
import { ArrowLeft, Building2, Mail, Phone, MapPin, Globe, Upload, Percent } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import { useLanguage } from "../contexts/LanguageContext";

interface VendorAddEditProps {
  onBack: () => void;
  onSave: (vendorData: any) => Promise<void>;
  initialData?: any;
  mode?: "add" | "edit";
  editingVendor?: any;
}

const BUSINESS_TYPE_OPTIONS = [
  "electronics",
  "fashion",
  "furniture",
  "beauty",
  "sports",
  "food",
  "books",
  "other",
] as const;

const STATUS_OPTIONS = [
  { value: "active", labelKey: "vendor.active" },
  { value: "inactive", labelKey: "vendor.inactive" },
  { value: "pending", labelKey: "vendorProfile.statusPending" },
  { value: "suspended", labelKey: "vendor.suspended" },
  { value: "banned", labelKey: "vendor.banned" },
] as const;

export function VendorAddEdit({ onBack, onSave, initialData, mode = "add", editingVendor }: VendorAddEditProps) {
  const { t } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);

  const vendorData = editingVendor || initialData;

  const [formData, setFormData] = useState({
    name: vendorData?.name || "",
    businessType: vendorData?.businessType || "",
    description: vendorData?.description || "",
    email: vendorData?.email || "",
    phone: vendorData?.phone || "",
    location: vendorData?.location || "",
    website: vendorData?.website || "",
    status: vendorData?.status || "pending",
    logo: vendorData?.logo || vendorData?.avatar || null,
    freeShippingEnabled: vendorData?.freeShippingEnabled === true,
    commission:
      vendorData?.commission != null && vendorData.commission !== ""
        ? String(vendorData.commission)
        : "",
  });

  useEffect(() => {
    if (editingVendor || initialData) {
      const data = editingVendor || initialData;
      setFormData({
        name: data?.name || "",
        businessType: data?.businessType || "",
        description: data?.description || "",
        email: data?.email || "",
        phone: data?.phone || "",
        location: data?.location || "",
        website: data?.website || "",
        status: data?.status || "pending",
        logo: data?.logo || data?.avatar || null,
        freeShippingEnabled: data?.freeShippingEnabled === true,
        commission:
          data?.commission != null && data.commission !== ""
            ? String(data.commission)
            : "",
      });
    }
  }, [editingVendor, initialData]);

  const handleSubmit = async () => {
    if (!formData.name || !formData.email || !formData.phone) {
      alert(t("vendorAddEdit.requiredFields"));
      return;
    }

    setIsLoading(true);
    try {
      const commissionRaw = String(formData.commission ?? "").trim();
      await onSave({
        ...formData,
        commission: commissionRaw === "" ? 0 : parseFloat(commissionRaw) || 0,
      });
    } catch (error) {
      console.error("Error saving vendor:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setFormData({ ...formData, logo: event.target?.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onBack} className="hover:bg-slate-100">
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  {mode === "add" ? t("vendorAddEdit.addTitle") : t("vendorAddEdit.editTitle")}
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {mode === "add" ? t("vendorAddEdit.addSubtitle") : t("vendorAddEdit.editSubtitle")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={onBack} disabled={isLoading}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isLoading}
                className="bg-slate-900 hover:bg-slate-800"
              >
                <Building2 className="w-4 h-4 mr-2" />
                {isLoading ? t("common.saving") : t("vendorAddEdit.saveVendor")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-6 border border-slate-200 bg-white lg:col-span-1">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{t("vendorAddEdit.basicInformation")}</h2>

            <div className="space-y-4">
              <div>
                <Label htmlFor="name" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.vendorName")} <span className="text-red-500">*</span>
                </Label>
                <div className="relative mt-1.5">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="name"
                    placeholder={t("vendorAddEdit.vendorNamePlaceholder")}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="pl-10"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="businessType" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.businessType")}
                </Label>
                <Select
                  value={formData.businessType}
                  onValueChange={(value) => setFormData({ ...formData, businessType: value })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder={t("vendorAddEdit.businessTypePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_TYPE_OPTIONS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`vendorAddEdit.businessType.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="description" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.description")}
                </Label>
                <Textarea
                  id="description"
                  placeholder={t("vendorAddEdit.descriptionPlaceholder")}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="mt-1.5 resize-none"
                />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-slate-200 bg-white lg:col-span-1">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{t("vendorAddEdit.accountStatusSection")}</h2>

            <div className="space-y-4">
              <div>
                <Label htmlFor="status" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.accountStatus")}
                </Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder={t("vendorAddEdit.selectStatus")} />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(({ value, labelKey }) => (
                      <SelectItem key={value} value={value}>
                        {t(labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="commission" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.commissionRate")}
                </Label>
                <div className="relative mt-1.5">
                  <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="commission"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    placeholder="0"
                    value={formData.commission}
                    onChange={(e) => setFormData({ ...formData, commission: e.target.value })}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1.5">{t("vendorAddEdit.commissionRateHint")}</p>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="space-y-1 pr-2">
                  <Label htmlFor="freeShippingEnabled" className="text-sm font-medium text-slate-900">
                    {t("vendor.freeShippingFeatureAccess")}
                  </Label>
                  <p className="text-xs text-slate-500">{t("vendor.freeShippingFeatureAccessDesc")}</p>
                </div>
                <Switch
                  id="freeShippingEnabled"
                  checked={formData.freeShippingEnabled}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, freeShippingEnabled: checked })
                  }
                />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-slate-200 bg-white lg:col-span-1">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{t("vendorAddEdit.vendorLogo")}</h2>

            <div>
              <Label className="text-sm font-medium text-slate-700">{t("vendorAddEdit.companyLogo")}</Label>
              <p className="text-xs text-slate-500 mt-1 mb-3">{t("vendorAddEdit.logoUploadHint")}</p>

              <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-slate-300 transition-colors">
                {formData.logo ? (
                  <div className="space-y-3">
                    <img
                      src={formData.logo}
                      alt={t("vendorAddEdit.vendorLogo")}
                      className="w-24 h-24 mx-auto object-contain rounded-lg"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFormData({ ...formData, logo: null })}
                    >
                      {t("vendorAddEdit.removeLogo")}
                    </Button>
                  </div>
                ) : (
                  <label htmlFor="logo-upload" className="cursor-pointer block">
                    <div className="w-16 h-16 bg-slate-100 rounded-lg mx-auto flex items-center justify-center mb-3">
                      <Upload className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-700 mb-1">{t("vendorAddEdit.clickUploadLogo")}</p>
                    <p className="text-xs text-slate-500">{t("vendorAddEdit.logoFileHint")}</p>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-slate-200 bg-white lg:col-span-3">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{t("vendorAddEdit.contactInformation")}</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.emailAddress")} <span className="text-red-500">*</span>
                </Label>
                <div className="relative mt-1.5">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="contact@vendor.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="pl-10"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="phone" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.phoneNumber")} <span className="text-red-500">*</span>
                </Label>
                <div className="relative mt-1.5">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="phone"
                    type="number"
                    placeholder="+95 9 XXX XXX XXX"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="pl-10"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="location" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.location")}
                </Label>
                <div className="relative mt-1.5">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="location"
                    placeholder={t("vendorAddEdit.locationPlaceholder")}
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="pl-10"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="website" className="text-sm font-medium text-slate-700">
                  {t("vendorAddEdit.website")}
                </Label>
                <div className="relative mt-1.5">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="website"
                    type="url"
                    placeholder="https://vendor.com"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
