import { ARENA_RADIUS, CLEAR_RADIUS, NEAR_RADIUS, RECEIVE_MAX, RECEIVE_MIN } from "./engine/types";
import type { Observation, Source, World } from "./engine/types";
import { clamp, degToRad, hypot, localizationRegion, TAU } from "./engine/geometry";

export type Camera = {
  scale: number;
  cx: number;
  cy: number;
};

function canvasBox(canvas: HTMLCanvasElement): { w: number; h: number } {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.width / (window.devicePixelRatio || 1);
  const h = rect.height || canvas.height / (window.devicePixelRatio || 1);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

export type Aim = { x: number; y: number } | null;

export type RobotView = {
  x: number;
  y: number;
  headingDeg: number;
  gait: number;
  walking: boolean;
};

export type FxState = {
  time: number;
  introT: number;
  outroT: number;
};

const COLORS = {
  grid: "rgba(148, 163, 184, 0.09)",
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
  region: "rgba(251, 113, 133, 0.22)",
  regionStroke: "#fb7185",
  mec: "rgba(250, 250, 250, 0.92)",
  ready: "#3b82f6",
  receive: "rgba(34, 211, 238, 0.9)",
  clear: "rgba(34, 197, 94, 0.95)",
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
  const { w, h } = canvasBox(canvas);
  return {
    x: camera.cx + (px - w / 2) / camera.scale,
    y: camera.cy - (py - h / 2) / camera.scale,
  };
}

export function worldToScreen(
  canvas: HTMLCanvasElement,
  camera: Camera,
  x: number,
  y: number,
): { x: number; y: number } {
  const { w, h } = canvasBox(canvas);
  return {
    x: w / 2 + (x - camera.cx) * camera.scale,
    y: h / 2 - (y - camera.cy) * camera.scale,
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
  ctx.arc(p.x, p.y, Math.max(0.5, r * camera.scale), 0, Math.PI * 2);
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

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawRobotDog(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  headingDeg: number,
  gait: number,
  walking: boolean,
  size: number,
) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-degToRad(headingDeg));
  const s = size;

  ctx.fillStyle = "rgba(2, 6, 23, 0.4)";
  ctx.beginPath();
  ctx.ellipse(0, s * 0.08, s * 0.36, s * 0.14, 0, 0, TAU);
  ctx.fill();

  const hips = [
    { x: s * 0.24, y: -s * 0.2, phase: 0 },
    { x: s * 0.24, y: s * 0.2, phase: Math.PI },
    { x: -s * 0.26, y: -s * 0.2, phase: Math.PI },
    { x: -s * 0.26, y: s * 0.2, phase: 0 },
  ];
  for (const hip of hips) {
    const cycle = walking ? gait * TAU : 0;
    const stride = walking ? Math.sin(cycle + hip.phase) * s * 0.11 : 0;
    const planted = walking ? 0.62 + 0.38 * Math.max(0, -Math.cos(cycle + hip.phase)) : 1;
    const fx = hip.x + stride;
    const fy = hip.y;
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = Math.max(1.8, s * 0.055);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hip.x * 0.42, hip.y * 0.28);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = planted > 0.78 ? "#166534" : "#86efac";
    ctx.beginPath();
    ctx.ellipse(fx, fy, s * 0.08 * (0.75 + 0.25 * planted), s * 0.055, 0, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = "#15803d";
  roundRectPath(ctx, -s * 0.4, -s * 0.16, s * 0.62, s * 0.32, s * 0.08);
  ctx.fill();
  ctx.fillStyle = COLORS.robot;
  roundRectPath(ctx, -s * 0.36, -s * 0.12, s * 0.54, s * 0.24, s * 0.07);
  ctx.fill();

  ctx.fillStyle = "#4ade80";
  roundRectPath(ctx, s * 0.12, -s * 0.13, s * 0.3, s * 0.26, s * 0.07);
  ctx.fill();
  ctx.fillStyle = "#022c22";
  roundRectPath(ctx, s * 0.22, -s * 0.07, s * 0.16, s * 0.14, 3);
  ctx.fill();
  ctx.fillStyle = walking ? "#67e8f9" : "#22d3ee";
  ctx.beginPath();
  ctx.arc(s * 0.32, 0, Math.max(1.6, s * 0.035), 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function fitCamera(canvas: HTMLCanvasElement): Camera {
  const { w, h } = canvasBox(canvas);
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
  robot: RobotView;
  fx: FxState;
  readyChannels: Set<number>;
}): void {
  const { canvas, world, camera, aim, hover, opChannel, showTruth, showRegion, robot, fx, readyChannels } = options;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const view = canvasBox(canvas);
  const sx = canvas.width / view.w;
  const sy = canvas.height / view.h;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);

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

  if (fx.introT > 0 && fx.introT < 1) {
    for (let i = 0; i < 4; i += 1) {
      const t = (fx.introT + i * 0.18) % 1;
      ctx.strokeStyle = `rgba(34, 211, 238, ${0.55 * (1 - t)})`;
      ctx.lineWidth = 2;
      drawCircle(ctx, canvas, camera, 0, 0, 80 + t * ARENA_RADIUS);
      ctx.stroke();
    }
  }

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
    const labels: { x: number; y: number; w: number; h: number }[] = [];
    const sourcePoints = world.sources.map(source => worldToScreen(canvas, camera, source.x, source.y));
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
      ctx.fillStyle = source.cleared
        ? COLORS.cleared
        : readyChannels.has(source.channel)
          ? COLORS.ready
          : COLORS.source;
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = selected ? COLORS.text : COLORS.muted;
      ctx.font = selected ? "12px Fira Code" : "11px Fira Code";
      const text = `C${source.channel}`;
      const w = ctx.measureText(text).width + 6;
      const candidates = [[10, -18], [10, 8], [-w - 10, -18], [-w - 10, 8], [10, -34], [10, 24]];
      const offset = candidates.find(([dx, dy]) => {
        const box = { x: p.x + dx, y: p.y + dy, w, h: 15 };
        return box.x >= 0 && box.y >= 0 && box.x + w <= view.w && box.y + 15 <= view.h &&
          !labels.some(b => box.x < b.x + b.w && box.x + w > b.x && box.y < b.y + b.h && box.y + 15 > b.y) &&
          !sourcePoints.some(q => q.x > box.x - 5 && q.x < box.x + w + 5 && q.y > box.y - 5 && q.y < box.y + 20);
      }) ?? candidates[0];
      const box = { x: p.x + offset[0], y: p.y + offset[1], w, h: 15 };
      labels.push(box);
      ctx.fillText(text, box.x + 3, box.y + 12);
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
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = "rgba(251, 113, 133, 0.28)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (region.mec && region.mec.r > 1) {
          const mec = region.mec;
          const ready = mec.r <= CLEAR_RADIUS + 1e-9;
          const mecColor = ready ? COLORS.ready : COLORS.mec;
          ctx.setLineDash([7, 5]);
          ctx.strokeStyle = mecColor;
          ctx.lineWidth = 2;
          drawCircle(ctx, canvas, camera, mec.x, mec.y, mec.r);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = ready ? "rgba(59, 130, 246, 0.12)" : "rgba(248, 250, 252, 0.08)";
          drawCircle(ctx, canvas, camera, mec.x, mec.y, mec.r);
          ctx.fill();
          const c = worldToScreen(canvas, camera, mec.x, mec.y);
          ctx.strokeStyle = mecColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(c.x - 6, c.y);
          ctx.lineTo(c.x + 6, c.y);
          ctx.moveTo(c.x, c.y - 6);
          ctx.lineTo(c.x, c.y + 6);
          ctx.stroke();
        }
      }
    }
  }

  if (world.path.length > 0) {
    ctx.strokeStyle = COLORS.path;
    ctx.lineWidth = 2;
    ctx.beginPath();
    world.path.forEach((pt, i) => {
      const p = worldToScreen(canvas, camera, pt.x, pt.y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    const last = world.path[world.path.length - 1];
    if (hypot(robot.x - last.x, robot.y - last.y) > 0.4) {
      const p = worldToScreen(canvas, camera, robot.x, robot.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(34, 211, 238, 0.06)";
  drawCircle(ctx, canvas, camera, robot.x, robot.y, RECEIVE_MIN);
  ctx.fill();
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -fx.time * 0.04;
  ctx.strokeStyle = COLORS.receive;
  ctx.lineWidth = 2;
  drawCircle(ctx, canvas, camera, robot.x, robot.y, RECEIVE_MIN);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  drawCircle(ctx, canvas, camera, robot.x, robot.y, NEAR_RADIUS);
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const mark = aim ?? hover;
  if (aim) {
    ctx.fillStyle = "rgba(34, 197, 94, 0.16)";
    drawCircle(ctx, canvas, camera, aim.x, aim.y, CLEAR_RADIUS);
    ctx.fill();
    ctx.strokeStyle = COLORS.clear;
    ctx.lineWidth = 2;
    drawCircle(ctx, canvas, camera, aim.x, aim.y, CLEAR_RADIUS);
    ctx.stroke();
    const px = CLEAR_RADIUS * camera.scale;
    if (px < 10) {
      const p = worldToScreen(canvas, camera, aim.x, aim.y);
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (hover) {
    ctx.strokeStyle = "rgba(34, 197, 94, 0.45)";
    ctx.setLineDash([4, 3]);
    drawCircle(ctx, canvas, camera, hover.x, hover.y, CLEAR_RADIUS);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const robotScreen = worldToScreen(canvas, camera, robot.x, robot.y);
  if (mark) {
    const p = worldToScreen(canvas, camera, mark.x, mark.y);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = COLORS.aim;
    ctx.beginPath();
    ctx.moveTo(robotScreen.x, robotScreen.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  const dogPx = clamp(camera.scale * 120, 18, 30);
  drawRobotDog(ctx, robotScreen.x, robotScreen.y, robot.headingDeg, robot.gait, robot.walking, dogPx);

  for (const obs of channelObs) {
    const p = worldToScreen(canvas, camera, obs.x, obs.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ray;
    ctx.fill();
  }

  if (fx.outroT > 0) {
    ctx.fillStyle = `rgba(2, 6, 23, ${0.18 * fx.outroT})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

export function receiveBandLabel(): string {
  return `${RECEIVE_MIN}–${RECEIVE_MAX} m`;
}
