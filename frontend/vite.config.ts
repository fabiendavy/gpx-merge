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

const usePolling = process.env.CHOKIDAR_USEPOLLING === "true";

export default defineConfig({
  plugins: [siteOriginPlugin()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
    watch: usePolling
      ? {
          usePolling: true,
          interval: Number(process.env.CHOKIDAR_INTERVAL ?? 300),
        }
      : undefined,
  },
  build: {
    outDir: "dist",
  },
});
