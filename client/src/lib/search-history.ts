import { type SearchCategory } from "./search-preferences";

export interface SearchHistoryItem {
  id: string; // unique key, e.g. `${category}:${entityId}`
  category: SearchCategory;
  title: string;
  subtitle?: string;
  url: string;
  imageUrl?: string | null;
  timestamp: number;
}

const STORAGE_KEY = "prm_search_history";
const MAX_HISTORY = 15;

export function loadSearchHistory(): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(items: SearchHistoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event("searchHistoryChanged"));
  } catch {
    // Ignore storage write errors (e.g. storage full or disabled)
  }
}

export function addToSearchHistory(item: Omit<SearchHistoryItem, "timestamp">): void {
  const current = loadSearchHistory();
  // Filter out existing matching entry by id or exact url
  const filtered = current.filter((h) => h.id !== item.id && h.url !== item.url);
  const updated: SearchHistoryItem[] = [
    { ...item, timestamp: Date.now() },
    ...filtered,
  ].slice(0, MAX_HISTORY);
  saveSearchHistory(updated);
}

export function removeFromSearchHistory(id: string): void {
  const current = loadSearchHistory();
  saveSearchHistory(current.filter((h) => h.id !== id));
}

export function clearSearchHistory(): void {
  saveSearchHistory([]);
}
