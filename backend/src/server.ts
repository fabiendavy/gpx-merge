import express from "express";
import multer from "multer";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { mergeGpxPaths } from "./gpxMerge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.GPX_MERGE_DEV === "1";
const viteDevUrl = process.env.VITE_DEV_URL ?? "http://localhost:5173";
const fileSizeLimit = 50 * 1024 * 1024;
const maxTotalBytes = 150 * 1024 * 1024;
const uploadDir = path.join(os.tmpdir(), "gpx-merge-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

function uploadedFiles(
  files: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined
): Express.Multer.File[] {
  return Array.isArray(files) ? files : [];
}

function cleanupUploads(files: Express.Multer.File[]): void {
  for (const file of files) {
    if (!file.path) continue;
    fs.unlink(file.path, (err) => {
      if (err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
        log("warn", "failed to delete upload", {
          path: file.path,
          error: err.message,
        });
      }
    });
  }
}

function log(
  level: "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>
): void {
  const line = extra
    ? `[${new Date().toISOString()}] ${level.toUpperCase()} ${message} ${JSON.stringify(extra)}`
    : `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

app.set("trust proxy", 1);
app.use(cors());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (req.path === "/api/health") return;
    log("info", `${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      ms: Date.now() - start,
      ip: req.ip,
    });
  });
  next();
});

app.use("/api", (_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, _file, cb) => {
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.gpx`);
    },
  }),
  limits: { fileSize: fileSizeLimit },
  fileFilter: (_req, file, cb) => {
    const isGpx =
      file.mimetype === "application/gpx+xml" ||
      file.mimetype === "application/xml" ||
      file.mimetype === "text/xml" ||
      file.originalname.toLowerCase().endsWith(".gpx");
    if (isGpx) {
      log("info", "accepted upload file", {
        name: file.originalname,
        mime: file.mimetype,
      });
      cb(null, true);
      return;
    }
    log("warn", "rejected upload file", {
      name: file.originalname,
      mime: file.mimetype,
    });
    cb(new Error(`File "${file.originalname}" is not a .gpx file`));
  },
});

app.post(
  "/api/merge",
  upload.array("files", 20),
  (req, res) => {
    const files = uploadedFiles(req.files);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      cleanupUploads(files);
    };
    res.once("finish", cleanup);
    res.once("close", cleanup);

    req.setTimeout(10 * 60 * 1000);
    res.setTimeout(10 * 60 * 1000);

    log("info", "merge request received", {
      fileCount: files.length,
      files: files.map((f) => ({
        name: f.originalname,
        bytes: f.size,
        mime: f.mimetype,
      })),
    });

    if (files.length < 2) {
      log("warn", "merge rejected: need at least 2 files", {
        fileCount: files.length,
      });
      return res
        .status(400)
        .json({ error: "Please upload at least 2 GPX files to merge" });
    }

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > maxTotalBytes) {
      log("warn", "merge rejected: total upload too large", { totalBytes });
      return res.status(413).json({
        error: "Uploaded files are too large. Maximum total size is 150 MB.",
      });
    }

    try {
      const { xml, stats } = mergeGpxPaths(files.map((f) => f.path));

      if (stats.mergedPoints === 0) {
        log("warn", "merge produced no timestamped points", { ...stats });
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
      log("info", "merge succeeded", {
        ...stats,
        outputBytes: Buffer.byteLength(xml),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      });
      return res.send(xml);
    } catch (err) {
      log("error", "merge failed", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
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
    log("info", "frontend proxy enabled", { target: viteDevUrl });
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
    log("info", "serving frontend static files", { staticDir });
    app.use(express.static(staticDir, { index: false }));
    app.get("*", (req, res) => {
      const indexPath = path.join(staticDir, "index.html");
      const html = fs.readFileSync(indexPath, "utf-8");
      res
        .type("html")
        .set("Cache-Control", "public, max-age=300")
        .send(applySiteOrigin(html, resolveSiteOrigin(req)));
    });
    return;
  }

  log("warn", "frontend dist not found; UI will not be served", { staticDir });
}

function registerErrorHandler(): void {
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }

      cleanupUploads(uploadedFiles(req.files));

      if (err instanceof multer.MulterError) {
        log("error", "upload error", {
          code: err.code,
          message: err.message,
          path: req.path,
        });
        res.status(400).json({ error: err.message });
        return;
      }

      if (err instanceof Error) {
        log("error", "request error", {
          message: err.message,
          path: req.path,
        });
        res.status(400).json({ error: err.message });
        return;
      }

      log("error", "unknown request error", { path: req.path });
      res.status(500).json({ error: "Internal server error" });
    }
  );
}

async function main(): Promise<void> {
  const staticDir = path.resolve(__dirname, "../../frontend/dist");
  log("info", "starting gpx-merge", {
    port: PORT,
    mode: isDev ? "dev" : "production",
    nodeEnv: process.env.NODE_ENV ?? "",
    siteUrl: process.env.SITE_URL ?? "",
    frontendDistExists: fs.existsSync(staticDir),
  });

  await setupFrontend();
  registerErrorHandler();

  const server = app.listen(Number(PORT), "0.0.0.0", () => {
    const addr = server.address();
    log("info", "server listening", {
      address: addr && typeof addr === "object" ? `${addr.address}:${addr.port}` : String(addr),
    });
    if (isDev) {
      log("info", "edit files to see changes instantly", { viteDevUrl });
    }
  });
  server.timeout = 10 * 60 * 1000;
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 10 * 60 * 1000 + 1000;

  server.on("error", (err) => {
    log("error", "server listen error", {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });
}

main().catch((err) => {
  log("error", "failed to start server", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
