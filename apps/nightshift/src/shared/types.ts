/** Shared types and constants for NightShift extension */

export type SiteMode = boolean | 'auto';

export interface FilterOptions {
  brightness?: number;
  contrast?: number;
  sepia?: number;
}

export interface DarkDetection {
  isDark: boolean;
  confidence: 'high' | 'low' | 'none';
  signals: string[];
}

/** Cycle site mode: auto → true → false → auto */
export function cycleSiteMode(current: SiteMode): SiteMode {
  if (current === 'auto') return true;
  if (current === true) return false;
  return 'auto';
}
