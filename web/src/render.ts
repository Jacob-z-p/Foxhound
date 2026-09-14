import { ARENA_RADIUS, CLEAR_RADIUS, NEAR_RADIUS, RECEIVE_MAX, RECEIVE_MIN } from "./engine/types";
import type { Observation, Source, World } from "./engine/types";
import { azimuthDeg, degToRad, hypot, localizationRegion } from "./engine/geometry";

export type Camera = {
  scale: number;
  cx: number;
  cy: number;
};

export type Aim = { x: number; y: number } | null;

const COLORS = {
  grid: "rgba(148, 163, 184, 0.16)",
  arena: "rgba(34, 211, 238, 0.85)",
  arenaFill: "rgba(34, 211, 238, 0.04)",
  robot: "#22c55e",
  path: "rgba(34, 197, 94, 0.55)",
  aim: "#f8fafc",
  source: "#fb7185",
  cleared: "#64748b",
  omni: "rgba(34, 211, 238, 0.18)",
  fan: "rgba(167, 139, 250, 0.22)",
  fanStroke: "rgba(167, 139, 250, 0.8)",
  sector: "rgba(245, 158, 11, 0.18)",
  sectorStroke: "rgba(245, 158, 11, 0.9)",
  ray: "#22d3ee",
  region: "rgba(251, 113, 133, 0.28)",
  regionStroke: "#fb7185",
  text: "#e2e8f0",
  muted: "#94a3b8",
};

export function worldFromEvent(
  canvas: HTMLCanvasElement,
  camera: Camera,
  event: PointerEvent,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  return screenToWorld(canvas, camera, px, py);
}

export function screenToWorld(
  canvas: HTMLCanvasElement,
  camera: Camera,
  px: number,
  py: number,
): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  const cx = canvas.width / (2 * dpr);
  const cy = canvas.height / (2 * dpr);
  return {
    x: camera.cx + (px - cx) / camera.scale,
    y: camera.cy - (py - cy) / camera.scale,
  };
}

export function worldToScreen(
  canvas: HTMLCanvasElement,
  camera: Camera,
  x: number,
  y: number,
): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  const cx = canvas.width / (2 * dpr);
  const cy = canvas.height / (2 * dpr);
  return {
    x: cx + (x - camera.cx) * camera.scale,
    y: cy - (y - camera.cy) * camera.scale,
  };
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camera: Camera,
  x: number,
  y: number,
  r: number,
) {
  const p = worldToScreen(canvas, camera, x, y);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * camera.scale, 0, Math.PI * 2);
}

function drawFan(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camera: Camera,
  source: Source,
) {
  if (source.headingDeg == null) return;
  const origin = worldToScreen(canvas, camera, source.x, source.y);
  const start = -degToRad(source.headingDeg + 90);
  const end = -degToRad(source.headingDeg - 90);
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.arc(origin.x, origin.y, source.radius * camera.scale, start, end, false);
  ctx.closePath();
}

function drawSector(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camera: Camera,
  obs: Observation,
  length: number,
) {
  if (obs.svdDeg == null) return;
  const origin = worldToScreen(canvas, camera, obs.x, obs.y);
  const start = -degToRad(obs.svdDeg + 1);
  const end = -degToRad(obs.svdDeg - 1);
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.arc(origin.x, origin.y, length * camera.scale, start, end, false);
  ctx.closePath();
}

export function fitCamera(canvas: HTMLCanvasElement): Camera {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const span = ARENA_RADIUS * 2.35;
  return {
    scale: Math.min(w, h) / span,
    cx: 0,
    cy: 0,
  };
}

export function renderMap(options: {
  canvas: HTMLCanvasElement;
  world: World;
  camera: Camera;
  aim: Aim;
  hover: Aim;
  opChannel: number;
  showTruth: boolean;
  showRegion: boolean;
}): void {
  const { canvas, world, camera, aim, hover, opChannel, showTruth, showRegion } = options;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let r = 500; r <= 2500; r += 500) {
    drawCircle(ctx, canvas, camera, 0, 0, r);
    ctx.stroke();
  }

  drawCircle(ctx, canvas, camera, 0, 0, ARENA_RADIUS);
  ctx.fillStyle = COLORS.arenaFill;
  ctx.fill();
  ctx.strokeStyle = COLORS.arena;
  ctx.lineWidth = 2;
  ctx.stroke();

  const origin = worldToScreen(canvas, camera, 0, 0);
  ctx.strokeStyle = "rgba(248, 250, 252, 0.35)";
  ctx.beginPath();
  ctx.moveTo(origin.x - 48, origin.y);
  ctx.lineTo(origin.x + 72, origin.y);
  ctx.moveTo(origin.x, origin.y - 72);
  ctx.lineTo(origin.x, origin.y + 48);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.font = "12px Fira Sans";
  ctx.fillText("E +x", origin.x + 76, origin.y + 4);
  ctx.fillText("N +y", origin.x + 6, origin.y - 76);

  if (showTruth) {
    for (const source of world.sources) {
      const p = worldToScreen(canvas, camera, source.x, source.y);
      const selected = source.channel === opChannel;
      if (selected) {
        if (source.kind === "omni") {
          drawCircle(ctx, canvas, camera, source.x, source.y, source.radius);
          ctx.strokeStyle = source.cleared ? "rgba(100,116,139,0.35)" : COLORS.omni;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = source.cleared ? "rgba(100,116,139,0.18)" : COLORS.fan;
          drawFan(ctx, canvas, camera, source);
          ctx.fill();
          ctx.strokeStyle = source.cleared ? COLORS.cleared : COLORS.fanStroke;
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, selected ? 7 : source.cleared ? 4 : 5, 0, Math.PI * 2);
      ctx.fillStyle = source.cleared ? COLORS.cleared : COLORS.source;
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = selected ? COLORS.text : COLORS.muted;
      ctx.font = selected ? "12px Fira Code" : "11px Fira Code";
      ctx.fillText(`C${source.channel}`, p.x + 8, p.y - 6);
    }
  }

  const channelObs = world.observations.filter((item) => item.channel === opChannel);
  for (const obs of channelObs) {
    if (obs.result !== "direction" || obs.svdDeg == null) continue;
    ctx.fillStyle = COLORS.sector;
    drawSector(ctx, canvas, camera, obs, RECEIVE_MAX);
    ctx.fill();
    ctx.strokeStyle = COLORS.sectorStroke;
    ctx.stroke();

    const originObs = worldToScreen(canvas, camera, obs.x, obs.y);
    const ray = worldToScreen(
      canvas,
      camera,
      obs.x + RECEIVE_MAX * Math.cos(degToRad(obs.svdDeg)),
      obs.y + RECEIVE_MAX * Math.sin(degToRad(obs.svdDeg)),
    );
    ctx.strokeStyle = COLORS.ray;
    ctx.beginPath();
    ctx.moveTo(originObs.x, originObs.y);
    ctx.lineTo(ray.x, ray.y);
    ctx.stroke();
  }

  if (showRegion) {
    const bearings = channelObs
      .filter((item) => item.result === "direction" && item.svdDeg != null)
      .map((item) => ({ x: item.x, y: item.y, svdDeg: item.svdDeg as number }));
    if (bearings.length >= 1) {
      const region = localizationRegion(ARENA_RADIUS, bearings);
      if (region.polygon.length >= 3) {
        ctx.beginPath();
        region.polygon.forEach((pt, i) => {
          const p = worldToScreen(canvas, camera, pt.x, pt.y);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = COLORS.region;
        ctx.fill();
        ctx.strokeStyle = COLORS.regionStroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (region.diameter) {
          const a = worldToScreen(canvas, camera, region.diameter.a.x, region.diameter.a.y);
          const b = worldToScreen(canvas, camera, region.diameter.b.x, region.diameter.b.y);
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  if (world.path.length > 1) {
    ctx.strokeStyle = COLORS.path;
    ctx.lineWidth = 2;
    ctx.beginPath();
    world.path.forEach((pt, i) => {
      const p = worldToScreen(canvas, camera, pt.x, pt.y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  const robot = worldToScreen(canvas, camera, world.robotX, world.robotY);
  drawCircle(ctx, canvas, camera, world.robotX, world.robotY, CLEAR_RADIUS);
  ctx.strokeStyle = "rgba(34,197,94,0.45)";
  ctx.stroke();
  drawCircle(ctx, canvas, camera, world.robotX, world.robotY, NEAR_RADIUS);
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(robot.x, robot.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.robot;
  ctx.fill();

  const mark = aim ?? hover;
  if (mark) {
    const p = worldToScreen(canvas, camera, mark.x, mark.y);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = COLORS.aim;
    ctx.beginPath();
    ctx.moveTo(robot.x, robot.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.stroke();
    const az = azimuthDeg(world.robotX, world.robotY, mark.x, mark.y);
    const dist = hypot(mark.x - world.robotX, mark.y - world.robotY);
    ctx.fillStyle = COLORS.text;
    ctx.font = "12px Fira Code";
    ctx.fillText(
      `(${mark.x.toFixed(1)}, ${mark.y.toFixed(1)})  ${dist.toFixed(1)} m  ${az.toFixed(1)}°`,
      p.x + 10,
      p.y - 10,
    );
  }

  for (const obs of world.observations) {
    const p = worldToScreen(canvas, camera, obs.x, obs.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = obs.channel === opChannel ? COLORS.ray : "rgba(148,163,184,0.7)";
    ctx.fill();
  }
}

export function receiveBandLabel(): string {
  return `${RECEIVE_MIN}–${RECEIVE_MAX} m`;
}
