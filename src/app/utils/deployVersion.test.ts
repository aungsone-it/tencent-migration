import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEPLOY_VERSION_LS_KEY,
  applyDeployUpdateIfNeeded,
  purgeDeployClientCaches,
  readStoredDeployVersion,
} from "./deployVersion";

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("deployVersion", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("sessionStorage", createStorage());
    vi.stubGlobal("window", {
      location: {
        href: "https://nexa-mm.com/admin",
        replace: vi.fn(),
      },
    });
    vi.restoreAllMocks();
  });

  it("stores first deploy version without reloading", async () => {
    const reloaded = await applyDeployUpdateIfNeeded("20260721150000");
    expect(reloaded).toBe(false);
    expect(readStoredDeployVersion()).toBe("20260721150000");
  });

  it("purges caches and reloads when deploy version changes", async () => {
    localStorage.setItem(DEPLOY_VERSION_LS_KEY, "20260721140000");
    const reloadSpy = vi.spyOn(window.location, "replace").mockImplementation(() => {});

    const reloaded = await applyDeployUpdateIfNeeded("20260721150000");
    expect(reloaded).toBe(true);
    expect(reloadSpy).toHaveBeenCalled();
    expect(readStoredDeployVersion()).toBe("20260721150000");
  });

  it("purgeDeployClientCaches removes catalog keys but keeps auth user", () => {
    localStorage.setItem("migoo-user", '{"id":"u1"}');
    localStorage.setItem("migoo-ls-landing-vendors-v1", '{"v":1}');
    localStorage.setItem("migoo_cache_products", '{"data":[],"timestamp":1,"version":"1.0.0"}');

    purgeDeployClientCaches();

    expect(localStorage.getItem("migoo-user")).toBe('{"id":"u1"}');
    expect(localStorage.getItem("migoo-ls-landing-vendors-v1")).toBeNull();
    expect(localStorage.getItem("migoo_cache_products")).toBeNull();
  });
});
