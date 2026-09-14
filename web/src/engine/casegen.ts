import { ARENA_RADIUS, CHANNELS, RECEIVE_MAX, RECEIVE_MIN } from "./types";
import type { CaseConfig, Source, SourceKind } from "./types";
import { hypot, sampleInDisk } from "./geometry";
import { mulberry32, pickInt, shuffle } from "./rng";

const MIN_SEPARATION = 120;

export function generateSources(config: CaseConfig): Source[] {
  const rng = mulberry32(config.seed);
  const count = pickInt(rng, 10, 16);
  const channels = shuffle(rng, Array.from({ length: CHANNELS }, (_, i) => i + 1)).slice(0, count);

  let directionalCount = 0;
  if (config.problem === 4) {
    directionalCount = pickInt(rng, 1, Math.max(1, count - 2));
  }
  const kinds: SourceKind[] = shuffle(rng, [
    ...Array.from({ length: directionalCount }, () => "directional" as const),
    ...Array.from({ length: count - directionalCount }, () => "omni" as const),
  ]);

  const sources: Source[] = [];
  for (let i = 0; i < count; i += 1) {
    let pos = sampleInDisk(rng, ARENA_RADIUS - 8);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const ok = sources.every((s) => hypot(s.x - pos.x, s.y - pos.y) >= MIN_SEPARATION);
      if (ok) break;
      pos = sampleInDisk(rng, ARENA_RADIUS - 8);
    }
    const kind = kinds[i];
    sources.push({
      channel: channels[i],
      x: pos.x,
      y: pos.y,
      radius: RECEIVE_MIN + rng() * (RECEIVE_MAX - RECEIVE_MIN),
      kind,
      headingDeg: kind === "directional" ? rng() * 360 : null,
      cleared: false,
    });
  }
  return sources.sort((a, b) => a.channel - b.channel);
}
