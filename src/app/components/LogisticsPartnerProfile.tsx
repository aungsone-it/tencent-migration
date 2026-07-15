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
import { useLanguage } from "../contexts/LanguageContext";

type LogisticsPartnerProfileProps = {
  slug: string;
};

function logisticsApiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Failed to load delivery partner";
  const msg = error.message.trim();
  if (/not found|404|not deployed/i.test(msg)) {
    return "Logistics API is not deployed yet. Run: npm run deploy:functions — then try again.";
  }
  return msg || "Failed to load delivery partner";
}

export function LogisticsPartnerProfile({ slug }: LogisticsPartnerProfileProps) {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [loading, setLoading] = useState(true);

  const regionLabel = useCallback(
    (region: string) => getMyanmarRegionLabel(region, language),
    [language]
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
          toast.error(logisticsApiErrorMessage(error));
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
        Loading delivery partner…
      </div>
    );
  }

  if (!partner) {
    return (
      <div className="p-8 max-w-lg space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Delivery partner not found</h2>
        <p className="text-sm text-slate-600">
          No partner matches <code className="text-xs bg-slate-100 px-1 rounded">{slug}</code>.
        </p>
        <Button variant="outline" onClick={() => navigate("/admin/logistics")}>
          Back to Logistics
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
              {partner.status}
            </Badge>
          </div>
          <p className="text-slate-500">Delivery partner setup and regional rates.</p>
        </div>
        <Button
          className="bg-slate-900 hover:bg-slate-800 shrink-0"
          onClick={() => navigate(logisticsPartnerEditPath(partner))}
        >
          <Edit className="w-4 h-4 mr-2" />
          Edit
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
            <p className="text-xs text-slate-500">Coverage</p>
            <p className="text-sm font-medium text-slate-900 mt-1">{regionKeys.length} regions</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Cash on delivery</p>
            {partner.codSupported ? (
              <p className="text-sm font-medium text-green-600 mt-1">
                Yes
                {partner.codFee ? ` (+${formatCostKyats(partner.codFee)})` : ""}
              </p>
            ) : (
              <p className="text-sm font-medium text-slate-400 mt-1">Not available</p>
            )}
          </div>
        </div>
      </div>

      {regionKeys.length > 0 ? (
        <div>
          <p className="text-sm font-medium text-slate-900 mb-2">Rates by region</p>
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-3 py-2 font-medium text-slate-600">Region</th>
                  <th className="px-3 py-2 font-medium text-slate-600">Delivery</th>
                  <th className="px-3 py-2 font-medium text-slate-600">Price range</th>
                </tr>
              </thead>
              <tbody>
                {regionKeys.map((region) => {
                  const rate = partner.regionRates[region];
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
                          {rate?.estimatedDays || "—"}
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
        <p className="text-sm text-slate-500">No regional rates configured.</p>
      )}
    </div>
  );
}
