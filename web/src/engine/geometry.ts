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

export function lerpDeg(from: number, to: number, t: number): number {
  const a = normalizeDeg(from);
  const b = normalizeDeg(to);
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeDeg(a + delta * clamp(t, 0, 1));
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

export type Circle = { x: number; y: number; r: number };

function circleFrom2(a: Vec, b: Vec): Circle {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    r: hypot(a.x - b.x, a.y - b.y) / 2,
  };
}

function circleFrom3(a: Vec, b: Vec, c: Vec): Circle {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) {
    const ab = hypot(a.x - b.x, a.y - b.y);
    const bc = hypot(b.x - c.x, b.y - c.y);
    const ca = hypot(c.x - a.x, c.y - a.y);
    if (ab >= bc && ab >= ca) return circleFrom2(a, b);
    if (bc >= ca) return circleFrom2(b, c);
    return circleFrom2(c, a);
  }
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: hypot(x - a.x, y - a.y) };
}

/** Smallest enclosing circle of a point set. Expected linear after shuffle. */
export function smallestEnclosingCircle(points: Vec[]): Circle | null {
  if (points.length === 0) return null;
  const p = [...points];
  for (let i = p.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  let c: Circle = { x: p[0].x, y: p[0].y, r: 0 };
  for (let i = 1; i < p.length; i += 1) {
    if (hypot(p[i].x - c.x, p[i].y - c.y) <= c.r + 1e-9) continue;
    c = { x: p[i].x, y: p[i].y, r: 0 };
    for (let j = 0; j < i; j += 1) {
      if (hypot(p[j].x - c.x, p[j].y - c.y) <= c.r + 1e-9) continue;
      c = circleFrom2(p[i], p[j]);
      for (let k = 0; k < j; k += 1) {
        if (hypot(p[k].x - c.x, p[k].y - c.y) <= c.r + 1e-9) continue;
        c = circleFrom3(p[i], p[j], p[k]);
      }
    }
  }
  return c;
}

export function localizationRegion(
  arenaRadius: number,
  bearings: Array<{ x: number; y: number; svdDeg: number }>,
): {
  polygon: Vec[];
  diameter: ReturnType<typeof polygonDiameter>;
  mec: Circle | null;
} {
  let polygon = regularDiskPolygon(arenaRadius);
  for (const bearing of bearings) {
    polygon = clipByBearingSector(polygon, bearing.x, bearing.y, bearing.svdDeg);
    if (polygon.length === 0) break;
  }
  return {
    polygon,
    diameter: polygonDiameter(polygon),
    mec: polygon.length >= 2 ? smallestEnclosingCircle(polygon) : null,
  };
}
