export interface WordCount {
  text: string;
  count: number;
}

const WORD_PATTERN = /[\p{L}][\p{L}'-]*[\p{L}]|[\p{L}]/gu;

// Splits free text into normalized word tokens (lowercased, punctuation stripped,
// leading/trailing apostrophes and hyphens trimmed) and drops anything under 2 chars.
export function tokenize(text: string): string[] {
  const matches = text.match(WORD_PATTERN) ?? [];
  return matches
    .map((word) => word.toLowerCase().replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length > 1);
}

export interface CountWordsOptions {
  removeFillerWords?: boolean;
  isFillerWord?: (word: string) => boolean;
  maxWords?: number;
}

export function countWords(text: string, options: CountWordsOptions = {}): WordCount[] {
  const { removeFillerWords = false, isFillerWord, maxWords } = options;
  const counts = new Map<string, number>();

  for (const word of tokenize(text)) {
    if (removeFillerWords && isFillerWord?.(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const sorted = Array.from(counts, ([text, count]) => ({ text, count })).sort(
    (a, b) => b.count - a.count,
  );

  return maxWords ? sorted.slice(0, maxWords) : sorted;
}
