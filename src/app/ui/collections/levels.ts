// A step of the one-hue ramp a day or an hour is drawn in: 0 nothing, 4 the most.
export type Level = 0 | 1 | 2 | 3 | 4;

const step = (value: number, bounds: number[]): Level => (value <= 0 ? 0 : ((bounds.findIndex((bound) => value <= bound) + 1 || 4) as Level));

// By quartile of the values above zero, the top step the busiest fifth, so a quiet period still shows its busy days.
export function quartileLevels(values: number[]): Level[] {
  const above = values.filter((value) => value > 0).sort((a, b) => a - b);
  const at = (share: number) => above[Math.min(above.length - 1, Math.floor(above.length * share))]!;
  const bounds = above.length ? [at(0.25), at(0.5), at(0.8)] : [];
  return values.map((value) => step(value, bounds));
}

// Straight to the busiest value, so a grid of mostly quiet slots stays quiet.
export function linearLevels(values: number[]): Level[] {
  const most = Math.max(0, ...values);
  return values.map((value) => step(value, [0.2, 0.45, 0.75].map((share) => share * most)));
}
