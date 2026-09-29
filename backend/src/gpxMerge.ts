import { XMLParser } from "fast-xml-parser";
import fs from "node:fs";

export interface MergeStats {
  totalFiles: number;
  totalPoints: number;
  mergedPoints: number;
  ignoredPoints: number;
}

export interface MergeResult {
  xml: string;
  stats: MergeStats;
}

interface MergedPoint {
  lat: number;
  lon: number;
  ele?: number;
  time: string;
  t: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  // Garmin/Strava traces store HR, cadence, etc. here — skip them to cut RAM.
  updateTag: (tagName) => {
    const local = tagName.includes(":")
      ? tagName.slice(tagName.indexOf(":") + 1)
      : tagName;
    if (
      local === "extensions" ||
      local === "metadata" ||
      local === "wpt" ||
      local === "rte" ||
      local === "bounds"
    ) {
      return false;
    }
    return tagName;
  },
});

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectFromTrkseg(trkseg: unknown, out: MergedPoint[]): number {
  if (!trkseg || typeof trkseg !== "object") return 0;
  const seg = trkseg as Record<string, unknown>;
  let total = 0;

  for (const pt of asList(seg["trkpt"])) {
    if (!pt || typeof pt !== "object") continue;
    const p = pt as Record<string, unknown>;
    const lat = p["@_lat"];
    const lon = p["@_lon"];
    if (lat === undefined || lon === undefined) continue;

    total += 1;

    const time = p["time"];
    if (time === undefined || time === null) continue;
    const timeStr = String(time);
    const t = Date.parse(timeStr);
    if (Number.isNaN(t)) continue;

    const point: MergedPoint = {
      lat: Number(lat),
      lon: Number(lon),
      time: timeStr,
      t,
    };

    const ele = p["ele"];
    if (ele !== undefined) point.ele = Number(ele);

    out.push(point);
  }

  return total;
}

function collectFromTrk(trk: unknown, out: MergedPoint[]): number {
  if (!trk || typeof trk !== "object") return 0;
  const t = trk as Record<string, unknown>;
  let total = 0;
  for (const seg of asList(t["trkseg"])) {
    total += collectFromTrkseg(seg, out);
  }
  return total;
}

function collectFromContent(content: string, out: MergedPoint[]): number {
  const parsed = parser.parse(content);
  const gpx = parsed["gpx"];
  if (!gpx || typeof gpx !== "object") return 0;

  const gpxObj = gpx as Record<string, unknown>;
  let total = 0;
  for (const trk of asList(gpxObj["trk"])) {
    total += collectFromTrk(trk, out);
  }
  return total;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function pointToXml(p: MergedPoint): string {
  const ele = p.ele !== undefined ? `<ele>${p.ele}</ele>` : "";
  return `<trkpt lat="${p.lat}" lon="${p.lon}">${ele}<time>${escapeXml(p.time)}</time></trkpt>`;
}

function buildMergedXml(points: MergedPoint[]): string {
  const parts = new Array<string>(points.length + 2);
  parts[0] =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" creator="gpx-merge" version="1.1">` +
    `<metadata><name>Merged activity</name><time>${new Date().toISOString()}</time></metadata>` +
    `<trk><name>Merged activity</name><trkseg>`;

  for (let i = 0; i < points.length; i++) {
    parts[i + 1] = pointToXml(points[i]);
  }

  parts[parts.length - 1] = `</trkseg></trk></gpx>\n`;
  return parts.join("");
}

function finalizeMerge(
  points: MergedPoint[],
  totalFiles: number,
  totalPoints: number
): MergeResult {
  points.sort((a, b) => a.t - b.t);

  return {
    xml: buildMergedXml(points),
    stats: {
      totalFiles,
      totalPoints,
      mergedPoints: points.length,
      ignoredPoints: totalPoints - points.length,
    },
  };
}

export function mergeGpxFiles(gpxContents: string[]): MergeResult {
  const points: MergedPoint[] = [];
  let totalPoints = 0;

  for (const content of gpxContents) {
    totalPoints += collectFromContent(content, points);
  }

  return finalizeMerge(points, gpxContents.length, totalPoints);
}

export function mergeGpxPaths(filePaths: string[]): MergeResult {
  const points: MergedPoint[] = [];
  let totalPoints = 0;

  for (const filePath of filePaths) {
    const content = fs.readFileSync(filePath, "utf-8");
    totalPoints += collectFromContent(content, points);
  }

  return finalizeMerge(points, filePaths.length, totalPoints);
}
