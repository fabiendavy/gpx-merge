import { XMLParser, XMLBuilder } from "fast-xml-parser";

interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  indentBy: "  ",
  suppressEmptyNode: true,
});

function extractPointsFromTrkseg(trkseg: unknown): GpxPoint[] {
  if (!trkseg || typeof trkseg !== "object") return [];
  const seg = trkseg as Record<string, unknown>;
  const trkpts = seg["trkpt"];
  if (!trkpts) return [];

  const points = Array.isArray(trkpts) ? trkpts : [trkpts];
  const result: GpxPoint[] = [];

  for (const pt of points) {
    if (!pt || typeof pt !== "object") continue;
    const p = pt as Record<string, unknown>;
    const attrs = p["@_lat"];
    const attrsLon = p["@_lon"];
    if (attrs === undefined || attrsLon === undefined) continue;

    const point: GpxPoint = { lat: Number(attrs), lon: Number(attrsLon) };

    const ele = p["ele"];
    if (ele !== undefined) point.ele = Number(ele);

    const time = p["time"];
    if (time !== undefined && time !== null) point.time = String(time);

    result.push(point);
  }

  return result;
}

function extractPointsFromTrk(trk: unknown): GpxPoint[] {
  if (!trk || typeof trk !== "object") return [];
  const t = trk as Record<string, unknown>;
  const trksegs = t["trkseg"];
  if (!trksegs) return [];

  const segs = Array.isArray(trksegs) ? trksegs : [trksegs];
  return segs.flatMap(extractPointsFromTrkseg);
}

export function mergeGpxFiles(gpxContents: string[]): string {
  const allPoints: GpxPoint[] = [];

  for (const content of gpxContents) {
    const parsed = parser.parse(content);
    const gpx = parsed["gpx"];
    if (!gpx || typeof gpx !== "object") continue;

    const gpxObj = gpx as Record<string, unknown>;
    const trks = gpxObj["trk"];
    if (!trks) continue;

    const trkList = Array.isArray(trks) ? trks : [trks];
    for (const trk of trkList) {
      allPoints.push(...extractPointsFromTrk(trk));
    }
  }

  const pointsWithTime = allPoints.filter((p) => p.time !== undefined);
  pointsWithTime.sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return ta - tb;
  });

  const trkptsXml = pointsWithTime.map((p) => {
    const node: Record<string, unknown> = {
      "@_lat": p.lat,
      "@_lon": p.lon,
    };
    if (p.ele !== undefined) node["ele"] = p.ele;
    if (p.time) node["time"] = p.time;
    return node;
  });

  const output = {
    gpx: {
      "@_xmlns": "http://www.topografix.com/GPX/1/1",
      "@_creator": "gpx-merge",
      "@_version": "1.1",
      metadata: {
        name: "Merged activity",
        time: new Date().toISOString(),
      },
      trk: {
        name: "Merged activity",
        trkseg: {
          trkpt: trkptsXml,
        },
      },
    },
  };

  const xml = builder.build(output);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

export function getMergeStats(gpxContents: string[]): {
  totalFiles: number;
  totalPoints: number;
  mergedPoints: number;
  ignoredPoints: number;
} {
  let totalPoints = 0;
  let mergedPoints = 0;

  for (const content of gpxContents) {
    const parsed = parser.parse(content);
    const gpx = parsed["gpx"];
    if (!gpx || typeof gpx !== "object") continue;

    const gpxObj = gpx as Record<string, unknown>;
    const trks = gpxObj["trk"];
    if (!trks) continue;

    const trkList = Array.isArray(trks) ? trks : [trks];
    for (const trk of trkList) {
      const points = extractPointsFromTrk(trk);
      totalPoints += points.length;
      mergedPoints += points.filter((p) => p.time !== undefined).length;
    }
  }

  return {
    totalFiles: gpxContents.length,
    totalPoints,
    mergedPoints,
    ignoredPoints: totalPoints - mergedPoints,
  };
}
