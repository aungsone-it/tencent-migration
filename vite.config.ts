import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Vite Configuration - Last updated: 20260307181500
// Custom plugin to handle figma:asset imports in production
const figmaAssetPlugin = () => ({
  name: 'figma-asset-resolver',
  resolveId(id: string) {
    if (id.startsWith('figma:asset')) {
      return id;
    }
  },
  load(id: string) {
    if (id.startsWith('figma:asset')) {
      // Return a placeholder data URL for production builds
      return `export default "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4="`;
    }
  }
});

const inlinePublicHeadScriptsPlugin = () => ({
  name: 'inline-public-head-scripts',
  transformIndexHtml(html: string) {
    const publicScripts = ['platform-branding-head.js', 'vendor-storefront-head.js'];
    let next = html;

    for (const filename of publicScripts) {
      const scriptPath = path.resolve(__dirname, 'public', filename);
      if (!fs.existsSync(scriptPath)) continue;
      const source = fs.readFileSync(scriptPath, 'utf8');
      const escaped = source.replace(/<\/script/gi, '<\\/script');
      next = next.replace(
        new RegExp(`<script\\s+src="/${filename}"(?:\\s+defer)?><\\/script>`),
        `<script data-inline-public="${filename}">\n${escaped}\n</script>`
      );
    }

    return next;
  },
});

/** Injects CloudBase runtime config for pre-React head scripts on EdgeOne/static hosts. */
const injectCloudBaseRuntimeConfigPlugin = () => ({
  name: 'inject-cloudbase-runtime-config',
  transformIndexHtml(html: string) {
    const env = process.env;
    const payload = {
      NEXA_CLOUDBASE_API_BASE_URL: String(env.VITE_CLOUDBASE_API_BASE_URL || '').trim(),
      NEXA_CLOUDBASE_PUBLISHABLE_KEY: String(env.VITE_CLOUDBASE_PUBLISHABLE_KEY || '').trim(),
      NEXA_CLOUDBASE_ENV_ID: String(env.VITE_CLOUDBASE_ENV_ID || '').trim(),
      NEXA_CLOUDBASE_REGION: String(env.VITE_CLOUDBASE_REGION || '').trim(),
    };
    const script = `<script>window.NEXA_CLOUDBASE_API_BASE_URL=${JSON.stringify(payload.NEXA_CLOUDBASE_API_BASE_URL)};window.NEXA_CLOUDBASE_PUBLISHABLE_KEY=${JSON.stringify(payload.NEXA_CLOUDBASE_PUBLISHABLE_KEY)};window.NEXA_CLOUDBASE_ENV_ID=${JSON.stringify(payload.NEXA_CLOUDBASE_ENV_ID)};window.NEXA_CLOUDBASE_REGION=${JSON.stringify(payload.NEXA_CLOUDBASE_REGION)};</script>`;
    return html.replace('<head>', `<head>\n    ${script}`);
  },
});

function generateDeployBuildId(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

function buildDeployBootstrapScript(buildId: string): string {
  return `<script data-deploy-bootstrap="1">
(function () {
  var BUILD_ID = ${JSON.stringify(buildId)};
  var VERSION_KEY = "migoo-deploy-version";
  var RELOAD_GUARD = "migoo-deploy-reload-guard";
  var CACHE_PREFIXES = ["migoo-ls-", "migoo_cache_", "migoo-notifications", "migoo-checkout", "migoo-shipping-addresses-", "vendor_storefront_", "vendorAuth"];
  function purgeCaches() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        if (key.indexOf("nexa-cloudbase") === 0) continue;
        if (key === "migoo-user" || key === "migoo-staff-actor-id") continue;
        if (key.indexOf("migoo-") === 0) keys.push(key);
        for (var p = 0; p < CACHE_PREFIXES.length; p++) {
          if (key.indexOf(CACHE_PREFIXES[p]) === 0) keys.push(key);
        }
      }
      for (var j = 0; j < keys.length; j++) localStorage.removeItem(keys[j]);
      var keep = { kpay_pwa_pending_order: 1, kpay_summary_storefront_origin: 1 };
      var sessionKeys = [];
      for (var s = 0; s < sessionStorage.length; s++) {
        var sessionKey = sessionStorage.key(s);
        if (!sessionKey || keep[sessionKey] || sessionKey.indexOf("nexa-cloudbase") === 0) continue;
        sessionKeys.push(sessionKey);
      }
      for (var t = 0; t < sessionKeys.length; t++) sessionStorage.removeItem(sessionKeys[t]);
    } catch (e) {}
  }
  function reloadNow() {
    try { sessionStorage.setItem(RELOAD_GUARD, BUILD_ID); } catch (e) {}
    var url = new URL(window.location.href);
    url.searchParams.set("_dv", BUILD_ID);
    window.location.replace(url.toString());
  }
  try {
    var previous = localStorage.getItem(VERSION_KEY);
    if (!previous) {
      localStorage.setItem(VERSION_KEY, BUILD_ID);
      sessionStorage.removeItem(RELOAD_GUARD);
      return;
    }
    if (previous === BUILD_ID) {
      sessionStorage.removeItem(RELOAD_GUARD);
      return;
    }
    if (sessionStorage.getItem(RELOAD_GUARD) === BUILD_ID) {
      localStorage.setItem(VERSION_KEY, BUILD_ID);
      sessionStorage.removeItem(RELOAD_GUARD);
      return;
    }
    purgeCaches();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (reg) { reg.unregister(); });
      });
    }
    if ("caches" in window) {
      caches.keys().then(function (names) {
        names.forEach(function (name) { caches.delete(name); });
      });
    }
    localStorage.setItem(VERSION_KEY, BUILD_ID);
    reloadNow();
  } catch (e) {}
})();
</script>`;
}

/** Writes /version.json and injects a pre-app cache purge when a new build ships. */
const deployVersionPlugin = (mode: string, buildId: string) => ({
  name: 'deploy-version',
  buildStart() {
    if (mode !== 'production') return;
    const versionFile = path.resolve(__dirname, 'public/version.json');
    fs.writeFileSync(
      versionFile,
      `${JSON.stringify({ buildId, builtAt: new Date().toISOString() }, null, 2)}\n`,
    );
  },
  transformIndexHtml(html: string) {
    if (mode !== 'production') return html;
    const script = buildDeployBootstrapScript(buildId);
    return html.replace('</head>', `    ${script}\n  </head>`);
  },
});

export default defineConfig(({ mode }) => {
  const buildId = mode === 'development' ? 'dev' : generateDeployBuildId();
  return {
  // Do not use `define` for import.meta.env.VITE_* — it overrides Vite's env injection
  // and can embed wrong values on Vercel (breaking vendor subdomains like gogo.walwal.online).
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    figmaAssetPlugin(),
    inlinePublicHeadScriptsPlugin(),
    injectCloudBaseRuntimeConfigPlugin(),
    deployVersionPlugin(mode, buildId),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Explicitly disable PostCSS processing since @tailwindcss/vite handles it
  css: {
    postcss: null,
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // Build configuration - keep it simple for Figma Make
  build: {
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Tiny shared utilities must stay out of optional heavy chunks. If `clsx`
          // is captured by the Recharts chunk, Vite modulepreloads all charts on
          // every storefront visit just to satisfy class-name helpers.
          if (
            id.includes('/clsx/') ||
            id.includes('/class-variance-authority/') ||
            id.includes('/tailwind-merge/')
          ) {
            return 'ui-utils';
          }
          // Core React — stable caching across route chunks
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react-vendor';
          }
          if (id.includes('react-router')) return 'router';
          // Heavy optional UI (admin / editors)
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui';
          if (id.includes('recharts')) return 'charts';
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor';
          if (id.includes('emoji-picker-react')) return 'emoji-picker';
          if (id.includes('react-quill')) return 'react-quill';
        },
      },
    },
  },
};
})