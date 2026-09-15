import "./styles.css";
import { CHANNELS, CLEAR_RADIUS, COORD_ABS_MAX } from "./engine/types";
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
import { azimuthDeg, clamp, hypot, lerpDeg } from "./engine/geometry";
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
const cinematicEl = document.querySelector<HTMLDivElement>("#cinematic")!;
const cinematicTitleEl = document.querySelector<HTMLHeadingElement>("#cinematic-title")!;
const cinematicSubEl = document.querySelector<HTMLParagraphElement>("#cinematic-sub")!;
const cinematicKickerEl = document.querySelector<HTMLParagraphElement>("#cinematic-kicker")!;
const aimXEl = document.querySelector<HTMLInputElement>("#aim-x")!;
const aimYEl = document.querySelector<HTMLInputElement>("#aim-y")!;
const aimLiveEl = document.querySelector<HTMLParagraphElement>("#aim-live")!;
const hudAimEl = document.querySelector<HTMLElement>("#hud-aim")!;
const hudAimMetaEl = document.querySelector<HTMLParagraphElement>("#hud-aim-meta")!;
const hudRegionEl = document.querySelector<HTMLElement>("#hud-region")!;
const hudRegionChEl = document.querySelector<HTMLElement>("#hud-region-ch")!;
const hudRegionMetaEl = document.querySelector<HTMLParagraphElement>("#hud-region-meta")!;
const kpiClearLabelEl = document.querySelector<HTMLSpanElement>("#kpi-clear-label")!;
const mapHintEl = document.querySelector<HTMLDivElement>("#map-hint")!;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const actionButtons = [
  document.querySelector<HTMLButtonElement>("#btn-measure")!,
  document.querySelector<HTMLButtonElement>("#btn-clear")!,
  document.querySelector<HTMLButtonElement>("#btn-goto")!,
  document.querySelector<HTMLButtonElement>("#btn-exit")!,
];

let world: World = createWorld({ seed: 2026, problem: 3 });
let camera: Camera = { scale: 0.2, cx: 0, cy: 0 };
let aim: Aim = { x: 400, y: 0 };
let hover: Aim = null;
let opChannel = 1;
let dragging = false;
let dragStart: { x: number; y: number; cx: number; cy: number } | null = null;

let displayX = 0;
let displayY = 0;
let headingDeg = 0;
let gait = 0;
let lastFrame = 0;
let introT = 0;
let outroT = 0;
let cinematicMode: "none" | "intro" | "outro" = "none";
let cinematicStartedAt = 0;
let cinematicHoldMs = 0;

type WalkState = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t0: number;
  dur: number;
  onDone: () => void;
};

let walk: WalkState | null = null;
const readyChannels = new Set<number>();
let readyCacheKey = "";
let lastJournalKey = "";

function truthOn(): boolean {
  return showTruthEl.checked;
}

function progressLabel(cleared: number, total: number, allCleared = false): string {
  if (truthOn()) {
    return `进度 ${cleared}/${total}${allCleared ? "  全部清除" : ""}`;
  }
  return allCleared ? `已清除 ${cleared} 个，任务完成` : `已清除 ${cleared} 个`;
}

function updateHud(): void {
  const point = aim ?? hover;
  if (point) {
    const dist = hypot(point.x - displayX, point.y - displayY);
    const az = azimuthDeg(displayX, displayY, point.x, point.y);
    hudAimEl.textContent = `${point.x.toFixed(1)}, ${point.y.toFixed(1)}`;
    hudAimMetaEl.textContent = `距离 ${dist.toFixed(1)} m  ·  方位 ${az.toFixed(1)}°`;
  } else {
    hudAimEl.textContent = "未选定";
    hudAimMetaEl.textContent = "单击地图或输入坐标";
  }

  hudRegionChEl.textContent = String(opChannel);
  if (!showRegionEl.checked) {
    hudRegionEl.hidden = true;
  } else {
    const region = localizationForChannel(world, opChannel);
    if (region && region.polygon.length >= 3 && region.mec && region.mec.r > 1) {
      hudRegionEl.hidden = false;
      const ready = region.mec.r <= CLEAR_RADIUS + 1e-9;
      const diameter = region.diameter ? `直径 ${region.diameter.maxDist.toFixed(1)} m` : "直径 —";
      hudRegionMetaEl.textContent = `${diameter}\n覆盖圆半径 ${region.mec.r.toFixed(1)} m\n${ready ? "满足 20 m 清除条件" : "继续测向以缩小范围"}`;
    } else {
      hudRegionEl.hidden = true;
    }
  }

  mapHintEl.textContent = truthOn()
    ? "单击地图或输入坐标 · 滚轮缩放 · 拖动平移 · M 测向 · C 清除 · 双击频道瞄准真值"
    : "单击地图或输入坐标 · 滚轮缩放 · 拖动平移 · M 测向 · C 清除";
}

function renderJournal(): void {
  const key = `${world.seed}:${world.journal.length}:${world.exited ? 1 : 0}`;
  if (key === lastJournalKey) return;
  lastJournalKey = key;
  logEl.replaceChildren();
  for (const item of [...world.journal].reverse()) {
    const row = document.createElement("article");
    row.className = "log-row";
    row.dataset.tone = item.result ?? item.kind;
    const time = document.createElement("time");
    time.textContent = `${item.t.toFixed(3)} s`;
    const title = document.createElement("b");
    if (item.kind === "enter") title.textContent = "进入目标区域";
    else if (item.kind === "measure") title.textContent = `/measure  CH ${item.channel}`;
    else if (item.kind === "clear") title.textContent = `/clear  CH ${item.channel}`;
    else title.textContent = "/exit";
    const detail = document.createElement("span");
    const bits: string[] = [];
    if (item.x != null && item.y != null) bits.push(`(${item.x.toFixed(1)}, ${item.y.toFixed(1)})`);
    if (item.result) bits.push(item.result);
    if (item.note) bits.push(item.note);
    detail.textContent = bits.join("  ·  ") || "—";
    row.append(time, title, detail);
    logEl.append(row);
  }
}

function currentProblem(): ProblemKind {
  return Number(problemEl.value) === 4 ? 4 : 3;
}

function isBusy(): boolean {
  return walk !== null || cinematicMode !== "none";
}

function syncBusy(): void {
  const busy = isBusy();
  for (const btn of actionButtons) btn.disabled = busy;
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const nextW = Math.max(1, Math.round(rect.width * dpr));
  const nextH = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  if (!lastFrame) camera = fitCamera(canvas);
  draw();
}

function parseCoord(raw: string): number | null {
  const text = raw.trim();
  if (text === "" || text === "-" || text === "." || text === "-.") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) > COORD_ABS_MAX) return null;
  return value;
}

function writeAimInputs(x: number, y: number): void {
  if (document.activeElement !== aimXEl) {
    aimXEl.value = x.toFixed(1);
    aimXEl.dataset.invalid = "false";
  }
  if (document.activeElement !== aimYEl) {
    aimYEl.value = y.toFixed(1);
    aimYEl.dataset.invalid = "false";
  }
}

function setAim(x: number, y: number, origin: "map" | "input"): void {
  aim = { x, y };
  if (origin === "map") writeAimInputs(x, y);
  aimLiveEl.textContent = "单击地图或输入坐标选点";
}

function onAimInput(): void {
  const x = parseCoord(aimXEl.value);
  const y = parseCoord(aimYEl.value);
  aimXEl.dataset.invalid = x == null ? "true" : "false";
  aimYEl.dataset.invalid = y == null ? "true" : "false";
  if (x == null || y == null) {
    aim = null;
    aimLiveEl.textContent = `请输入有效坐标（绝对值 ≤ ${COORD_ABS_MAX} m）`;
    return;
  }
  setAim(x, y, "input");
}

function refreshReadyChannels(): void {
  const key = `${world.seed}|${world.observations.length}|${world.sources.map((s) => (s.cleared ? "1" : "0")).join("")}`;
  if (key === readyCacheKey) return;
  readyCacheKey = key;
  readyChannels.clear();
  const seen = new Set(
    world.observations.filter((item) => item.result !== "no_signal").map((item) => item.channel),
  );
  const cleared = new Set(world.sources.filter((item) => item.cleared).map((item) => item.channel));
  for (let ch = 1; ch <= CHANNELS; ch += 1) {
    if (!seen.has(ch) || cleared.has(ch)) continue;
    const region = localizationForChannel(world, ch);
    if (region?.mec && region.mec.r <= CLEAR_RADIUS + 1e-9) readyChannels.add(ch);
  }
}

function updatePreview(): void {
  if (walk) {
    previewEl.textContent = "机器狗正在前往测点…";
    return;
  }
  if (cinematicMode !== "none") {
    previewEl.textContent = cinematicMode === "intro" ? "正在进入目标区域…" : "本局结算中。";
    return;
  }
  if (!aim || world.exited) {
    previewEl.textContent = world.exited ? "本局已结束，可新开一局。" : "先在地图上点一个测点。";
    return;
  }
  aimLiveEl.textContent = `移动距离 ${hypot(aim.x - world.robotX, aim.y - world.robotY).toFixed(1)} m`;
  const measureCost = previewMeasureCost(world, aim.x, aim.y, opChannel);
  const hit = wouldClearHit(world, aim.x, aim.y, opChannel);
  const clearCost = previewClearCost(world, aim.x, aim.y, hit);
  previewEl.textContent =
    `测向预计  ${measureCost.totalS.toFixed(1)} s\n清除预计  ${showTruthEl.checked ? clearCost.totalS.toFixed(1) + " s" : "随执行结果结算"}` +
    (showTruthEl.checked ? `\n真值提示：20 m 内${hit ? "有目标" : "无目标"}` : "");
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
    robot: {
      x: displayX,
      y: displayY,
      headingDeg,
      gait,
      walking: walk !== null,
    },
    fx: {
      time: performance.now(),
      introT,
      outroT,
    },
    readyChannels,
  });
  const s = stats(world);
  document.querySelector("#kpi-time")!.textContent = `${world.virtualTime.toFixed(3)} s`;
  document.querySelector("#kpi-clear")!.textContent = truthOn()
    ? `${s.cleared} / ${s.total}`
    : String(s.cleared);
  kpiClearLabelEl.textContent = truthOn() ? "已清除 / 总数" : "已清除";
  document.querySelector("#kpi-avg")!.textContent =
    s.avgTime == null ? "—" : `${s.avgTime.toFixed(1)} s`;
  document.querySelector("#kpi-df")!.textContent = `CH ${world.dfChannel}`;
  opChannelEl.textContent = String(opChannel);
  refreshReadyChannels();
  syncChannels();
  renderJournal();
  updateHud();
  updatePreview();
  const region = showRegionEl.checked ? localizationForChannel(world, opChannel) : null;
  (document.querySelector("#view-region") as HTMLButtonElement).disabled = !region?.mec;
  const rawScale = 100 / camera.scale;
  const magnitude = 10 ** Math.floor(Math.log10(rawScale));
  const scaleMeters = [1, 2, 5].map(n => n * magnitude).filter(n => n <= rawScale).pop() ?? magnitude;
  document.querySelector("#scale-label")!.textContent = `${scaleMeters} m`;
  (document.querySelector("#scale-bar") as HTMLElement).style.width = `${scaleMeters * camera.scale}px`;
  document.querySelector("#channel-context")!.textContent = `测向机 CH ${world.dfChannel} · ${world.dfChannel === opChannel ? "当前频道，无需换频" : `测向时切换至 CH ${opChannel}`}\n清除不改变测向机频道`;
  syncBusy();
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
    else if (readyChannels.has(ch)) state = "ready";
    else if (seen.has(ch)) state = "seen";
    else if (ch === opChannel) state = "selected";
    else if (ch === world.dfChannel) state = "current";
    btn.dataset.state = state;
    btn.dataset.empty = showTruthEl.checked && !live.has(ch) ? "true" : "false";
    btn.setAttribute("aria-pressed", ch === opChannel ? "true" : "false");
    const label = cleared.has(ch) ? "已清除" : readyChannels.has(ch) ? "可清除" : seen.has(ch) ? "已测" : showTruthEl.checked && !live.has(ch) ? "无源" : "未测";
    const status = btn.querySelector("small")!;
    if (status.textContent !== label) status.textContent = label;
    btn.setAttribute("aria-label", `频道 ${ch}，${label}${ch === opChannel ? "，已选中" : ""}`);
    btn.title = `CH ${ch} · ${label}`;
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

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function walkTo(x: number, y: number, onDone: () => void): void {
  const fromX = displayX;
  const fromY = displayY;
  const dist = hypot(x - fromX, y - fromY);
  if (dist < 0.5 || reducedMotion) {
    displayX = x;
    displayY = y;
    if (dist >= 0.5) headingDeg = azimuthDeg(fromX, fromY, x, y);
    onDone();
    return;
  }
  walk = {
    fromX,
    fromY,
    toX: x,
    toY: y,
    t0: performance.now(),
    dur: clamp(dist / 480, 0.45, 2.8) * 1000,
    onDone,
  };
  syncBusy();
}

function hideCinematic(): void {
  cinematicMode = "none";
  introT = 0;
  outroT = 0;
  cinematicEl.classList.remove("is-on");
  cinematicEl.setAttribute("aria-hidden", "true");
  syncBusy();
}

function showCinematic(mode: "intro" | "outro", title: string, sub: string, holdMs: number): void {
  cinematicMode = mode;
  cinematicStartedAt = performance.now();
  cinematicHoldMs = reducedMotion ? Math.min(holdMs, 400) : holdMs;
  cinematicEl.dataset.mode = mode;
  cinematicKickerEl.textContent = mode === "intro" ? "FOXHOUND" : "MISSION REPORT";
  cinematicTitleEl.textContent = title;
  cinematicSubEl.textContent = sub;
  cinematicEl.classList.add("is-on");
  cinematicEl.setAttribute("aria-hidden", "false");
  if (mode === "intro") {
    introT = 0.001;
    outroT = 0;
  } else {
    outroT = 0.001;
    introT = 0;
  }
  syncBusy();
}

function playIntro(): void {
  displayX = 0;
  displayY = 0;
  headingDeg = 0;
  gait = 0;
  walk = null;
  showCinematic("intro", "进入目标区域", "机器狗已就位，单击地图选定下一个测点。", 2200);
}

function playOutro(reason: "cleared" | "exit"): void {
  const s = stats(world);
  const avg = s.avgTime == null ? "—" : `${s.avgTime.toFixed(1)} s`;
  const title = reason === "cleared" ? "全部清除" : "任务结束";
  const progress = progressLabel(s.cleared, s.total, reason === "cleared" || s.allCleared);
  const sub = `虚拟时间 ${world.virtualTime.toFixed(3)} s\n${progress}\n平均清除时间 ${avg}`;
  showCinematic("outro", title, sub, 5200);
}

function applyMeasure(point: { x: number; y: number }): void {
  const result = measure(world, point.x, point.y, opChannel);
  const region = localizationForChannel(world, opChannel);
  const diameter =
    region?.diameter && region.polygon.length >= 3
      ? `交会直径 ${region.diameter.maxDist.toFixed(1)} m`
      : "交会区尚未形成多边形";
  const mec =
    region?.mec && region.mec.r > 1
      ? `  最小覆盖半径 ${region.mec.r.toFixed(1)} m${
          region.mec.r <= CLEAR_RADIUS + 1e-9 ? "  ≤20 m，可清除" : ""
        }`
      : "";
  if (result.result === "direction") {
    setFeedback(
      "direction",
      `direction  示向度 ${result.svdDeg?.toFixed(2)}°  （含 ±1° 地点误差）\n耗时 ${result.cost.totalS.toFixed(3)} s\n${diameter}${mec}`,
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
}

function applyClear(point: { x: number; y: number }): void {
  const dfBefore = world.dfChannel;
  const result = clearTarget(world, point.x, point.y, opChannel);
  const s = stats(world);
  if (result.result === "success") {
    setFeedback(
      "success",
      `success  频道 ${opChannel} 已清除。测向机仍为 ${dfBefore}。\n耗时 ${result.cost.totalS.toFixed(3)} s\n${progressLabel(s.cleared, s.total, s.allCleared)}`,
    );
    if (s.allCleared) playOutro("cleared");
  } else {
    setFeedback(
      "no_target_in_range",
      `no_target_in_range  20 m 内没有频道 ${opChannel} 的未清除源。\n耗时 ${result.cost.totalS.toFixed(3)} s  测向机仍为 ${dfBefore}`,
    );
  }
}

function doMeasure(): void {
  if (isBusy()) return;
  const point = requireAim();
  if (!point) return;
  walkTo(point.x, point.y, () => applyMeasure(point));
}

function doClear(): void {
  if (isBusy()) return;
  const point = requireAim();
  if (!point) return;
  walkTo(point.x, point.y, () => applyClear(point));
}

function doMoveOnly(): void {
  if (isBusy()) return;
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
  setAim(400, 0, "map");
  opChannel = 1;
  lastJournalKey = "";
  camera = fitCamera(canvas);
  setFeedback("", "新局已生成。单击地图选点，再测向或清除。");
  playIntro();
}

function buildChannels(): void {
  channelsEl.replaceChildren();
  for (let ch = 1; ch <= CHANNELS; ch += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "channel";
    btn.dataset.channel = String(ch);
    btn.innerHTML = `<span>${ch}</span><small>未测</small>`;
    btn.addEventListener("click", () => {
      opChannel = ch;
      draw();
    });
    btn.addEventListener("dblclick", () => {
      const source = world.sources.find((item) => item.channel === ch);
      if (!showTruthEl.checked || !source) return;
      opChannel = ch;
      setAim(source.x, source.y, "map");
      setFeedback(
        "near",
        `已瞄准频道 ${ch} 真值位置 (${source.x.toFixed(1)}, ${source.y.toFixed(1)})。\n演练模式快捷操作；正式测试没有这个信息。`,
      );
      draw();
    });
    channelsEl.append(btn);
  }
}

function updateAnim(now: number): void {
  const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
  lastFrame = now;

  if (walk) {
    const u = Math.min(1, (now - walk.t0) / walk.dur);
    const e = easeInOutQuad(u);
    const nextX = walk.fromX + (walk.toX - walk.fromX) * e;
    const nextY = walk.fromY + (walk.toY - walk.fromY) * e;
    const face = azimuthDeg(walk.fromX, walk.fromY, walk.toX, walk.toY);
    headingDeg = lerpDeg(headingDeg, face, Math.min(1, dt * 10));
    gait += hypot(nextX - displayX, nextY - displayY) > 0.01 ? dt * 2.35 : 0;
    displayX = nextX;
    displayY = nextY;
    if (u >= 1) {
      displayX = walk.toX;
      displayY = walk.toY;
      headingDeg = face;
      const done = walk.onDone;
      walk = null;
      done();
    }
  }

  if (cinematicMode === "intro") {
    const elapsed = now - cinematicStartedAt;
    introT = clamp(elapsed / cinematicHoldMs, 0, 1);
    if (elapsed >= cinematicHoldMs) hideCinematic();
  } else if (cinematicMode === "outro") {
    const elapsed = now - cinematicStartedAt;
    outroT = clamp(elapsed / cinematicHoldMs, 0, 1);
    if (elapsed >= cinematicHoldMs) hideCinematic();
  } else {
    introT = 0;
    outroT *= Math.max(0, 1 - dt * 4);
    if (outroT < 0.01) outroT = 0;
  }
}

function loop(now: number): void {
  updateAnim(now);
  draw();
  requestAnimationFrame(loop);
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
    return;
  }
  hover = worldFromEvent(canvas, camera, event);
  canvas.title = `(${hover.x.toFixed(1)}, ${hover.y.toFixed(1)})`;
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
  if (cinematicMode !== "none") {
    hideCinematic();
    return;
  }
  const point = worldFromEvent(canvas, camera, event);
  setAim(point.x, point.y, "map");
});

canvas.addEventListener("pointerleave", () => {
  hover = null;
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const before = screenToWorld(canvas, camera, px, py);
  camera.scale = Math.min(12, Math.max(0.03, camera.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
  const after = screenToWorld(canvas, camera, px, py);
  camera.cx += before.x - after.x;
  camera.cy += before.y - after.y;
}, { passive: false });

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "Escape" && cinematicMode !== "none") {
    event.preventDefault();
    hideCinematic();
    return;
  }
  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    doMeasure();
  } else if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    doClear();
  } else if (event.key === "Enter" && event.target === canvas) {
    event.preventDefault();
    doMeasure();
  } else if (/^[1-9]$/.test(event.key)) {
    opChannel = Number(event.key);
  } else if (event.key === "0") {
    opChannel = 10;
  }
});

document.querySelector("#btn-measure")!.addEventListener("click", doMeasure);
document.querySelector("#view-all")!.addEventListener("click", () => { camera = fitCamera(canvas); });
document.querySelector("#view-robot")!.addEventListener("click", () => {
  camera.cx = displayX;
  camera.cy = displayY;
});
document.querySelector("#view-region")!.addEventListener("click", () => {
  const mec = localizationForChannel(world, opChannel)?.mec;
  if (!mec || !showRegionEl.checked) return;
  const rect = canvas.getBoundingClientRect();
  camera = { cx: mec.x, cy: mec.y, scale: clamp(Math.min(rect.width, rect.height) * 0.28 / Math.max(mec.r, 25), 0.03, 12) };
});
document.querySelector("#btn-clear")!.addEventListener("click", doClear);
document.querySelector("#btn-goto")!.addEventListener("click", doMoveOnly);
document.querySelector("#btn-exit")!.addEventListener("click", () => {
  if (isBusy()) return;
  exitWorld(world);
  setFeedback("no_signal", `user_exit  虚拟时间 ${world.virtualTime.toFixed(3)} s`);
  playOutro("exit");
});
document.querySelector("#new-case")!.addEventListener("click", () => {
  seedEl.value = String((Number(seedEl.value) || 2026) + 1);
  newCase();
});
cinematicEl.addEventListener("click", () => {
  if (cinematicMode !== "none") hideCinematic();
});
aimXEl.addEventListener("input", onAimInput);
aimYEl.addEventListener("input", onAimInput);
aimXEl.addEventListener("change", onAimInput);
aimYEl.addEventListener("change", onAimInput);
problemEl.addEventListener("change", newCase);
showTruthEl.addEventListener("change", draw);
showRegionEl.addEventListener("change", draw);
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => resize()).observe(canvas);
}
void document.fonts.ready.then(() => resize());

buildChannels();
seedEl.value = "2026";
resize();
newCase();
requestAnimationFrame(loop);
