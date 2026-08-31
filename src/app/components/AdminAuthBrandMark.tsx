import { usePlatformBranding } from "../hooks/usePlatformBranding";
import { displayPlatformBrandName } from "../utils/platformBranding";

/** Logo or wordmark above super-admin login / setup / password forms. */
export function AdminAuthBrandMark({ className = "" }: { className?: string }) {
  const { storeName, storeLogo } = usePlatformBranding({ applyFavicon: false });
  const brand = displayPlatformBrandName(storeName);
  const logo = storeLogo?.trim();

  if (logo) {
    return (
      <div className={`flex justify-center mb-6 ${className}`.trim()}>
        <img src={logo} alt={brand} className="h-14 max-w-[220px] object-contain" />
      </div>
    );
  }

  return (
    <div className={`flex justify-center mb-6 ${className}`.trim()}>
      <div className="text-4xl font-bold text-slate-900 dark:text-white drop-shadow-2xl">
        {brand}
      </div>
    </div>
  );
}
