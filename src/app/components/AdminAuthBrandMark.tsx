import { usePlatformBranding } from "../hooks/usePlatformBranding";
import { displayPlatformBrandName } from "../utils/platformBranding";

/** Site name wordmark above super-admin login / setup / password forms. */
export function AdminAuthBrandMark({ className = "" }: { className?: string }) {
  const { storeName } = usePlatformBranding({ applyFavicon: false });
  const brand = displayPlatformBrandName(storeName);

  return (
    <div className={`flex justify-center mb-6 ${className}`.trim()}>
      <div className="text-4xl font-bold text-slate-900 dark:text-white drop-shadow-2xl">
        {brand}
      </div>
    </div>
  );
}
