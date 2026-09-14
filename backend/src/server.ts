import express from "express";
import multer from "multer";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { mergeGpxFiles, getMergeStats } from "./gpxMerge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.GPX_MERGE_DEV === "1";
const viteDevUrl = process.env.VITE_DEV_URL ?? "http://localhost:5173";

app.set("trust proxy", 1);
app.use(cors());

app.use("/api", (_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isGpx =
      file.mimetype === "application/gpx+xml" ||
      file.mimetype === "application/xml" ||
      file.mimetype === "text/xml" ||
      file.originalname.toLowerCase().endsWith(".gpx");
    if (isGpx) cb(null, true);
    else cb(new Error(`File "${file.originalname}" is not a .gpx file`));
  },
});

app.post(
  "/api/merge",
  upload.array("files", 20),
  (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length < 2) {
      return res
        .status(400)
        .json({ error: "Please upload at least 2 GPX files to merge" });
    }

    try {
      const contents = files.map((f) => f.buffer.toString("utf-8"));
      const stats = getMergeStats(contents);
      const merged = mergeGpxFiles(contents);

      if (stats.mergedPoints === 0) {
        return res.status(422).json({
          error:
            "No track points with <time> found in the uploaded files. All points were ignored.",
        });
      }

      res.setHeader("Content-Type", "application/gpx+xml");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="merged.gpx"'
      );
      res.setHeader("X-Merge-Stats", JSON.stringify(stats));
      return res.send(merged);
    } catch (err) {
      console.error("Merge error:", err);
      return res.status(500).json({ error: "Failed to merge GPX files" });
    }
  }
);

app.use(
  "/api/health",
  (_req, res) => res.json({ status: "ok" })
);

function resolveSiteOrigin(req: express.Request): string {
  const fromEnv = process.env.SITE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto =
    (typeof protoHeader === "string" ? protoHeader.split(",")[0] : undefined) ||
    req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function buildRobotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

function buildSitemapXml(origin: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${origin}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${origin}/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}/"/>
  </url>
</urlset>
`;
}

function applySiteOrigin(html: string, origin: string): string {
  return html.replaceAll("__SITE_ORIGIN__", origin);
}

app.get("/robots.txt", (req, res) => {
  res
    .type("text/plain")
    .set("Cache-Control", "public, max-age=3600")
    .send(buildRobotsTxt(resolveSiteOrigin(req)));
});

app.get("/sitemap.xml", (req, res) => {
  res
    .type("application/xml")
    .set("Cache-Control", "public, max-age=3600")
    .send(buildSitemapXml(resolveSiteOrigin(req)));
});

async function setupFrontend(): Promise<void> {
  if (isDev) {
    const { createProxyMiddleware } = await import("http-proxy-middleware");
    app.use(
      createProxyMiddleware({
        target: viteDevUrl,
        changeOrigin: true,
        ws: true,
      })
    );
    return;
  }

  const staticDir = path.resolve(__dirname, "../../frontend/dist");
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false }));
    app.get("*", (req, res) => {
      const indexPath = path.join(staticDir, "index.html");
      const html = fs.readFileSync(indexPath, "utf-8");
      res
        .type("html")
        .set("Cache-Control", "public, max-age=300")
        .send(applySiteOrigin(html, resolveSiteOrigin(req)));
    });
  }
}

async function main(): Promise<void> {
  await setupFrontend();

  app.listen(Number(PORT), () => {
    const mode = isDev ? "dev (live reload)" : "production";
    console.log(
      `gpx-merge server running on http://localhost:${PORT} [${mode}]`
    );
    if (isDev) {
      console.log(`Frontend proxied from ${viteDevUrl} — edit files to see changes instantly`);
    }
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
