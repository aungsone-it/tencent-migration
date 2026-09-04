import { useEffect, useMemo, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { format, startOfToday, subDays, isSameDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { X } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar as CalendarComponent } from "./ui/calendar";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";

export type AdminDateFilterPreset = "today" | "yesterday" | "last7" | "last30";

export type AdminDateRangeFilterBaseProps = {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  hintText: string;
  titleText?: string;
  closeOnComplete?: boolean;
  showPresets?: boolean;
  initialPickerMode?: "single" | "range";
  onClose?: () => void;
};

export type AdminDateRangeFilterPopoverProps = AdminDateRangeFilterBaseProps & {
  children: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  presentation?: "popover" | "section-modal";
};

export type AdminDateRangeFilterSectionModalProps = AdminDateRangeFilterBaseProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const PRESET_OPTIONS: AdminDateFilterPreset[] = [
  "today",
  "yesterday",
  "last7",
  "last30",
];

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function presetToRange(preset: AdminDateFilterPreset): DateRange {
  const today = startOfToday();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = subDays(today, 1);
      return { from: day, to: day };
    }
    case "last7":
      return { from: subDays(today, 6), to: today };
    case "last30":
      return { from: subDays(today, 29), to: today };
  }
}

function rangeMatchesPreset(
  value: DateRange | undefined,
  preset: AdminDateFilterPreset,
): boolean {
  if (!value?.from || !value?.to) return false;
  const expected = presetToRange(preset);
  return (
    isSameDay(value.from, expected.from!) &&
    isSameDay(value.to, expected.to!)
  );
}

function usePrefersSingleMonthCalendar(): boolean {
  const [prefersSingle, setPrefersSingle] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 767px)").matches
      : false,
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const onChange = () => setPrefersSingle(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return prefersSingle;
}

export function formatAdminDateRangeLabel(
  range: DateRange | undefined,
  allTimeLabel: string,
): string {
  if (!range?.from) return allTimeLabel;
  const end = range.to ?? range.from;
  if (!range.to || isSameCalendarDay(range.from, end)) {
    return format(range.from, "MMM d, yyyy");
  }
  return `${format(range.from, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}

function calendarClassNames(compact = false) {
  const daySize = compact ? "size-8" : "size-9";
  const headWidth = compact ? "w-8" : "w-9";

  return {
    months: "flex flex-col gap-6 md:flex-row md:gap-10",
    month: "space-y-3",
    caption: "relative flex items-center justify-center pb-1",
    caption_label: "text-sm font-semibold text-slate-900",
    nav_button:
      "inline-flex size-8 items-center justify-center rounded-[5px] border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
    head_row: "flex gap-1.5",
    head_cell: cn(
      headWidth,
      "text-[0.65rem] font-medium uppercase tracking-wide text-slate-400",
    ),
    row: "mt-2 flex w-full gap-1.5",
    cell: "relative p-0 text-center text-sm [&:has([aria-selected])]:bg-transparent",
    day: cn(
      "inline-flex rounded-[5px] p-0 text-sm font-normal text-slate-700 transition-colors",
      "hover:bg-slate-100 aria-selected:opacity-100",
      daySize,
      "items-center justify-center",
    ),
    day_selected:
      "rounded-[5px] bg-slate-900 text-white hover:bg-slate-900 hover:text-white focus:bg-slate-900 focus:text-white",
    day_today: "rounded-[5px] font-semibold text-slate-900 ring-1 ring-slate-300 ring-inset",
    day_outside: "text-slate-300",
    day_disabled: "text-slate-300 opacity-40",
    day_range_middle:
      "rounded-[5px] bg-slate-200/90 text-slate-900 aria-selected:bg-slate-200/90 aria-selected:text-slate-900",
    day_range_start:
      "day-range-start rounded-[5px] bg-slate-900 text-white hover:bg-slate-900 hover:text-white",
    day_range_end:
      "day-range-end rounded-[5px] bg-slate-900 text-white hover:bg-slate-900 hover:text-white",
  };
}

function ModeSwitch({
  mode,
  onChange,
  singleLabel,
  rangeLabel,
  fullWidth = false,
}: {
  mode: "single" | "range";
  onChange: (mode: "single" | "range") => void;
  singleLabel: string;
  rangeLabel: string;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex gap-1 rounded-[5px] border border-slate-200 bg-slate-100 p-1",
        fullWidth && "grid w-full grid-cols-2",
      )}
    >
      {(["single", "range"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium transition-all",
            mode === option
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          {option === "single" ? singleLabel : rangeLabel}
        </button>
      ))}
    </div>
  );
}

function AdminDateRangeFilterPanel({
  value,
  onChange,
  hintText,
  titleText,
  closeOnComplete = true,
  showPresets = false,
  initialPickerMode = "range",
  onClose,
  layout = "compact",
}: AdminDateRangeFilterBaseProps & {
  layout?: "compact" | "modal";
}) {
  const { t } = useLanguage();
  const prefersSingleMonth = usePrefersSingleMonthCalendar();
  const [pickerMode, setPickerMode] = useState<"single" | "range">(
    showPresets ? "single" : initialPickerMode,
  );

  useEffect(() => {
    setPickerMode(showPresets ? "single" : initialPickerMode);
  }, [showPresets, initialPickerMode]);

  const title = titleText ?? t("finances.filterByDate");
  const isModal = layout === "modal";
  const closePanel = () => onClose?.();

  const applyPreset = (preset: AdminDateFilterPreset) => {
    onChange(presetToRange(preset));
    if (!isModal) closePanel();
  };

  const clearFilter = () => {
    onChange(undefined);
    if (!isModal) closePanel();
  };

  const applyCurrentSelection = () => {
    if (value?.from && !value?.to) {
      onChange({ from: value.from, to: value.from });
    }
    if (!isModal) closePanel();
  };

  const presetLabel = useMemo(
    () =>
      ({
        today: t("admin.dateFilter.today"),
        yesterday: t("admin.dateFilter.yesterday"),
        last7: t("admin.dateFilter.last7Days"),
        last30: t("admin.dateFilter.last30Days"),
      }) satisfies Record<AdminDateFilterPreset, string>,
    [t],
  );

  const rangeMonthCount =
    pickerMode === "range" && isModal && !prefersSingleMonth ? 2 : 1;
  const compactCalendar = rangeMonthCount === 2;

  const calendarHint =
    pickerMode === "single"
      ? t("admin.dateFilter.singleDayHint")
      : value?.from && !value?.to
        ? t("admin.dateFilter.rangeEndHint")
        : t("admin.dateFilter.rangeStartHint");

  const calendarNode =
    pickerMode === "single" ? (
      <CalendarComponent
        mode="single"
        defaultMonth={value?.from}
        selected={value?.from}
        onSelect={(day) => {
          if (!day) return;
          onChange({ from: day, to: day });
          if (!isModal) closePanel();
        }}
        numberOfMonths={1}
        className="p-0"
        classNames={calendarClassNames(compactCalendar)}
      />
    ) : (
      <CalendarComponent
        mode="range"
        defaultMonth={value?.from}
        selected={value}
        onSelect={(range) => {
          onChange(range);
          if (!isModal && closeOnComplete && range?.from && range?.to) {
            closePanel();
          }
        }}
        numberOfMonths={isModal ? rangeMonthCount : 2}
        className="p-0"
        classNames={calendarClassNames(compactCalendar)}
      />
    );

  if (!showPresets) {
    return (
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">{title}</p>
            <p className="mt-0.5 text-xs text-slate-500">{hintText}</p>
          </div>
          {value?.from ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs text-slate-500"
              onClick={clearFilter}
            >
              {t("finances.clearDateFilter")}
            </Button>
          ) : null}
        </div>
        <div className="p-3">{calendarNode}</div>
      </div>
    );
  }

  if (isModal) {
    const canApply = Boolean(value?.from);
    const rangeIncomplete = Boolean(value?.from && !value?.to);

    return (
      <div className="overflow-hidden rounded-[5px] bg-white shadow-2xl ring-1 ring-black/5">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{hintText}</p>
          </div>
          <button
            type="button"
            onClick={closePanel}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[5px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="h-px bg-slate-100" aria-hidden="true" />

        <div className="space-y-6 px-6 py-5">
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              {t("admin.dateFilter.quickSelect")}
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {PRESET_OPTIONS.map((preset) => {
                const active = rangeMatchesPreset(value, preset);
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      "rounded-[5px] border px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    {presetLabel[preset]}
                  </button>
                );
              })}
            </div>
          </div>

          <ModeSwitch
            mode={pickerMode}
            onChange={setPickerMode}
            singleLabel={t("admin.dateFilter.singleDay")}
            rangeLabel={t("admin.dateFilter.customRange")}
            fullWidth
          />

          <div className="rounded-[5px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="mb-5 text-center text-sm text-slate-500">{calendarHint}</p>
            <div className="flex justify-center overflow-x-auto">{calendarNode}</div>
          </div>
        </div>

        <div className="h-px bg-slate-100" aria-hidden="true" />

        <div className="flex flex-col gap-3 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-slate-700">
            {value?.from
              ? formatAdminDateRangeLabel(value, t("finances.allTime"))
              : t("finances.allTime")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {value?.from ? (
              <Button variant="ghost" size="sm" onClick={clearFilter}>
                {t("finances.clearDateFilter")}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={closePanel}>
              {t("common.cancel")}
            </Button>
            {rangeIncomplete ? (
              <Button size="sm" onClick={applyCurrentSelection}>
                {t("admin.dateFilter.applyThisDay")}
              </Button>
            ) : canApply ? (
              <Button size="sm" onClick={closePanel}>
                {t("admin.dateFilter.applyFilter")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <button
          type="button"
          onClick={closePanel}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="space-y-4 p-3">
        <div className="flex flex-wrap gap-2">
          {PRESET_OPTIONS.map((preset) => {
            const active = rangeMatchesPreset(value, preset);
            return (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                {presetLabel[preset]}
              </button>
            );
          })}
        </div>

        <ModeSwitch
          mode={pickerMode}
          onChange={setPickerMode}
          singleLabel={t("admin.dateFilter.singleDay")}
          rangeLabel={t("admin.dateFilter.customRange")}
        />

        {calendarNode}

        {pickerMode === "range" && value?.from && !value?.to ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-full text-xs"
            onClick={applyCurrentSelection}
          >
            {t("admin.dateFilter.applyThisDay")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AdminDateRangeFilterSectionModal({
  open,
  onOpenChange,
  ...panelProps
}: AdminDateRangeFilterSectionModalProps) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/75 px-4 py-8 sm:items-center sm:py-10"
      role="dialog"
      aria-modal="true"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="admin-date-modal-box w-full max-w-md sm:max-w-lg md:max-w-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <AdminDateRangeFilterPanel
          {...panelProps}
          layout="modal"
          closeOnComplete={false}
          onClose={() => onOpenChange(false)}
        />
      </div>
    </div>,
    document.body,
  );
}

export function AdminDateRangeFilterPopover({
  value,
  onChange,
  hintText,
  titleText,
  children,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  align = "start",
  closeOnComplete = true,
  showPresets = false,
  initialPickerMode = "range",
  presentation = "popover",
}: AdminDateRangeFilterPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;

  const handleOpenChange = (next: boolean) => {
    onOpenChangeProp?.(next);
    if (openProp === undefined) setInternalOpen(next);
  };

  if (presentation === "section-modal") {
    return (
      <>
        <div onClick={() => handleOpenChange(true)}>{children}</div>
        <AdminDateRangeFilterSectionModal
          open={open}
          onOpenChange={handleOpenChange}
          value={value}
          onChange={onChange}
          hintText={hintText}
          titleText={titleText}
          closeOnComplete={closeOnComplete}
          showPresets={showPresets}
          initialPickerMode={initialPickerMode}
        />
      </>
    );
  }

  const panel = (
    <AdminDateRangeFilterPanel
      value={value}
      onChange={onChange}
      hintText={hintText}
      titleText={titleText}
      closeOnComplete={closeOnComplete}
      showPresets={showPresets}
      initialPickerMode={initialPickerMode}
      onClose={() => handleOpenChange(false)}
      layout="compact"
    />
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className={cn(
          "p-0",
          showPresets
            ? "w-[min(calc(100vw-1.5rem),20rem)] sm:w-[min(calc(100vw-2rem),21rem)]"
            : "w-auto max-w-[calc(100vw-1.5rem)]",
        )}
        align={align}
        sideOffset={6}
        collisionPadding={12}
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
