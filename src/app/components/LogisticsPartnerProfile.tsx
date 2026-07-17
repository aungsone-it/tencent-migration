import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Clock, Edit, Loader2, MapPin, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { logisticsApi, type DeliveryPartner } from "../../utils/api";
import {
  formatCostKyats,
  formatCostRangeKyats,
  getPartnerRegionKeys,
} from "../utils/logisticsRegions";
import { findPartnerBySlug, logisticsPartnerEditPath } from "../utils/logisticsPartnerSlug";
import { getMyanmarRegionLabel, getMyanmarTownshipLabel } from "../utils/myanmarRegionLabels";
import { formatEstimatedDeliveryLabel } from "../utils/checkoutLogistics";
import { logisticsApiErrorMessage, normalizePartnerStatus, partnerToUpdatePayload } from "../utils/logisticsPartnerForm";
import { useLanguage } from "../contexts/LanguageContext";

type LogisticsPartnerProfileProps = {
  slug: string;
};

export function LogisticsPartnerProfile({ slug }: LogisticsPartnerProfileProps) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const regionLabel = useCallback(
    (region: string) => getMyanmarRegionLabel(region, language),
    [language]
  );

  const formatDeliveryLabel = useCallback(
    (value: string) =>
      formatEstimatedDeliveryLabel(value, (days) =>
        t("checkout.withinDays").replace("{days}", String(days))
      ),
    [t]
  );

  useEffect(() => {
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
  }, [slug]);

  const partner = useMemo(() => findPartnerBySlug(partners, slug), [partners, slug]);
  const regionKeys = useMemo(
    () => (partner ? getPartnerRegionKeys(partner.regionRates) : []),
    [partner]
  );
  const isActive = normalizePartnerStatus(partner?.status) === "active";

  const handleToggleStatus = async () => {
    if (!partner || togglingStatus) return;
    const previousPartner = partner;
    const nextStatus = isActive ? "inactive" : "active";
    setTogglingStatus(true);
    setPartners((prev) =>
      prev.map((item) =>
        item.id === previousPartner.id ? { ...item, status: nextStatus } : item
      )
    );
    try {
      const res = await logisticsApi.updatePartner(previousPartner.id, {
        ...partnerToUpdatePayload(previousPartner),
        status: nextStatus,
      });
      setPartners((prev) =>
        prev.map((item) => (item.id === previousPartner.id ? res.partner : item))
      );
      toast.success(t("logistics.form.updated"));
    } catch (error) {
      setPartners((prev) =>
        prev.map((item) => (item.id === previousPartner.id ? previousPartner : item))
      );
      console.error("Failed to update delivery partner status:", error);
      toast.error(logisticsApiErrorMessage(error, "save"));
    } finally {
      setTogglingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        {t("logistics.profile.loading")}
      </div>
    );
  }

  if (!partner) {
    return (
      <div className="p-8 max-w-lg space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">{t("logistics.profile.notFound")}</h2>
        <p className="text-sm text-slate-600">
          {t("logistics.profile.notFoundHint").replace("{slug}", slug)}
        </p>
        <Button variant="outline" onClick={() => navigate("/admin/logistics")}>
          {t("logistics.profile.backToLogistics")}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h1 className="text-2xl font-bold text-slate-900">{partner.name}</h1>
            <Badge
              variant="secondary"
              className={
                isActive
                  ? "bg-green-100 text-green-700 border-green-200"
                  : "bg-slate-100 text-slate-700 border-slate-200"
              }
            >
              {isActive ? t("logistics.status.active") : t("logistics.status.inactive")}
            </Badge>
          </div>
          <p className="text-slate-500">{t("logistics.profile.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-sm text-slate-600">
              {isActive ? t("logistics.status.active") : t("logistics.status.inactive")}
            </span>
            <Switch
              checked={isActive}
              disabled={togglingStatus}
              onCheckedChange={() => void handleToggleStatus()}
            />
          </div>
          <Button
            className="bg-slate-900 hover:bg-slate-800"
            onClick={() => navigate(logisticsPartnerEditPath(partner))}
          >
            <Edit className="w-4 h-4 mr-2" />
            {t("logistics.edit")}
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-4">
        {partner.logo ? (
          <img
            src={partner.logo}
            alt=""
            className="w-16 h-16 rounded-lg border border-slate-200 object-cover shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
            <Truck className="w-8 h-8 text-slate-400" />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
          <div>
            <p className="text-xs text-slate-500">{t("logistics.coverage")}</p>
            <p className="text-sm font-medium text-slate-900 mt-1">
              {t("logistics.regionsCount").replace("{count}", String(regionKeys.length))}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("logistics.cod")}</p>
            {partner.codSupported ? (
              <p className="text-sm font-medium text-green-600 mt-1">
                {t("logistics.yes")}
              </p>
            ) : (
              <p className="text-sm font-medium text-slate-400 mt-1">
                {t("logistics.notAvailable")}
              </p>
            )}
          </div>
        </div>
      </div>

      {regionKeys.length > 0 ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-900">
            {t("logistics.profile.ratesByRegion")}
          </p>
          {regionKeys.map((region) => {
            const rate = partner.regionRates[region];
            const deliveryLabel = rate?.estimatedDays
              ? formatDeliveryLabel(rate.estimatedDays) || rate.estimatedDays
              : "—";
            const exceptions = Object.entries(rate?.townshipExceptions || {}).sort(
              ([a], [b]) =>
                getMyanmarTownshipLabel(a, language).localeCompare(
                  getMyanmarTownshipLabel(b, language),
                  language === "my" ? "my" : "en"
                )
            );

            return (
              <div
                key={region}
                className="border border-slate-200 rounded-lg overflow-hidden bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-purple-50/70 border-b border-purple-100">
                  <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
                    <MapPin className="w-4 h-4 text-purple-500 shrink-0" />
                    {regionLabel(region)}
                  </span>
                  {exceptions.length > 0 && (
                    <Badge variant="secondary" className="bg-white text-purple-700 border-purple-200">
                      {t("logistics.profile.exceptionCount").replace(
                        "{count}",
                        String(exceptions.length)
                      )}
                    </Badge>
                  )}
                </div>

                <div className="p-4 space-y-4">
                  <div className="rounded-md border border-slate-200 bg-slate-50/80 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("logistics.profile.defaultRate")}
                    </p>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-slate-500">{t("logistics.profile.delivery")}</p>
                        <p className="mt-0.5 font-medium text-slate-900 inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                          {deliveryLabel}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">{t("logistics.profile.priceRange")}</p>
                        <p className="mt-0.5 font-medium text-slate-900">
                          {rate ? formatCostRangeKyats(rate.costMin, rate.costMax) : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                      {t("logistics.profile.townshipExceptions")}
                    </p>
                    {exceptions.length > 0 ? (
                      <div className="border border-slate-200 rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-50 text-left">
                              <th className="px-3 py-2 font-medium text-slate-600">
                                {t("logistics.profile.township")}
                              </th>
                              <th className="px-3 py-2 font-medium text-slate-600">
                                {t("logistics.profile.priceRange")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {exceptions.map(([township, exception]) => (
                              <tr key={`${region}-${township}`} className="border-t border-slate-100">
                                <td className="px-3 py-2 text-slate-800">
                                  {getMyanmarTownshipLabel(township, language)}
                                </td>
                                <td className="px-3 py-2 font-medium text-slate-900">
                                  {formatCostRangeKyats(exception.costMin, exception.costMax)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 italic">
                        {t("logistics.profile.allTownshipsDefault")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-500">{t("logistics.profile.noRates")}</p>
      )}
    </div>
  );
}
