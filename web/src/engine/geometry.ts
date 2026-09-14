export const TAU = Math.PI * 2;

export function hypot(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** 0° = east, counterclockwise, range [0, 360). */
export function azimuthDeg(fromX: number, fromY: number, toX: number, toY: number): number {
  return normalizeDeg(radToDeg(Math.atan2(toY - fromY, toX - fromX)));
}

export function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function angularDiffDeg(a: number, b: number): number {
  const diff = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return Math.min(diff, 360 - diff);
}

export function roundDeg2(deg: number): number {
  return Math.round(normalizeDeg(deg) * 100) / 100;
}

export type Vec = { x: number; y: number };

export function inDisk(x: number, y: number, radius: number): boolean {
  return hypot(x, y) <= radius + 1e-9;
}

export function sampleInDisk(rng: () => number, radius: number): Vec {
  const r = radius * Math.sqrt(rng());
  const a = TAU * rng();
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

export function pointInDirectionalFan(
  sourceX: number,
  sourceY: number,
  headingDeg: number,
  pointX: number,
  pointY: number,
): boolean {
  const away = azimuthDeg(sourceX, sourceY, pointX, pointY);
  return angularDiffDeg(away, headingDeg) <= 90 + 1e-9;
}

type HalfPlane = {
  px: number;
  py: number;
  nx: number;
  ny: number;
};

function inside(p: Vec, plane: HalfPlane): boolean {
  return (p.x - plane.px) * plane.nx + (p.y - plane.py) * plane.ny >= -1e-9;
}

function intersect(a: Vec, b: Vec, plane: HalfPlane): Vec {
  const ad = (a.x - plane.px) * plane.nx + (a.y - plane.py) * plane.ny;
  const bd = (b.x - plane.px) * plane.nx + (b.y - plane.py) * plane.ny;
  const t = ad / (ad - bd);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clipPolygon(polygon: Vec[], plane: HalfPlane): Vec[] {
  if (polygon.length === 0) return [];
  const out: Vec[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const cur = polygon[i];
    const prev = polygon[(i + polygon.length - 1) % polygon.length];
    const curIn = inside(cur, plane);
    const prevIn = inside(prev, plane);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur, plane));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur, plane));
    }
  }
  return out;
}

export function regularDiskPolygon(radius: number, sides = 128): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (TAU * i) / sides;
    pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return pts;
}

/** ±1° closed sector from a detection point, 0° = east, CCW. */
export function clipByBearingSector(polygon: Vec[], sx: number, sy: number, svdDeg: number): Vec[] {
  const low = degToRad(svdDeg - 1);
  const high = degToRad(svdDeg + 1);
  const lowDir = { x: Math.cos(low), y: Math.sin(low) };
  const highDir = { x: Math.cos(high), y: Math.sin(high) };
  const lowPlane: HalfPlane = {
    px: sx,
    py: sy,
    nx: -lowDir.y,
    ny: lowDir.x,
  };
  const highPlane: HalfPlane = {
    px: sx,
    py: sy,
    nx: highDir.y,
    ny: -highDir.x,
  };
  return clipPolygon(clipPolygon(polygon, lowPlane), highPlane);
}

export function polygonDiameter(polygon: Vec[]): { maxDist: number; a: Vec; b: Vec } | null {
  if (polygon.length < 2) return null;
  let maxDist = 0;
  let a = polygon[0];
  let b = polygon[1];
  for (let i = 0; i < polygon.length; i += 1) {
    for (let j = i + 1; j < polygon.length; j += 1) {
      const d = hypot(polygon[i].x - polygon[j].x, polygon[i].y - polygon[j].y);
      if (d > maxDist) {
        maxDist = d;
        a = polygon[i];
        b = polygon[j];
      }
    }
  }
  return { maxDist, a, b };
}

export function localizationRegion(
  arenaRadius: number,
  bearings: Array<{ x: number; y: number; svdDeg: number }>,
): { polygon: Vec[]; diameter: ReturnType<typeof polygonDiameter> } {
  let polygon = regularDiskPolygon(arenaRadius);
  for (const bearing of bearings) {
    polygon = clipByBearingSector(polygon, bearing.x, bearing.y, bearing.svdDeg);
    if (polygon.length === 0) break;
  }
  return { polygon, diameter: polygonDiameter(polygon) };
}
