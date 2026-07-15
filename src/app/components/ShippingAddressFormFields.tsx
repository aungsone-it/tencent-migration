import { useMemo } from "react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { MyanmarSearchableSelect } from "./MyanmarSearchableSelect";
import { useLanguage } from "../contexts/LanguageContext";
import {
  isTownshipInMyanmarRegion,
  myanmarRegionSelectOptions,
  myanmarTownshipSelectOptions,
} from "../utils/myanmarRegions";

export type ShippingAddressFormValue = {
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  isDefault: boolean;
};

const labelClass = "mb-1.5 block text-sm font-medium text-slate-800";
const inputClass =
  "h-11 min-h-11 bg-slate-50 border-slate-200 text-slate-900 text-sm rounded-lg placeholder:text-slate-500 focus:border-slate-900 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:ring-transparent";
const selectClass = [
  inputClass,
  "w-full !h-11 px-3 shadow-none",
  "data-[placeholder]:text-slate-500",
  "disabled:cursor-not-allowed disabled:opacity-100",
  "disabled:data-[placeholder]:text-slate-500",
  "[&_svg]:text-slate-500 [&_svg]:opacity-80",
].join(" ");

export function isShippingAddressFormValid(value: ShippingAddressFormValue): boolean {
  return Boolean(
    value.label.trim() &&
      value.recipientName.trim() &&
      value.phone.trim() &&
      value.addressLine1.trim() &&
      value.state.trim() &&
      value.city.trim()
  );
}

type ShippingAddressFormFieldsProps = {
  value: ShippingAddressFormValue;
  onChange: (next: ShippingAddressFormValue) => void;
  idPrefix?: string;
  defaultCheckboxId?: string;
};

export function ShippingAddressFormFields({
  value,
  onChange,
  idPrefix = "shipping-addr",
  defaultCheckboxId = "shipping-addr-default",
}: ShippingAddressFormFieldsProps) {
  const { t, language } = useLanguage();
  const patch = (partial: Partial<ShippingAddressFormValue>) => onChange({ ...value, ...partial });

  const regionSelectOptions = useMemo(
    () => myanmarRegionSelectOptions(value.state),
    [value.state]
  );

  const townshipSelectOptions = useMemo(
    () => myanmarTownshipSelectOptions(value.state, value.city),
    [value.state, value.city]
  );

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor={`${idPrefix}-label`} className={labelClass}>
          {t("storefront.account.addressLabel")}
        </Label>
        <Input
          id={`${idPrefix}-label`}
          placeholder={t("storefront.account.addressLabelPlaceholder")}
          value={value.label}
          onChange={(e) => patch({ label: e.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900" style={{ fontFamily: "Rubik, sans-serif" }}>
          {t("checkout.contact")}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <Label htmlFor={`${idPrefix}-name`} className={labelClass}>
              {t("checkout.fullName")} *
            </Label>
            <Input
              id={`${idPrefix}-name`}
              placeholder={t("checkout.fullNamePlaceholder")}
              value={value.recipientName}
              onChange={(e) => patch({ recipientName: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-phone`} className={labelClass}>
              {t("checkout.phoneNumber")} *
            </Label>
            <Input
              id={`${idPrefix}-phone`}
              type="tel"
              placeholder="+95 9 XXX XXX XXX"
              value={value.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900" style={{ fontFamily: "Rubik, sans-serif" }}>
          {t("checkout.address")}
        </h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor={`${idPrefix}-street`} className={labelClass}>
              {t("checkout.address")} *
            </Label>
            <Input
              id={`${idPrefix}-street`}
              placeholder={t("checkout.addressPlaceholder")}
              value={value.addressLine1}
              onChange={(e) => patch({ addressLine1: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-state`} className={labelClass}>
              {t("checkout.stateRegion")} *
            </Label>
            <MyanmarSearchableSelect
              id={`${idPrefix}-state`}
              value={value.state}
              onValueChange={(state) =>
                patch({
                  state,
                  city: isTownshipInMyanmarRegion(state, value.city) ? value.city : "",
                })
              }
              options={regionSelectOptions}
              placeholder={t("checkout.selectStateRegion")}
              searchPlaceholder={t("checkout.searchStateRegion")}
              emptyText={t("checkout.noLocationResults")}
              className={selectClass}
              language={language}
              kind="region"
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-township`} className={labelClass}>
              {t("checkout.township")} *
            </Label>
            <MyanmarSearchableSelect
              id={`${idPrefix}-township`}
              value={value.city}
              onValueChange={(city) => patch({ city })}
              options={townshipSelectOptions}
              placeholder={
                value.state.trim() ? t("checkout.selectTownship") : t("checkout.selectStateFirst")
              }
              searchPlaceholder={t("checkout.searchTownship")}
              emptyText={t("checkout.noLocationResults")}
              disabled={!value.state.trim()}
              className={selectClass}
              language={language}
              kind="township"
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-notes`} className={labelClass}>
              {t("checkout.notes")}
            </Label>
            <Textarea
              id={`${idPrefix}-notes`}
              placeholder={t("checkout.notesPlaceholder")}
              value={value.addressLine2}
              onChange={(e) => patch({ addressLine2: e.target.value })}
              className="min-h-[80px] resize-none rounded-lg border-slate-200 bg-slate-50 text-sm focus:border-slate-900 focus:ring-0"
              rows={3}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id={defaultCheckboxId}
          checked={value.isDefault}
          onCheckedChange={(checked) => patch({ isDefault: checked === true })}
        />
        <Label htmlFor={defaultCheckboxId} className="cursor-pointer">
          {t("storefront.account.setDefaultAddress")}
        </Label>
      </div>
    </div>
  );
}
