import { Navigate, useLocation } from "react-router";
import { vendorDashPrefixPathToSlash } from "../utils/vendorStorefrontRoutePaths";

/** Canonicalize legacy `/vendor-nexa/...` bookmarks to `/vendor/nexa/...`. */
export function VendorDashPrefixRedirect() {
  const location = useLocation();
  const target = vendorDashPrefixPathToSlash(location.pathname);
  if (!target) {
    return <Navigate to="/" replace />;
  }
  return (
    <Navigate
      to={{ pathname: target, search: location.search, hash: location.hash }}
      replace
    />
  );
}
