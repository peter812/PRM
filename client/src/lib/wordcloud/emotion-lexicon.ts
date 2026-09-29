export type Emotion =
  | "joy"
  | "trust"
  | "fear"
  | "surprise"
  | "sadness"
  | "disgust"
  | "anger"
  | "anticipation";

// NRC-style emotion colors — kept distinct in both light and dark themes.
export const EMOTION_COLORS: Record<Emotion, string> = {
  joy: "#f5b60a",
  trust: "#2f9e44",
  fear: "#7048e8",
  surprise: "#e64980",
  sadness: "#3b6ea5",
  disgust: "#6a7f17",
  anger: "#e03131",
  anticipation: "#f76707",
};

export const NEUTRAL_COLOR = "#8a8f98";

// Compact curated word -> emotion lexicon (NRC-style). Not exhaustive; unmatched
// words fall back to NEUTRAL_COLOR when emotion coloring is enabled.
const LEXICON: Record<Emotion, string[]> = {
  joy: [
    "happy", "happiness", "joy", "joyful", "delight", "delighted", "cheerful",
    "glad", "smile", "smiling", "laugh", "laughing", "laughter", "fun", "funny",
    "love", "loved", "loving", "excited", "excitement", "wonderful", "great",
    "awesome", "amazing", "fantastic", "celebrate", "celebration", "playful",
    "bright", "sunshine", "party", "blessed", "grateful", "gratitude", "warm",
    "cozy", "sweet", "adorable", "cute", "fabulous", "beautiful", "lovely",
    "enjoy", "enjoyed", "enjoying", "pleasure", "delightful", "thrilled",
  ],
  trust: [
    "trust", "trusted", "trustworthy", "honest", "honesty", "loyal", "loyalty",
    "reliable", "faithful", "faith", "believe", "belief", "confident",
    "confidence", "safe", "security", "secure", "support", "supportive",
    "dependable", "sincere", "integrity", "genuine", "respect", "respected",
    "friend", "friendship", "family", "team", "trustful", "assured",
  ],
  fear: [
    "afraid", "fear", "fearful", "scared", "scary", "terrified", "terror",
    "anxious", "anxiety", "worried", "worry", "nervous", "panic", "dread",
    "horror", "horrible", "threat", "threatened", "danger", "dangerous",
    "frightened", "alarmed", "uneasy", "insecure", "paranoid", "stress",
    "stressed", "trembling",
  ],
  surprise: [
    "surprise", "surprised", "surprising", "shock", "shocked", "shocking",
    "amazed", "amazing", "astonished", "unexpected", "sudden", "suddenly",
    "wow", "whoa", "unbelievable", "startled", "stunned", "speechless",
  ],
  sadness: [
    "sad", "sadness", "unhappy", "cry", "crying", "cried", "tears", "grief",
    "grieving", "sorrow", "sorrowful", "depressed", "depression", "lonely",
    "loneliness", "heartbroken", "hurt", "pain", "painful", "miserable",
    "gloomy", "regret", "disappointed", "disappointment", "hopeless",
    "mourning", "loss", "lost", "empty", "broken",
  ],
  disgust: [
    "disgust", "disgusted", "disgusting", "gross", "nasty", "revolting",
    "repulsive", "sick", "sickening", "yuck", "vile", "filthy", "foul",
    "nauseous", "repugnant", "distaste", "contempt", "loathe", "loathsome",
  ],
  anger: [
    "angry", "anger", "mad", "furious", "fury", "rage", "raging", "hate",
    "hatred", "hostile", "annoyed", "annoying", "irritated", "irritating",
    "frustrated", "frustrating", "outraged", "outrage", "resent", "resentment",
    "bitter", "hostility", "aggressive", "enraged", "livid",
  ],
  anticipation: [
    "hope", "hopeful", "anticipate", "anticipation", "expect", "expecting",
    "expectation", "eager", "eagerly", "excited", "looking", "forward",
    "plan", "planning", "future", "soon", "upcoming", "await", "awaiting",
    "ready", "prepare", "preparing", "goal", "dream", "dreaming", "aspire",
    "optimistic", "optimism",
  ],
};

const WORD_TO_EMOTION: Map<string, Emotion> = (() => {
  const map = new Map<string, Emotion>();
  (Object.keys(LEXICON) as Emotion[]).forEach((emotion) => {
    LEXICON[emotion].forEach((word) => map.set(word, emotion));
  });
  return map;
})();

export function getEmotion(word: string): Emotion | undefined {
  return WORD_TO_EMOTION.get(word.toLowerCase());
}

export function getEmotionColor(word: string): string {
  const emotion = getEmotion(word);
  return emotion ? EMOTION_COLORS[emotion] : NEUTRAL_COLOR;
}
