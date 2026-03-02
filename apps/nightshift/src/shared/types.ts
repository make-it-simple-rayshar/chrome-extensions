/** Shared types and constants for NightShift extension */

export type SiteMode = boolean | 'auto';

export type DarkMode = 'filter' | 'oled';

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

export interface ScheduleConfig {
  enabled: boolean;
  mode: 'manual' | 'sun';
  manualStart: string;
  manualEnd: string;
  latitude?: number;
  longitude?: number;
  cityName?: string;
}

export interface ColorProfile {
  id: string;
  name: string;
  darkMode: DarkMode;
  brightness: number;
  contrast: number;
  sepia: number;
}

export interface PerSitePattern {
  pattern: string;
  enabled: boolean | 'auto';
}
