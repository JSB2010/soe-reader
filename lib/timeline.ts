import type { Segment } from "./model";
export function timeline(
  segments: Segment[],
  measured: Map<number, number> = new Map(),
) {
  const durations = segments.map(
    (s, i) =>
      measured.get(i) ||
      s.durationSeconds ||
      Math.max(1, s.text.trim().split(/\s+/).length / 2.7),
  );
  const offsets: number[] = [];
  let total = 0;
  durations.forEach((d) => {
    offsets.push(total);
    total += d;
  });
  return {
    durations,
    offsets,
    total,
    estimated: segments.some((s, i) => !s.durationSeconds && !measured.has(i)),
  };
}
export function locateTime(position: number, durations: number[]) {
  let seconds = Math.max(0, Number.isFinite(position) ? position : 0);
  for (let index = 0; index < durations.length; index++) {
    if (seconds < durations[index] || index === durations.length - 1)
      return {
        index,
        seconds: Math.min(seconds, Math.max(0, durations[index] - 0.01)),
      };
    seconds -= durations[index];
  }
  return { index: 0, seconds: 0 };
}
export function clock(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
