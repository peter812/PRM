// Shared defaults for the Social Graph (3D) page. These are persisted to
// localStorage by the Social Graph settings page and read by the graph page
// when no overriding URL parameters are present.

export type GraphMode = 'default' | 'blob' | 'single-highlight' | 'multi-highlight';
export type ColorScheme = 'type' | 'distance' | 'connections';
export type SingleNodeColorScheme = 'follow-status' | 'type';

export interface SocialGraphDefaults {
  // Mode
  defaultMode: GraphMode;

  // Filters
  hideOrphans: boolean;
  minConnections: number;
  limitExtras: boolean;
  maxExtras: number;

  // Default color scheme (Default mode)
  colorScheme: ColorScheme;
  colorSchemeAccountId: string | null;
  connectionsColorMin: string;
  connectionsColorMax: string;
  linkMutualColor: string;
  linkDefaultColor: string;
  distanceColorSelf: string;
  distanceColorDirect: string;
  distanceColor2nd: string;
  distanceColorOther: string;

  // Single-highlight mode
  defaultSingleAccountId: string | null;
  singleNodeColorScheme: SingleNodeColorScheme;
  singleLinkMutualColor: string;
  singleLinkFollowsYouColor: string;
  singleLinkYouFollowColor: string;
  singleShowFriendLinks: boolean;
  singleRemoveExtras: boolean;

  // Multi-highlight mode
  multiHighlightColor: string;
  multiFollowsAllColor: string;
  multiFollowsOneColor: string;

  // Blob mode
  blobMergeMultiplier: number;
  blobForceMultiplier: number;
}

export const SOCIAL_GRAPH_DEFAULTS: SocialGraphDefaults = {
  defaultMode: 'single-highlight',

  hideOrphans: true,
  minConnections: 3,
  limitExtras: true,
  maxExtras: 20,

  colorScheme: 'type',
  colorSchemeAccountId: null,
  connectionsColorMin: '#3b0764',
  connectionsColorMax: '#ef4444',
  linkMutualColor: '#6366f1',
  linkDefaultColor: '#6b7280',
  distanceColorSelf: '#ef4444',
  distanceColorDirect: '#22c55e',
  distanceColor2nd: '#3b82f6',
  distanceColorOther: '#9ca3af',

  defaultSingleAccountId: null,
  singleNodeColorScheme: 'follow-status',
  singleLinkMutualColor: '#22c55e',
  singleLinkFollowsYouColor: '#3b82f6',
  singleLinkYouFollowColor: '#ef4444',
  singleShowFriendLinks: true,
  singleRemoveExtras: false,

  multiHighlightColor: '#ef4444',
  multiFollowsAllColor: '#ffffff',
  multiFollowsOneColor: '#eab308',

  blobMergeMultiplier: 0.5,
  blobForceMultiplier: 2,
};

export const SOCIAL_GRAPH_STORAGE_KEY = 'socialGraphDefaults';

export const EXTRAS_STEPS = [5, 10, 20, 50, 100];
export const MERGE_MULTIPLIER_STEPS = [0, 0.15, 0.3, 0.5, 0.75, 1];

/**
 * Load saved defaults, merging with built-in defaults so newly-added fields
 * always have a sensible value when older settings JSON is read.
 */
export function loadSocialGraphDefaults(): SocialGraphDefaults {
  try {
    const saved = typeof window !== 'undefined'
      ? window.localStorage.getItem(SOCIAL_GRAPH_STORAGE_KEY)
      : null;
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<SocialGraphDefaults>;
      return { ...SOCIAL_GRAPH_DEFAULTS, ...parsed };
    }
  } catch {
    // ignore parse / storage errors and fall back to defaults
  }
  return { ...SOCIAL_GRAPH_DEFAULTS };
}

export function saveSocialGraphDefaults(defaults: SocialGraphDefaults): void {
  window.localStorage.setItem(SOCIAL_GRAPH_STORAGE_KEY, JSON.stringify(defaults));
}

/**
 * True when the current page URL has no query params, in which case the
 * saved defaults should be applied to graph state on load. Any URL params
 * (e.g. `?view=person&selected=...`) take precedence over saved defaults.
 */
export function hasNoGraphUrlParams(): boolean {
  if (typeof window === 'undefined') return true;
  return window.location.search === '' || window.location.search === '?';
}

/**
 * Returns the initial graph settings to use on page load.
 *
 * When there are URL params present (e.g. the user navigated to a specific
 * account/view), the URL is the source of truth and the user-configured
 * defaults are skipped in favour of the built-in defaults. Otherwise the
 * saved defaults are used.
 */
export function getInitialGraphSettings(): SocialGraphDefaults {
  if (hasNoGraphUrlParams()) {
    return loadSocialGraphDefaults();
  }
  return { ...SOCIAL_GRAPH_DEFAULTS };
}
