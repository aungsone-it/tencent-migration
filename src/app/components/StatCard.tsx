import { LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { Card } from "./ui/card";
import { cn } from "./ui/utils";
import { AdminDateRangeFilterPopover } from "./AdminDateRangeFilterPopover";
import { useLanguage } from "../contexts/LanguageContext";
import { format } from "date-fns";

interface StatCardProps {
  title: string;
  value: ReactNode;
  change: string;
  changeType: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  iconBgColor: string;
  dateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  hintText?: string;
  onClick?: () => void;
}

export function StatCard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  iconBgColor,
  dateRange,
  onDateRangeChange,
  hintText,
  onClick,
}: StatCardProps) {
  const { t } = useLanguage();
  const clickable = typeof onClick === "function";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!clickable) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden transition-shadow duration-200 hover:shadow-lg",
        clickable && "cursor-pointer",
      )}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-3 p-6">
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="text-sm font-medium text-slate-600">{title}</p>
          <p className="mt-1 break-words text-2xl font-semibold tabular-nums text-slate-900">
            {value}
          </p>
          <p
            className={cn(
              "mt-2 text-sm font-medium leading-snug break-words",
              changeType === "positive" && "text-green-600",
              changeType === "negative" && "text-red-600",
              changeType === "neutral" && "text-slate-500",
            )}
          >
            {change}
          </p>
        </div>
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
            iconBgColor,
          )}
        >
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
      {dateRange != null && onDateRangeChange ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 px-6 py-3"
          onClick={(event) => event.stopPropagation()}
        >
          <AdminDateRangeFilterPopover
            value={dateRange}
            onChange={onDateRangeChange}
            hintText={hintText ?? t("finances.filterByDate")}
            align="start"
          >
            <button
              type="button"
              className="text-xs font-medium text-blue-600 underline-offset-2 hover:text-blue-700 hover:underline"
            >
              {t("finances.filterByDate")}
            </button>
          </AdminDateRangeFilterPopover>
          {dateRange?.from && dateRange?.to && (
            <span className="text-xs text-slate-500">
              {format(dateRange.from, "MMM d, yyyy")} – {format(dateRange.to, "MMM d, yyyy")}
            </span>
          )}
        </div>
      ) : null}
    </Card>
  );
}
