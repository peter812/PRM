// The model sometimes wraps JSON in fences or prose; pull out the first object.
export function extractJsonObject(text: string): unknown {
  if (!text) return null;
  // Strip fenced blocks first.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenceMatch?.[1] ?? text).trim();
  // Find the first '{' and try progressively shorter slices ending at each
  // earlier '}' until JSON.parse succeeds. Walking `end` backward by hand
  // avoids an O(n²) re-scan of the string in lastIndexOf.
  const start = candidate.indexOf("{");
  if (start < 0) return null;
  let end = candidate.lastIndexOf("}");
  while (end > start) {
    const slice = candidate.slice(start, end + 1);
    try { return JSON.parse(slice); } catch { /* keep looking */ }
    // Step to the next earlier '}' by scanning manually.
    let next = -1;
    for (let i = end - 1; i > start; i--) {
      if (candidate.charCodeAt(i) === 0x7d /* '}' */) { next = i; break; }
    }
    if (next < 0) break;
    end = next;
  }
  return null;
}
