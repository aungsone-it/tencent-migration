import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Truck,
  Edit,
  Trash2,
  Globe,
  Wallet,
  Loader2,
  Plus,
  Package,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { AdminClearableSearchInput } from "./AdminClearableSearchInput";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { logisticsApi, type DeliveryPartner } from "../../utils/api";
import { LOGISTICS_REGION_OPTIONS, getPartnerRegionKeys } from "../utils/logisticsRegions";
import { logisticsApiErrorMessage } from "../utils/logisticsPartnerForm";
import {
  LOGISTICS_PARTNER_CREATE_PATH,
  logisticsPartnerEditPath,
  logisticsPartnerProfilePath,
} from "../utils/logisticsPartnerSlug";
import { getMyanmarRegionLabel } from "../utils/myanmarRegionLabels";
import { useLanguage } from "../contexts/LanguageContext";

export function Logistics() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRegion, setSelectedRegion] = useState<string>("all");

  const regionLabel = useCallback(
    (region: string) => getMyanmarRegionLabel(region, language),
    [language]
  );

  const loadPartners = useCallback(async () => {
    setLoading(true);
    try {
      const res = await logisticsApi.getPartners();
      setPartners(Array.isArray(res.partners) ? res.partners : []);
    } catch (error) {
      console.error("Failed to load delivery partners:", error);
      toast.error(logisticsApiErrorMessage(error, "load"));
      setPartners([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  const filteredServices = useMemo(() => {
    return partners.filter((service) => {
      const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase());
      const regionKeys = getPartnerRegionKeys(service.regionRates);
      const matchesRegion =
        selectedRegion === "all" || regionKeys.includes(selectedRegion);
      return matchesSearch && matchesRegion;
    });
  }, [partners, searchQuery, selectedRegion]);

  const uniqueRegionsCovered = useMemo(() => {
    const set = new Set<string>();
    partners.forEach((s) => getPartnerRegionKeys(s.regionRates).forEach((r) => set.add(r)));
    return set.size;
  }, [partners]);

  const totalPartners = partners.length;
  const activePartners = partners.filter((s) => s.status === "active").length;
  const codEnabledPartners = partners.filter((s) => s.codSupported).length;

  const handleDelete = async (partner: DeliveryPartner) => {
    const ok = window.confirm(`Remove "${partner.name}" from delivery partners?`);
    if (!ok) return;

    try {
      await logisticsApi.deletePartner(partner.id);
      setPartners((prev) => prev.filter((p) => p.id !== partner.id));
      toast.success("Delivery partner removed");
    } catch (error) {
      console.error("Failed to delete delivery partner:", error);
      toast.error(logisticsApiErrorMessage(error, "delete"));
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Logistics</h1>
          <p className="text-slate-500 mt-1 max-w-[42rem]">
            Manage delivery partners and carriers — set region-specific delivery times,
            price ranges, and cash-on-delivery options.
          </p>
        </div>
        <Button
          className="bg-slate-900 hover:bg-slate-800 shrink-0"
          onClick={() => navigate(LOGISTICS_PARTNER_CREATE_PATH)}
        >
          <Truck className="w-4 h-4 mr-2" />
          Add delivery partner
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Delivery partners</p>
                <p className="text-3xl font-bold text-slate-900 mt-2">{totalPartners}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Truck className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Active carriers</p>
                <p className="text-3xl font-bold text-slate-900 mt-2">{activePartners}</p>
                <p className="text-xs text-slate-500 mt-1">of {totalPartners} configured</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Truck className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">COD-enabled</p>
                <p className="text-3xl font-bold text-slate-900 mt-2">{codEnabledPartners}</p>
                <p className="text-xs text-slate-500 mt-1">partners offer cash on delivery</p>
              </div>
              <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
                <Wallet className="w-6 h-6 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Regions covered</p>
                <p className="text-3xl font-bold text-slate-900 mt-2">{uniqueRegionsCovered}</p>
                <p className="text-xs text-slate-500 mt-1">unique regions across partners</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Globe className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-4 flex-col sm:flex-row">
            <div className="flex-1">
              <AdminClearableSearchInput
                placeholder="Search delivery partners by name..."
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
            </div>
            <Select value={selectedRegion} onValueChange={setSelectedRegion}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Filter by region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {LOGISTICS_REGION_OPTIONS.map((region) => (
                  <SelectItem key={region} value={region}>
                    {regionLabel(region)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Loading delivery partners…
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="text-center py-16 space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center">
                <Truck className="w-7 h-7 text-slate-400" />
              </div>
              <div>
                <p className="font-medium text-slate-900">
                  {partners.length === 0 ? "No delivery partners yet" : "No partners match your filters"}
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  {partners.length === 0
                    ? "Add your first carrier to start managing logistics."
                    : "Try a different search or region filter."}
                </p>
              </div>
              {partners.length === 0 && (
                <Button
                  className="bg-slate-900 hover:bg-slate-800"
                  onClick={() => navigate(LOGISTICS_PARTNER_CREATE_PATH)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add delivery partner
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredServices.map((service) => {
                const regionKeys = getPartnerRegionKeys(service.regionRates);
                return (
                  <div
                    key={service.id}
                    className="border border-slate-200 rounded-lg p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        {service.logo ? (
                          <img
                            src={service.logo}
                            alt=""
                            className="w-14 h-14 rounded-lg border border-slate-200 object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
                            <Truck className="w-7 h-7 text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-3">
                            <h3 className="font-semibold text-slate-900">{service.name}</h3>
                            <Badge
                              variant="secondary"
                              className={
                                service.status === "active"
                                  ? "bg-green-100 text-green-700 border-green-200"
                                  : "bg-slate-100 text-slate-700 border-slate-200"
                              }
                            >
                              {service.status}
                            </Badge>
                            {service.codSupported && (
                              <Badge
                                variant="secondary"
                                className="bg-amber-100 text-amber-700 border-amber-200"
                              >
                                COD available
                              </Badge>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
                            <div>
                              <p className="text-xs text-slate-500">Coverage</p>
                              <p className="text-sm font-medium text-slate-900 mt-1">
                                {regionKeys.length} regions
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Cash on delivery</p>
                              {service.codSupported ? (
                                <p className="text-sm font-medium text-green-600 mt-1">Yes</p>
                              ) : (
                                <p className="text-sm font-medium text-slate-400 mt-1">Not available</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center shrink-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 rounded-lg border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                              title="Actions"
                            >
                              <Package className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => navigate(logisticsPartnerProfilePath(service))}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              View profile
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => navigate(logisticsPartnerEditPath(service))}
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => void handleDelete(service)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
