import { formatNumber } from "../../utils/formatNumber";
import { cn } from "./ui/utils";

type AdminMmkAmountProps = {
  value: number;
  size?: "lg" | "md" | "sm";
  tone?: "default" | "emerald" | "green";
  className?: string;
};

/** Whole MMK amounts with a tiny unit label — used on admin stat cards and lists. */
export function AdminMmkAmount({
  value,
  size = "lg",
  tone = "default",
  className,
}: AdminMmkAmountProps) {
  const amount = Math.round(Number(value) || 0);
  const toneClass =
    tone === "emerald" ? "text-emerald-600" : tone === "green" ? "text-green-600" : "text-slate-900";
  const amountClass =
    size === "lg"
      ? "text-2xl font-semibold leading-tight"
      : size === "md"
        ? "text-base font-semibold"
        : "text-sm font-semibold";

  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-baseline gap-1 tabular-nums", className)}>
      <span className={cn(amountClass, toneClass)}>{formatNumber(amount)}</span>
      <span className="text-[7px] font-medium uppercase leading-none tracking-wider text-slate-400">
        MMK
      </span>
    </span>
  );
}
