import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { logisticsApi, type DeliveryPartner } from "../../utils/api";
import { LOGISTICS_REGION_OPTIONS } from "../utils/logisticsRegions";
import {
  emptyPartnerForm,
  emptyRegionRate,
  formToPayload,
  logisticsApiErrorMessage,
  partnerToForm,
  validatePartnerForm,
  type PartnerForm,
  type RegionRateForm,
} from "../utils/logisticsPartnerForm";
import {
  findPartnerBySlug,
  logisticsPartnerProfilePath,
} from "../utils/logisticsPartnerSlug";
import { getMyanmarRegionLabel } from "../utils/myanmarRegionLabels";
import { useLanguage } from "../contexts/LanguageContext";
import { compressImageToFile, dataUrlToFile } from "../../utils/imageCompression";

type LogisticsPartnerFormPageProps =
  | { mode: "create" }
  | { mode: "edit"; slug: string };

export function LogisticsPartnerFormPage(props: LogisticsPartnerFormPageProps) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const isCreate = props.mode === "create";
  const slug = props.mode === "edit" ? props.slug : null;

  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PartnerForm>(emptyPartnerForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formReady, setFormReady] = useState(isCreate);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const regionLabel = useCallback(
    (region: string) => getMyanmarRegionLabel(region, language),
    [language]
  );

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await logisticsApi.getPartners();
        if (!cancelled) {
          setPartners(Array.isArray(res.partners) ? res.partners : []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load delivery partner:", error);
          toast.error(logisticsApiErrorMessage(error, "load"));
          setPartners([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreate, slug]);

  const partner = useMemo(
    () => (slug ? findPartnerBySlug(partners, slug) : undefined),
    [partners, slug]
  );

  useEffect(() => {
    if (isCreate || loading) return;
    if (!partner) {
      setFormReady(false);
      return;
    }
    setEditingId(partner.id);
    setForm(partnerToForm(partner));
    setFormReady(true);
  }, [isCreate, loading, partner]);

  const cancelPath = isCreate
    ? "/admin/logistics"
    : partner
      ? logisticsPartnerProfilePath(partner)
      : "/admin/logistics";

  const toggleRegion = (region: string, checked: boolean) => {
    setForm((prev) => {
      const next = { ...prev.regionRates };
      if (checked) {
        next[region] = next[region] ?? emptyRegionRate();
      } else {
        delete next[region];
      }
      return { ...prev, regionRates: next };
    });
  };

  const updateRegionRate = (
    region: string,
    field: keyof RegionRateForm,
    value: string
  ) => {
    setForm((prev) => ({
      ...prev,
      regionRates: {
        ...prev.regionRates,
        [region]: {
          ...(prev.regionRates[region] ?? emptyRegionRate()),
          [field]: value,
        },
      },
    }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(t("logistics.form.logoUploadTypeError"));
      return;
    }

    setIsUploadingLogo(true);
    toast.info(t("logistics.form.logoCompressing"), { duration: 2500 });

    try {
      const compressedFile = await compressImageToFile(file, 500);
      const imageUrl = await logisticsApi.uploadPartnerLogo(compressedFile);
      setForm((f) => ({ ...f, logo: imageUrl }));
      toast.success(t("logistics.form.logoUploaded"));
    } catch (error) {
      console.error("Failed to upload logo:", error);
      toast.error(
        error instanceof Error ? error.message : t("logistics.form.logoUploadFailed")
      );
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const resolveLogoForSave = async (logo: string): Promise<string> => {
    const trimmed = logo.trim();
    if (!trimmed || !trimmed.startsWith("data:")) return trimmed;
    const file = await compressImageToFile(dataUrlToFile(trimmed, "logo.jpg"), 500);
    return logisticsApi.uploadPartnerLogo(file);
  };

  const handleSave = async () => {
    const validationError = validatePartnerForm(form);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const payload = formToPayload({
        ...form,
        logo: await resolveLogoForSave(form.logo),
      });
      if (isCreate) {
        const res = await logisticsApi.createPartner(payload);
        toast.success(t("logistics.form.added"));
        navigate(logisticsPartnerProfilePath(res.partner));
        return;
      }

      if (!editingId) return;
      const res = await logisticsApi.updatePartner(editingId, payload);
      toast.success(t("logistics.form.updated"));
      navigate(logisticsPartnerProfilePath(res.partner));
    } catch (error) {
      console.error("Failed to save delivery partner:", error);
      toast.error(logisticsApiErrorMessage(error, "save"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        {t("logistics.form.loading")}
      </div>
    );
  }

  if (!isCreate && !partner) {
    return (
      <div className="p-8 max-w-lg space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">{t("logistics.form.notFound")}</h2>
        <p className="text-sm text-slate-600">
          {t("logistics.form.notFoundHint").replace("{slug}", slug ?? "")}
        </p>
        <Button variant="outline" onClick={() => navigate("/admin/logistics")}>
          {t("logistics.form.backToLogistics")}
        </Button>
      </div>
    );
  }

  if (!isCreate && !formReady) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        {t("logistics.form.preparing")}
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2 text-slate-600"
            onClick={() => navigate(cancelPath)}
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            {t("logistics.form.back")}
          </Button>
          <h1 className="text-2xl font-bold text-slate-900">
            {isCreate ? t("logistics.form.titleCreate") : t("logistics.form.titleEdit")}
          </h1>
          <p className="text-slate-500 mt-1">{t("logistics.form.subtitle")}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Label>{t("logistics.form.logoOptional")}</Label>
          <div className="mt-2">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleLogoUpload(e)}
            />
            {form.logo ? (
              <div className="inline-flex flex-col gap-2">
                <div className="group relative h-[100px] w-[100px] overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <img
                    src={form.logo}
                    alt={t("logistics.form.logoAlt")}
                    className="h-full w-full object-contain p-1"
                    onError={() => setForm((f) => ({ ...f, logo: "" }))}
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8 bg-white hover:bg-slate-100"
                      disabled={isUploadingLogo}
                      onClick={() => logoInputRef.current?.click()}
                      aria-label={t("logistics.form.changeLogo")}
                    >
                      {isUploadingLogo ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8 bg-white hover:bg-slate-100"
                      disabled={isUploadingLogo}
                      onClick={() => setForm((f) => ({ ...f, logo: "" }))}
                      aria-label={t("logistics.form.removeLogo")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={isUploadingLogo}
                onClick={() => logoInputRef.current?.click()}
                className="flex h-[100px] w-[100px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/50 transition-colors hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={t("logistics.form.uploadLogo")}
              >
                {isUploadingLogo ? (
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                ) : (
                  <ImageIcon className="h-7 w-7 text-slate-400" />
                )}
              </button>
            )}
            <p className="mt-2 text-xs text-slate-500">{t("logistics.form.logoHint")}</p>
          </div>
        </div>

        <div>
          <Label htmlFor="serviceName">{t("logistics.form.companyName")}</Label>
          <Input
            id="serviceName"
            placeholder={t("logistics.form.companyPlaceholder")}
            className="mt-2"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="status">{t("logistics.form.status")}</Label>
          <Select
            value={form.status}
            onValueChange={(value: "active" | "inactive") =>
              setForm((f) => ({ ...f, status: value }))
            }
          >
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t("logistics.status.active")}</SelectItem>
              <SelectItem value="inactive">{t("logistics.status.inactive")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="border border-slate-200 rounded-lg p-4 bg-amber-50">
          <div className="flex items-start gap-3">
            <Checkbox
              id="codSupported"
              className="mt-1"
              checked={form.codSupported}
              onCheckedChange={(checked) =>
                setForm((f) => ({
                  ...f,
                  codSupported: checked === true,
                  codFee: checked === true ? f.codFee : "",
                }))
              }
            />
            <div className="flex-1">
              <Label htmlFor="codSupported" className="cursor-pointer font-semibold">
                {t("logistics.form.codTitle")}
              </Label>
              <p className="text-sm text-slate-600 mt-1">{t("logistics.form.codDesc")}</p>
              {form.codSupported && (
                <div className="mt-3">
                  <Label htmlFor="codFee" className="text-xs">
                    {t("logistics.form.codFee")}
                  </Label>
                  <Input
                    id="codFee"
                    placeholder={t("logistics.form.codFeePlaceholder")}
                    className="mt-1 max-w-xs"
                    value={form.codFee}
                    onChange={(e) => setForm((f) => ({ ...f, codFee: e.target.value }))}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <Label>{t("logistics.form.regionsRates")}</Label>
          <p className="text-sm text-slate-500 mt-1 mb-3">{t("logistics.form.regionsRatesHint")}</p>
          <div className="space-y-3">
            {LOGISTICS_REGION_OPTIONS.map((region) => {
              const enabled = region in form.regionRates;
              const rate = form.regionRates[region];
              return (
                <div
                  key={region}
                  className={`border rounded-lg p-3 ${
                    enabled ? "border-purple-200 bg-purple-50/40" : "border-slate-200"
                  }`}
                >
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(checked) => toggleRegion(region, checked === true)}
                    />
                    <span className="text-sm font-medium">{regionLabel(region)}</span>
                  </label>

                  {enabled && rate && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 pl-6">
                      <div>
                        <Label className="text-xs">{t("logistics.form.estimatedDelivery")}</Label>
                        <Input
                          placeholder={t("logistics.form.estimatedPlaceholder")}
                          className="mt-1"
                          value={rate.estimatedDays}
                          onChange={(e) =>
                            updateRegionRate(region, "estimatedDays", e.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{t("logistics.form.minCost")}</Label>
                        <Input
                          placeholder="3000"
                          className="mt-1"
                          value={rate.costMin}
                          onChange={(e) => updateRegionRate(region, "costMin", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{t("logistics.form.maxCost")}</Label>
                        <Input
                          placeholder={t("logistics.form.maxCostPlaceholder")}
                          className="mt-1"
                          value={rate.costMax}
                          onChange={(e) => updateRegionRate(region, "costMax", e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-200">
        <Button variant="outline" onClick={() => navigate(cancelPath)} disabled={saving || isUploadingLogo}>
          {t("logistics.form.cancel")}
        </Button>
        <Button
          className="bg-slate-900 hover:bg-slate-800"
          onClick={() => void handleSave()}
          disabled={saving || isUploadingLogo}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("logistics.form.saving")}
            </>
          ) : isCreate ? (
            t("logistics.form.addPartner")
          ) : (
            t("logistics.form.saveChanges")
          )}
        </Button>
      </div>
    </div>
  );
}
