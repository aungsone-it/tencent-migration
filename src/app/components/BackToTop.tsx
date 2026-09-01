import { useState, useEffect, useLayoutEffect, type RefObject } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "./ui/button";

export type BackToTopProps = {
  /** When set, visibility and scroll target this element (e.g. vendor storefront `overflow-y-auto` root). */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  /** When the scroll root DOM node is replaced, bump this so listeners re-attach (stable ref object). */
  scrollContainerKey?: string | number;
  /** Lift above vendor mobile sticky purchase bar (product detail). */
  aboveStickyPurchaseBar?: boolean;
};

export function BackToTop({
  scrollContainerRef,
  scrollContainerKey,
  aboveStickyPurchaseBar = false,
}: BackToTopProps) {
  const [isVisible, setIsVisible] = useState(false);
  const useContainer = scrollContainerRef != null;

  useEffect(() => {
    if (useContainer) return;
    const toggleVisibility = () => {
      setIsVisible(window.pageYOffset > 300);
    };
    toggleVisibility();
    window.addEventListener("scroll", toggleVisibility);
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, [useContainer]);

  useLayoutEffect(() => {
    if (!useContainer || !scrollContainerRef) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const toggleVisibility = () => {
      setIsVisible(el.scrollTop > 300);
    };
    toggleVisibility();
    el.addEventListener("scroll", toggleVisibility, { passive: true });
    return () => el.removeEventListener("scroll", toggleVisibility);
  }, [useContainer, scrollContainerRef, scrollContainerKey]);

  const scrollToTop = () => {
    if (scrollContainerRef?.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <>
      {isVisible && (
        <Button
          onClick={scrollToTop}
          className={`back-to-top-fab ${
            aboveStickyPurchaseBar ? "back-to-top-fab--above-sticky" : ""
          } w-10 h-10 md:w-12 md:h-12 rounded-full border border-slate-200 bg-white text-slate-900 shadow-lg transition-all duration-300 hover:scale-110 hover:bg-slate-900 hover:text-white hover:border-slate-900 flex items-center justify-center p-1.5 animate-fade-in-right`}
          size="icon"
        >
          <ArrowUp className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2.5} />
        </Button>
      )}
    </>
  );
}
