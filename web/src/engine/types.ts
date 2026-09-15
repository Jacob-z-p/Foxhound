export const ARENA_RADIUS = 1800;
export const RECEIVE_MIN = 1000;
export const RECEIVE_MAX = 1500;
export const NEAR_RADIUS = 5;
export const CLEAR_RADIUS = 20;
export const MOVE_SPEED = 5;
export const MEASURE_SECONDS = 5;
export const TUNE_SECONDS = 1;
export const CLEAR_MISS_SECONDS = 3;
export const CLEAR_HIT_SECONDS = 5;
export const BEARING_ERROR_DEG = 1;
export const CHANNELS = 20;
export const COORD_ABS_MAX = 2_000_000;

export type ProblemKind = 3 | 4;
export type SourceKind = "omni" | "directional";
export type MeasureResult = "direction" | "near" | "no_signal";
export type ClearResult = "success" | "no_target_in_range";

export type Source = {
  channel: number;
  x: number;
  y: number;
  radius: number;
  kind: SourceKind;
  headingDeg: number | null;
  cleared: boolean;
};

export type Observation = {
  x: number;
  y: number;
  channel: number;
  result: MeasureResult;
  svdDeg: number | null;
  virtualTime: number;
};

export type CostBreakdown = {
  moveM: number;
  moveS: number;
  tuneS: number;
  actionS: number;
  totalS: number;
};

export type CaseConfig = {
  seed: number;
  problem: ProblemKind;
};

export type JournalKind = "enter" | "measure" | "clear" | "exit";

export type JournalEntry = {
  t: number;
  kind: JournalKind;
  result?: string;
  channel?: number;
  x?: number;
  y?: number;
  note?: string;
};

export type World = {
  seed: number;
  problem: ProblemKind;
  sources: Source[];
  robotX: number;
  robotY: number;
  dfChannel: number;
  virtualTime: number;
  entered: boolean;
  exited: boolean;
  observations: Observation[];
  path: Array<{ x: number; y: number }>;
  log: string[];
  journal: JournalEntry[];
};
