import type { Rect } from "./model";
export function viewportRect(rect: Rect, transform: number[]): Rect {
  const [a, b, c, d, e, f] = transform;
  const points = [
    [rect[0], rect[1]],
    [rect[0], rect[3]],
    [rect[2], rect[1]],
    [rect[2], rect[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
