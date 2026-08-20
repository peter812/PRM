import { Users, Users2, Calendar, FileText, AtSign, BookOpen, MessageSquare } from "lucide-react";

export type SearchCategory = 'people' | 'groups' | 'interactions' | 'notes' | 'socialProfiles' | 'dailyNotes' | 'chats';

export interface SearchPreferences {
  order: SearchCategory[];
  enabled: Record<SearchCategory, boolean>;
}

const DEFAULT_PREFERENCES: SearchPreferences = {
  order: ['people', 'groups', 'interactions', 'notes', 'socialProfiles', 'dailyNotes', 'chats'],
  enabled: {
    people: true,
    groups: true,
    interactions: true,
    notes: true,
    socialProfiles: true,
    dailyNotes: true,
    chats: true,
  },
};

export const CATEGORY_LABELS: Record<SearchCategory, string> = {
  people: 'People',
  groups: 'Groups',
  interactions: 'Interactions',
  notes: 'Notes',
  socialProfiles: 'Social Profiles',
  dailyNotes: 'Daily Notes',
  chats: 'Chats',
};

export const CATEGORY_ICONS: Record<SearchCategory, typeof Users> = {
  people: Users,
  groups: Users2,
  interactions: Calendar,
  notes: FileText,
  socialProfiles: AtSign,
  dailyNotes: BookOpen,
  chats: MessageSquare,
};

export function loadPreferences(): SearchPreferences {
  try {
    const stored = localStorage.getItem('searchPreferences');
    if (stored) {
      const parsed = JSON.parse(stored) as SearchPreferences;
      // Only keep categories that are still valid; strip anything obsolete.
      const validCategories = new Set(DEFAULT_PREFERENCES.order);
      const mergedOrder = [...parsed.order].filter(c => validCategories.has(c as SearchCategory)) as SearchCategory[];
      const mergedEnabled = { ...DEFAULT_PREFERENCES.enabled, ...parsed.enabled };

      // Add any new categories missing from stored order.
      DEFAULT_PREFERENCES.order.forEach(category => {
        if (!mergedOrder.includes(category)) {
          mergedOrder.push(category);
        }
      });

      return { order: mergedOrder, enabled: mergedEnabled };
    }
  } catch (e) {
    console.error('Failed to load search preferences:', e);
  }
  return DEFAULT_PREFERENCES;
}

export function savePreferences(prefs: SearchPreferences): void {
  try {
    localStorage.setItem('searchPreferences', JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save search preferences:', e);
  }
}
