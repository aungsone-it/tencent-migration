import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { isVendorStorefrontCustomerPath } from "../utils/vendorHostResolution";

/**
 * 🔥 SINGLE SOURCE OF TRUTH FOR ALL SCROLL BEHAVIOR
 * 
 * This component handles ALL scroll restoration across the entire app.
 * - Runs BEFORE any paint/render
 * - Instant scroll to top (0, 0)
 * - No animations, no smooth scrolling
 * - No race conditions
 * 
 * DO NOT add scroll handlers anywhere else in the app!
 */
export function ScrollController() {
  const location = useLocation();
  const previousPathnameRef = useRef(location.pathname);

  // Disable browser's scroll restoration immediately
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  // Reset scroll INSTANTLY on route change — except vendor storefront list ↔ product hops
  // (VendorStoreView restores its own internal scroll container on back navigation).
  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = location.pathname;

    if (
      isVendorStorefrontCustomerPath(previousPathname) &&
      isVendorStorefrontCustomerPath(location.pathname)
    ) {
      return;
    }

    const scrollToTop = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    scrollToTop();
    Promise.resolve().then(scrollToTop);
  }, [location.pathname, location.search, location.hash, location.key]);

  return null; // This component doesn't render anything
}
