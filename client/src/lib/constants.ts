/**
 * Shared constants used across multiple components.
 */

/**
 * URL pattern to social account type name mappings.
 * Used for auto-detecting social account types from URLs.
 */
export const URL_TYPE_MAPPINGS: { pattern: RegExp; typeName: string }[] = [
  { pattern: /instagram\.com/i, typeName: "Instagram" },
  { pattern: /facebook\.com/i, typeName: "Facebook" },
  { pattern: /x\.com/i, typeName: "X.com" },
  { pattern: /twitter\.com/i, typeName: "X.com" },
];
