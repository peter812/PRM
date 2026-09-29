import { useEffect, useRef, useState } from "react";
import {
  type WordCount,
  countWords,
  isFillerWord,
  layoutWords,
  type CloudShape,
  type PlacedWord,
  getColorScheme,
  pickColor,
  getEmotionColor,
} from "@/lib/wordcloud";

export type ColorMode = "palette" | "emotion";

export interface WordCloudProps {
  text?: string;
  words?: WordCount[];
  shape?: CloudShape;
  colorMode?: ColorMode;
  paletteId?: string;
  removeFillerWords?: boolean;
  maxWords?: number;
  minFontSize?: number;
  maxFontSize?: number;
  className?: string;
  height?: number;
}

export function WordCloud({
  text,
  words: wordsProp,
  shape = "rectangle",
  colorMode = "palette",
  paletteId = "ocean",
  removeFillerWords = true,
  maxWords = 150,
  minFontSize = 12,
  maxFontSize = 72,
  className,
  height = 480,
}: WordCloudProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hasWords, setHasWords] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let resizeTimer: number;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => setContainerWidth(width), 100);
      }
    });
    observer.observe(el);
    setContainerWidth(el.clientWidth);
    return () => {
      window.clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const wordCounts =
      wordsProp ??
      countWords(text ?? "", {
        removeFillerWords,
        isFillerWord,
        maxWords,
      });

    const scheme = getColorScheme(paletteId);
    const placed = layoutWords(wordCounts, ctx, {
      width: containerWidth,
      height,
      shape,
      minFontSize,
      maxFontSize,
      colorFor: (word, index) =>
        colorMode === "emotion" ? getEmotionColor(word.text) : pickColor(scheme, index),
    });

    if (hasWords !== (placed.length > 0)) {
      setHasWords(placed.length > 0);
    }

    ctx.clearRect(0, 0, containerWidth, height);
    for (const word of placed) {
      ctx.save();
      ctx.translate(word.x, word.y);
      ctx.rotate((word.rotate * Math.PI) / 180);
      ctx.font = `${word.fontSize}px sans-serif`;
      ctx.fillStyle = word.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(word.text, 0, 0);
      ctx.restore();
    }
  }, [
    text,
    wordsProp,
    containerWidth,
    height,
    shape,
    colorMode,
    paletteId,
    removeFillerWords,
    maxWords,
    minFontSize,
    maxFontSize,
    hasWords,
  ]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height, position: "relative" }}
    >
      <canvas ref={canvasRef} />
      {!hasWords && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Enter some text to generate a word cloud.
        </div>
      )}
    </div>
  );
}
