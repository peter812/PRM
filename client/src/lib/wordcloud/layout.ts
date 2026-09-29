import type { WordCount } from "./tokenize";

export type CloudShape = "rectangle" | "circle";

export interface PlacedWord {
  text: string;
  x: number; // center x, relative to canvas origin
  y: number; // center y, relative to canvas origin
  width: number;
  height: number;
  fontSize: number;
  color: string;
  rotate: number; // 0 or 90 degrees
  count: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  shape: CloudShape;
  minFontSize?: number;
  maxFontSize?: number;
  fontFamily?: string;
  allowRotation?: boolean;
  padding?: number;
  colorFor: (word: WordCount, index: number) => string;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function fitsInCircle(rect: Rect, cx: number, cy: number, radius: number): boolean {
  const corners: [number, number][] = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.left, rect.bottom],
    [rect.right, rect.bottom],
  ];
  return corners.every(([x, y]) => Math.hypot(x - cx, y - cy) <= radius);
}

// Places words along an outward Archimedean spiral, skipping placements that
// collide with already-placed words or fall outside the target shape's bounds.
export function layoutWords(
  words: WordCount[],
  ctx: CanvasRenderingContext2D,
  options: LayoutOptions,
): PlacedWord[] {
  const {
    width,
    height,
    shape,
    minFontSize = 12,
    maxFontSize = 72,
    fontFamily = "sans-serif",
    allowRotation = true,
    padding = 3,
    colorFor,
  } = options;

  if (words.length === 0) return [];

  const cx = width / 2;
  const cy = height / 2;
  const boundsRadius = Math.min(width, height) / 2;

  const minCount = words[words.length - 1].count;
  const maxCount = words[0].count;
  const scale = (count: number) => {
    if (maxCount === minCount) return maxFontSize;
    const t = Math.sqrt((count - minCount) / (maxCount - minCount));
    return minFontSize + t * (maxFontSize - minFontSize);
  };

  const placed: PlacedWord[] = [];
  const placedRects: Rect[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const fontSize = Math.round(scale(word.count));
    const rotate = allowRotation && Math.random() < 0.25 ? 90 : 0;

    ctx.font = `${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(word.text);
    const textWidth = metrics.width;
    const textHeight = fontSize;
    const w = (rotate === 90 ? textHeight : textWidth) + padding * 2;
    const h = (rotate === 90 ? textWidth : textHeight) + padding * 2;

    let placedThisWord = false;
    const maxRadius = Math.hypot(width, height) / 2;
    const angleStep = 0.28;
    const radiusStep = 2.2;

    for (let theta = 0, radius = 0; radius < maxRadius; theta += angleStep, radius += radiusStep) {
      const x = cx + radius * Math.cos(theta);
      const y = cy + radius * Math.sin(theta);
      const rect: Rect = {
        left: x - w / 2,
        right: x + w / 2,
        top: y - h / 2,
        bottom: y + h / 2,
      };

      if (rect.left < 0 || rect.right > width || rect.top < 0 || rect.bottom > height) continue;
      if (shape === "circle" && !fitsInCircle(rect, cx, cy, boundsRadius)) continue;
      if (placedRects.some((other) => rectsOverlap(rect, other))) continue;

      placed.push({
        text: word.text,
        x,
        y,
        width: textWidth,
        height: textHeight,
        fontSize,
        rotate,
        color: colorFor(word, i),
        count: word.count,
      });
      placedRects.push(rect);
      placedThisWord = true;
      break;
    }

    // Word didn't fit anywhere within bounds — skip it rather than overlapping.
    if (!placedThisWord) continue;
  }

  return placed;
}
