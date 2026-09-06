import { describe, expect, it } from "vitest";
import { compactVendorKey, vendorSlugLookupCandidates } from "../../../supabase/functions/make-server-16010b6f/vendor_id_resolve";

describe("vendorSlugLookupCandidates", () => {
  it("covers hyphen, compact, and store-name forms", () => {
    expect(vendorSlugLookupCandidates("go-go")).toEqual(["go-go", "gogo"]);
    expect(vendorSlugLookupCandidates("go go")).toEqual(["go go", "go-go", "gogo"]);
    expect(vendorSlugLookupCandidates("gogo")).toEqual(["gogo"]);
  });
});

describe("compactVendorKey", () => {
  it("treats slug variants as the same vendor key", () => {
    expect(compactVendorKey("go-go")).toBe("gogo");
    expect(compactVendorKey("Go Go")).toBe("gogo");
    expect(compactVendorKey("gogo")).toBe("gogo");
  });
});
