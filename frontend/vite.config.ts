import { defineConfig, type Plugin } from "vite";

const DEV_ORIGIN = "http://localhost:5173";

function siteOriginPlugin(): Plugin {
  return {
    name: "site-origin",
    apply: "serve",
    transformIndexHtml(html) {
      const origin = (process.env.SITE_URL ?? DEV_ORIGIN).replace(/\/$/, "");
      return html.replaceAll("__SITE_ORIGIN__", origin);
    },
  };
}

export default defineConfig({
  plugins: [siteOriginPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
