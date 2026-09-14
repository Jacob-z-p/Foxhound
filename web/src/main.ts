import "./styles.css";
import { CHANNELS } from "./engine/types";
import type { ProblemKind, World } from "./engine/types";
import {
  clearTarget,
  createWorld,
  exitWorld,
  localizationForChannel,
  measure,
  previewClearCost,
  previewMeasureCost,
  stats,
  wouldClearHit,
} from "./engine/simulator";
import { hypot } from "./engine/geometry";
import { fitCamera, renderMap, screenToWorld, worldFromEvent, type Aim, type Camera } from "./render";

const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const problemEl = document.querySelector<HTMLSelectElement>("#problem")!;
const seedEl = document.querySelector<HTMLInputElement>("#seed")!;
const showTruthEl = document.querySelector<HTMLInputElement>("#show-truth")!;
const showRegionEl = document.querySelector<HTMLInputElement>("#show-region")!;
const channelsEl = document.querySelector<HTMLDivElement>("#channels")!;
const previewEl = document.querySelector<HTMLParagraphElement>("#preview")!;
const feedbackEl = document.querySelector<HTMLParagraphElement>("#feedback")!;
const logEl = document.querySelector<HTMLDivElement>("#log")!;
const opChannelEl = document.querySelector<HTMLSpanElement>("#op-channel")!;

let world: World = createWorld({ seed: 2026, problem: 3 });
let camera: Camera = { scale: 0.2, cx: 0, cy: 0 };
let aim: Aim = { x: 400, y: 0 };
let hover: Aim = null;
let opChannel = 1;
let dragging = false;
let dragStart: { x: number; y: number; cx: number; cy: number } | null = null;

function currentProblem(): ProblemKind {
  return Number(problemEl.value) === 4 ? 4 : 3;
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  camera = fitCamera(canvas);
  draw();
}

function formatCost(label: string, cost: ReturnType<typeof previewMeasureCost>): string {
  return [
    `${label}`,
    `移动 ${cost.moveM.toFixed(1)} m / ${cost.moveS.toFixed(3)} s`,
    cost.tuneS ? `换频 ${cost.tuneS.toFixed(0)} s` : "换频 0 s",
    `动作 ${cost.actionS.toFixed(0)} s`,
    `合计 ${cost.totalS.toFixed(3)} s`,
  ].join("\n");
}

function updatePreview(): void {
  if (!aim || world.exited) {
    previewEl.textContent = world.exited ? "本局已结束，可新开一局。" : "先在地图上点一个测点。";
    return;
  }
  const measureCost = previewMeasureCost(world, aim.x, aim.y, opChannel);
  const hit = wouldClearHit(world, aim.x, aim.y, opChannel);
  const clearCost = previewClearCost(world, aim.x, aim.y, hit);
  previewEl.textContent =
    `测点 (${aim.x.toFixed(1)}, ${aim.y.toFixed(1)})  操作频道 ${opChannel}\n` +
    `测向预估 ${measureCost.totalS.toFixed(3)} s · 清除预估 ${clearCost.totalS.toFixed(3)} s` +
    (showTruthEl.checked ? ` · 20 m 内${hit ? "可清除" : "无目标"}` : "");
}

function draw(): void {
  renderMap({
    canvas,
    world,
    camera,
    aim,
    hover,
    opChannel,
    showTruth: showTruthEl.checked,
    showRegion: showRegionEl.checked,
  });
  const s = stats(world);
  document.querySelector("#kpi-time")!.textContent = `${world.virtualTime.toFixed(3)} s`;
  document.querySelector("#kpi-clear")!.textContent = `${s.cleared} / ${s.total}`;
  document.querySelector("#kpi-avg")!.textContent =
    s.avgTime == null ? "—" : `${s.avgTime.toFixed(1)} s`;
  document.querySelector("#kpi-df")!.textContent = `CH ${world.dfChannel}`;
  opChannelEl.textContent = String(opChannel);
  logEl.textContent = [...world.log].reverse().join("\n");
  syncChannels();
  updatePreview();
}

function syncChannels(): void {
  const seen = new Set(
    world.observations.filter((o) => o.result !== "no_signal").map((o) => o.channel),
  );
  const cleared = new Set(world.sources.filter((s) => s.cleared).map((s) => s.channel));
  const live = new Set(world.sources.map((s) => s.channel));
  for (const btn of channelsEl.querySelectorAll<HTMLButtonElement>(".channel")) {
    const ch = Number(btn.dataset.channel);
    let state = "idle";
    if (cleared.has(ch)) state = "cleared";
    else if (ch === opChannel) state = "selected";
    else if (ch === world.dfChannel) state = "current";
    else if (seen.has(ch)) state = "seen";
    btn.dataset.state = state;
    btn.dataset.empty = showTruthEl.checked && !live.has(ch) ? "true" : "false";
    btn.setAttribute("aria-pressed", ch === opChannel ? "true" : "false");
  }
}

function setFeedback(kind: string, text: string): void {
  feedbackEl.dataset.kind = kind;
  feedbackEl.textContent = text;
}

function requireAim(): Aim {
  if (!aim) {
    setFeedback("no_signal", "还没有测点。请先单击地图。");
    return null;
  }
  if (world.exited) {
    setFeedback("no_signal", "本局已结束。");
    return null;
  }
  return aim;
}

function doMeasure(): void {
  const point = requireAim();
  if (!point) return;
  const result = measure(world, point.x, point.y, opChannel);
  const region = localizationForChannel(world, opChannel);
  const diameter =
    region?.diameter && region.polygon.length >= 3
      ? `交会直径 ${region.diameter.maxDist.toFixed(1)} m`
      : "交会区尚未形成多边形";
  if (result.result === "direction") {
    setFeedback(
      "direction",
      `direction  示向度 ${result.svdDeg?.toFixed(2)}°  （含 ±1° 地点误差）\n耗时 ${result.cost.totalS.toFixed(3)} s\n${diameter}`,
    );
  } else if (result.result === "near") {
    setFeedback(
      "near",
      `near  距离 ≤ 5 m，没有示向度。可直接 /clear。\n耗时 ${result.cost.totalS.toFixed(3)} s`,
    );
  } else {
    setFeedback(
      "no_signal",
      `no_signal  当前位置收不到频道 ${opChannel}。\n可能：无源 / 已清除 / 超半径 / 定向盲区\n耗时 ${result.cost.totalS.toFixed(3)} s`,
    );
  }
  draw();
}

function doClear(): void {
  const point = requireAim();
  if (!point) return;
  const dfBefore = world.dfChannel;
  const result = clearTarget(world, point.x, point.y, opChannel);
  if (result.result === "success") {
    const s = stats(world);
    setFeedback(
      "success",
      `success  频道 ${opChannel} 已清除。测向机仍为 ${dfBefore}。\n耗时 ${result.cost.totalS.toFixed(3)} s\n进度 ${s.cleared}/${s.total}${s.allCleared ? "  全部清除" : ""}`,
    );
  } else {
    setFeedback(
      "no_target_in_range",
      `no_target_in_range  20 m 内没有频道 ${opChannel} 的未清除源。\n耗时 ${result.cost.totalS.toFixed(3)} s  测向机仍为 ${dfBefore}`,
    );
  }
  draw();
}

function doMoveOnly(): void {
  const point = requireAim();
  if (!point) return;
  const d = hypot(point.x - world.robotX, point.y - world.robotY);
  if (d < 1e-6) {
    setFeedback("no_signal", "已经在测点上。移动没有独立指令，官方只能附在 /measure 或 /clear 上。");
    return;
  }
  setFeedback(
    "direction",
    `官方没有单独移动指令。当前测点距离 ${d.toFixed(1)} m，移动耗时 ${(d / 5).toFixed(3)} s，会算进下一次测向或清除。`,
  );
}

function newCase(): void {
  const seed = Number(seedEl.value) || Date.now() % 1_000_000;
  seedEl.value = String(seed);
  world = createWorld({ seed, problem: currentProblem() });
  aim = { x: 400, y: 0 };
  opChannel = 1;
  camera = fitCamera(canvas);
  setFeedback("", "新局已生成。单击地图选点，再测向或清除。");
  draw();
}

function buildChannels(): void {
  channelsEl.replaceChildren();
  for (let ch = 1; ch <= CHANNELS; ch += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "channel";
    btn.dataset.channel = String(ch);
    btn.textContent = String(ch);
    btn.addEventListener("click", () => {
      opChannel = ch;
      draw();
    });
    btn.addEventListener("dblclick", () => {
      const source = world.sources.find((item) => item.channel === ch);
      if (!showTruthEl.checked || !source) return;
      opChannel = ch;
      aim = { x: source.x, y: source.y };
      setFeedback(
        "near",
        `已瞄准频道 ${ch} 真值位置 (${source.x.toFixed(1)}, ${source.y.toFixed(1)})。\n演练模式快捷操作；正式测试没有这个信息。`,
      );
      draw();
    });
    channelsEl.append(btn);
  }
}

canvas.addEventListener("pointermove", (event) => {
  if (dragStart) {
    const moved = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
    if (moved > 6) dragging = true;
  }
  if (dragging && dragStart) {
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    camera.cx = dragStart.cx - dx / camera.scale;
    camera.cy = dragStart.cy + dy / camera.scale;
    draw();
    return;
  }
  hover = worldFromEvent(canvas, camera, event);
  canvas.title = `(${hover.x.toFixed(1)}, ${hover.y.toFixed(1)})`;
  if (!aim) draw();
});

canvas.addEventListener("pointerdown", (event) => {
  canvas.focus();
  if (event.button === 1 || event.button === 2 || event.shiftKey) {
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY, cx: camera.cx, cy: camera.cy };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  dragStart = { x: event.clientX, y: event.clientY, cx: camera.cx, cy: camera.cy };
});

canvas.addEventListener("pointerup", (event) => {
  if (dragging) {
    dragging = false;
    dragStart = null;
    return;
  }
  if (!dragStart) return;
  const moved = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
  dragStart = null;
  if (moved > 6) {
    dragging = false;
    return;
  }
  aim = worldFromEvent(canvas, camera, event);
  draw();
});

canvas.addEventListener("pointerleave", () => {
  hover = null;
  if (!dragging) draw();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const before = screenToWorld(canvas, camera, px, py);
  camera.scale = Math.min(1.6, Math.max(0.08, camera.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
  const after = screenToWorld(canvas, camera, px, py);
  camera.cx += before.x - after.x;
  camera.cy += before.y - after.y;
  draw();
}, { passive: false });

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    doMeasure();
  } else if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    doClear();
  } else if (event.key === "Enter") {
    event.preventDefault();
    doMeasure();
  } else if (/^[1-9]$/.test(event.key)) {
    opChannel = Number(event.key);
    draw();
  } else if (event.key === "0") {
    opChannel = 10;
    draw();
  }
});

document.querySelector("#btn-measure")!.addEventListener("click", doMeasure);
document.querySelector("#btn-clear")!.addEventListener("click", doClear);
document.querySelector("#btn-goto")!.addEventListener("click", doMoveOnly);
document.querySelector("#btn-exit")!.addEventListener("click", () => {
  exitWorld(world);
  setFeedback("no_signal", `user_exit  虚拟时间 ${world.virtualTime.toFixed(3)} s`);
  draw();
});
document.querySelector("#new-case")!.addEventListener("click", () => {
  seedEl.value = String((Number(seedEl.value) || 2026) + 1);
  newCase();
});
problemEl.addEventListener("change", newCase);
showTruthEl.addEventListener("change", draw);
showRegionEl.addEventListener("change", draw);
window.addEventListener("resize", resize);

buildChannels();
seedEl.value = "2026";
resize();
newCase();
