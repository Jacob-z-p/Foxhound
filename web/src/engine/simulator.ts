import {
  ARENA_RADIUS,
  BEARING_ERROR_DEG,
  CLEAR_HIT_SECONDS,
  CLEAR_MISS_SECONDS,
  CLEAR_RADIUS,
  COORD_ABS_MAX,
  MEASURE_SECONDS,
  MOVE_SPEED,
  NEAR_RADIUS,
  TUNE_SECONDS,
} from "./types";
import type {
  CaseConfig,
  ClearResult,
  CostBreakdown,
  MeasureResult,
  Observation,
  Source,
  World,
} from "./types";
import { generateSources } from "./casegen";
import {
  azimuthDeg,
  hypot,
  localizationRegion,
  pointInDirectionalFan,
  roundDeg2,
} from "./geometry";
import { hash01 } from "./rng";

function assertCoord(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("坐标必须是有限数");
  }
  if (Math.abs(x) > COORD_ABS_MAX || Math.abs(y) > COORD_ABS_MAX) {
    throw new Error("坐标分量绝对值不能超过 2000000");
  }
}

export function createWorld(config: CaseConfig): World {
  return {
    seed: config.seed,
    problem: config.problem,
    sources: generateSources(config),
    robotX: 0,
    robotY: 0,
    dfChannel: 1,
    virtualTime: 0,
    entered: true,
    exited: false,
    observations: [],
    path: [{ x: 0, y: 0 }],
    log: [`进入目标区域  seed=${config.seed}  问题${config.problem}`],
  };
}

export function moveCost(world: World, x: number, y: number): Pick<CostBreakdown, "moveM" | "moveS"> {
  const moveM = hypot(x - world.robotX, y - world.robotY);
  return { moveM, moveS: moveM / MOVE_SPEED };
}

export function previewMeasureCost(world: World, x: number, y: number, channel: number): CostBreakdown {
  const { moveM, moveS } = moveCost(world, x, y);
  const tuneS = channel === world.dfChannel ? 0 : TUNE_SECONDS;
  const totalS = moveS + tuneS + MEASURE_SECONDS;
  return { moveM, moveS, tuneS, actionS: MEASURE_SECONDS, totalS };
}

export function previewClearCost(world: World, x: number, y: number, hit: boolean): CostBreakdown {
  const { moveM, moveS } = moveCost(world, x, y);
  const actionS = hit ? CLEAR_HIT_SECONDS : CLEAR_MISS_SECONDS;
  return { moveM, moveS, tuneS: 0, actionS, totalS: moveS + actionS };
}

function sourceVisibleFrom(source: Source, x: number, y: number): boolean {
  if (source.cleared) return false;
  const d = hypot(x - source.x, y - source.y);
  if (d > source.radius + 1e-9) return false;
  if (source.kind === "omni") return true;
  if (source.headingDeg == null) return false;
  return pointInDirectionalFan(source.x, source.y, source.headingDeg, x, y);
}

function bearingErrorDeg(world: World, channel: number, x: number, y: number): number {
  const u = hash01([world.seed, channel, x.toFixed(6), y.toFixed(6)]);
  return (u * 2 - 1) * BEARING_ERROR_DEG;
}

function moveRobot(world: World, x: number, y: number): number {
  const { moveS } = moveCost(world, x, y);
  if (moveS > 0) {
    world.path.push({ x, y });
  }
  world.robotX = x;
  world.robotY = y;
  return moveS;
}

export function canReceive(source: Source, x: number, y: number): boolean {
  return sourceVisibleFrom(source, x, y);
}

export function wouldClearHit(world: World, x: number, y: number, channel: number): boolean {
  const source = world.sources.find((item) => item.channel === channel);
  if (!source || source.cleared) return false;
  return hypot(x - source.x, y - source.y) <= CLEAR_RADIUS + 1e-9;
}

export function measure(world: World, x: number, y: number, channel: number): {
  result: MeasureResult;
  svdDeg: number | null;
  cost: CostBreakdown;
  source: Source | null;
} {
  if (world.exited) throw new Error("本局已结束");
  assertCoord(x, y);
  const { moveM, moveS } = moveCost(world, x, y);
  const tuneS = channel === world.dfChannel ? 0 : TUNE_SECONDS;
  const cost: CostBreakdown = {
    moveM,
    moveS,
    tuneS,
    actionS: MEASURE_SECONDS,
    totalS: moveS + tuneS + MEASURE_SECONDS,
  };

  moveRobot(world, x, y);
  world.dfChannel = channel;
  world.virtualTime += cost.totalS;

  const source = world.sources.find((item) => item.channel === channel) ?? null;
  let result: MeasureResult = "no_signal";
  let svdDeg: number | null = null;

  if (source && sourceVisibleFrom(source, x, y)) {
    const d = hypot(x - source.x, y - source.y);
    if (d <= NEAR_RADIUS + 1e-9) {
      result = "near";
    } else {
      result = "direction";
      const trueAz = azimuthDeg(x, y, source.x, source.y);
      svdDeg = roundDeg2(trueAz + bearingErrorDeg(world, channel, x, y));
    }
  }

  const observation: Observation = {
    x,
    y,
    channel,
    result,
    svdDeg,
    virtualTime: world.virtualTime,
  };
  world.observations.push(observation);
  world.log.push(
    `t=${world.virtualTime.toFixed(3)}s  /measure  (${x.toFixed(1)}, ${y.toFixed(1)})  ch${channel}  ${result}${
      svdDeg == null ? "" : `  ${svdDeg.toFixed(2)}°`
    }`,
  );
  return { result, svdDeg, cost, source };
}

export function clearTarget(world: World, x: number, y: number, channel: number): {
  result: ClearResult;
  cost: CostBreakdown;
  source: Source | null;
} {
  if (world.exited) throw new Error("本局已结束");
  assertCoord(x, y);
  const hit = wouldClearHit(world, x, y, channel);
  const { moveM, moveS } = moveCost(world, x, y);
  const actionS = hit ? CLEAR_HIT_SECONDS : CLEAR_MISS_SECONDS;
  const cost: CostBreakdown = {
    moveM,
    moveS,
    tuneS: 0,
    actionS,
    totalS: moveS + actionS,
  };

  moveRobot(world, x, y);
  world.virtualTime += cost.totalS;

  const source = world.sources.find((item) => item.channel === channel) ?? null;
  let result: ClearResult = "no_target_in_range";
  if (hit && source) {
    source.cleared = true;
    result = "success";
  }

  world.log.push(
    `t=${world.virtualTime.toFixed(3)}s  /clear  (${x.toFixed(1)}, ${y.toFixed(1)})  ch${channel}  ${result}  （测向机仍为频道 ${world.dfChannel}）`,
  );
  return { result, cost, source };
}

export function exitWorld(world: World): void {
  world.exited = true;
  world.log.push(`t=${world.virtualTime.toFixed(3)}s  /exit`);
}

export function clearedCount(world: World): number {
  return world.sources.filter((s) => s.cleared).length;
}

export function localizationForChannel(world: World, channel: number) {
  const bearings = world.observations
    .filter((item) => item.channel === channel && item.result === "direction" && item.svdDeg != null)
    .map((item) => ({ x: item.x, y: item.y, svdDeg: item.svdDeg as number }));
  if (bearings.length === 0) return null;
  return localizationRegion(ARENA_RADIUS, bearings);
}

export function stats(world: World) {
  const cleared = clearedCount(world);
  const total = world.sources.length;
  return {
    cleared,
    total,
    ratio: total === 0 ? 0 : cleared / total,
    avgTime: cleared === 0 ? null : world.virtualTime / cleared,
    allCleared: cleared === total,
  };
}
