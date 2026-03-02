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
