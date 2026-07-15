import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Clock, Edit, Loader2, MapPin, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { logisticsApi, type DeliveryPartner } from "../../utils/api";
import {
  formatCostKyats,
  formatCostRangeKyats,
  getPartnerRegionKeys,
} from "../utils/logisticsRegions";
import { findPartnerBySlug, logisticsPartnerEditPath } from "../utils/logisticsPartnerSlug";
import { getMyanmarRegionLabel } from "../utils/myanmarRegionLabels";
import { formatEstimatedDeliveryLabel } from "../utils/checkoutLogistics";
import { logisticsApiErrorMessage } from "../utils/logisticsPartnerForm";
import { useLanguage } from "../contexts/LanguageContext";

type LogisticsPartnerProfileProps = {
  slug: string;
};

export function LogisticsPartnerProfile({ slug }: LogisticsPartnerProfileProps) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [loading, setLoading] = useState(true);

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
                partner.status === "active"
                  ? "bg-green-100 text-green-700 border-green-200"
                  : "bg-slate-100 text-slate-700 border-slate-200"
              }
            >
              {partner.status === "active"
                ? t("logistics.status.active")
                : t("logistics.status.inactive")}
            </Badge>
          </div>
          <p className="text-slate-500">{t("logistics.profile.subtitle")}</p>
        </div>
        <Button
          className="bg-slate-900 hover:bg-slate-800 shrink-0"
          onClick={() => navigate(logisticsPartnerEditPath(partner))}
        >
          <Edit className="w-4 h-4 mr-2" />
          {t("logistics.edit")}
        </Button>
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
                {partner.codFee ? ` (+${formatCostKyats(partner.codFee)})` : ""}
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
        <div>
          <p className="text-sm font-medium text-slate-900 mb-2">
            {t("logistics.profile.ratesByRegion")}
          </p>
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-3 py-2 font-medium text-slate-600">
                    {t("logistics.profile.region")}
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-600">
                    {t("logistics.profile.delivery")}
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-600">
                    {t("logistics.profile.priceRange")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {regionKeys.map((region) => {
                  const rate = partner.regionRates[region];
                  const deliveryLabel = rate?.estimatedDays
                    ? formatDeliveryLabel(rate.estimatedDays) || rate.estimatedDays
                    : "—";
                  return (
                    <tr key={region} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-purple-500 shrink-0" />
                          {regionLabel(region)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 shrink-0" />
                          {deliveryLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {rate ? formatCostRangeKyats(rate.costMin, rate.costMax) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{t("logistics.profile.noRates")}</p>
      )}
    </div>
  );
}
